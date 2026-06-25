import { db, cobrosTable, pagosParciales } from "@workspace/db";
import { and, eq, inArray, type SQL } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Client payment-behaviour scoring.
//
// The score is computed ON THE FLY from each cliente's cobro + confirmed-abono
// history. It is deliberately NOT stored in a column: the inputs (currently
// overdue counts, recency window) change as time passes, so a persisted score
// would go stale every day. Recomputing keeps it always-correct and cheap at
// this app's scale.
//
// Score (0-100) is a weighted blend:
//   40%  % de cobros pagados vs emitidos (excl. cancelados)
//   30%  promedio de días de atraso (pagos tardíos + vencidos sin pagar hoy)
//   20%  cantidad de cobros vencidos sin pagar actualmente
//   10%  tendencia: tasa de pago de los últimos 3 meses vs. el período anterior
// ---------------------------------------------------------------------------

export type ScoreCategoria =
  | "excelente"
  | "bueno"
  | "regular"
  | "riesgoso"
  | "critico"
  | "sin_datos";

export type FactorTipo = "positivo" | "neutral" | "negativo";

export interface ScoreFactor {
  texto: string;
  tipo: FactorTipo;
}

export interface ClienteScore {
  clienteId: number;
  score: number | null; // null when there is no history (sin_datos)
  categoria: ScoreCategoria;
  totalCobros: number; // emitidos (excludes cancelados)
  totalCobrado: number; // sum of confirmed abonos (money actually received)
  totalPendiente: number; // sum of outstanding saldo (pendiente + parcial)
  promedioDiasAtraso: number;
  cobrosVencidos: number;
  factores: ScoreFactor[];
}

const MS_DAY = 86_400_000;

function montoACobrar(c: { monto: string; montoDescuento: string | null }): number {
  return Number(c.monto) - Number(c.montoDescuento ?? 0);
}

function parseDateOnly(s: string): Date | null {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function diasEntre(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_DAY);
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function categoriaFromScore(score: number | null): ScoreCategoria {
  if (score == null) return "sin_datos";
  if (score >= 80) return "excelente";
  if (score >= 60) return "bueno";
  if (score >= 40) return "regular";
  if (score >= 20) return "riesgoso";
  return "critico";
}

interface CobroRow {
  id: number;
  clienteId: number | null;
  estado: "pendiente" | "pagado" | "parcial" | "fallido" | "cancelado";
  monto: string;
  montoDescuento: string | null;
  fechaVencimiento: string | null;
  creadoEn: Date;
}

// Computes scores for the given clientes. `cobroScope` is the same WHERE clause
// used elsewhere to restrict which cobros the requesting user may see, so an
// ejecutivo only scores from cobros they own and an admin from the whole org.
export async function computeClienteScores(
  clienteIds: number[],
  cobroScope: SQL | undefined,
): Promise<Map<number, ClienteScore>> {
  const result = new Map<number, ClienteScore>();
  if (clienteIds.length === 0) return result;

  const cobroConds: SQL[] = [inArray(cobrosTable.clienteId, clienteIds)];
  if (cobroScope) cobroConds.push(cobroScope);

  const cobros: CobroRow[] = await db
    .select({
      id: cobrosTable.id,
      clienteId: cobrosTable.clienteId,
      estado: cobrosTable.estado,
      monto: cobrosTable.monto,
      montoDescuento: cobrosTable.montoDescuento,
      fechaVencimiento: cobrosTable.fechaVencimiento,
      creadoEn: cobrosTable.creadoEn,
    })
    .from(cobrosTable)
    .where(and(...cobroConds));

  // Confirmed abonos for these cobros: total received + latest payment date.
  const cobroIds = cobros.map((c) => c.id);
  const abonadoPorCobro = new Map<number, number>();
  const ultimoPagoPorCobro = new Map<number, Date>();
  if (cobroIds.length > 0) {
    const abonos = await db
      .select({
        cobroId: pagosParciales.cobroId,
        monto: pagosParciales.monto,
        confirmadoEn: pagosParciales.confirmadoEn,
      })
      .from(pagosParciales)
      .where(
        and(
          eq(pagosParciales.estado, "confirmado"),
          inArray(pagosParciales.cobroId, cobroIds),
        ),
      );
    for (const a of abonos) {
      abonadoPorCobro.set(a.cobroId, (abonadoPorCobro.get(a.cobroId) ?? 0) + Number(a.monto));
      if (a.confirmadoEn) {
        const prev = ultimoPagoPorCobro.get(a.cobroId);
        if (!prev || a.confirmadoEn > prev) ultimoPagoPorCobro.set(a.cobroId, a.confirmadoEn);
      }
    }
  }

  const hoy = toDateOnly(new Date());
  const now = new Date();
  const corteReciente = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());

  const porCliente = new Map<number, CobroRow[]>();
  for (const c of cobros) {
    if (c.clienteId == null) continue;
    const arr = porCliente.get(c.clienteId);
    if (arr) arr.push(c);
    else porCliente.set(c.clienteId, [c]);
  }

  for (const clienteId of clienteIds) {
    const lista = porCliente.get(clienteId) ?? [];
    const emitidos = lista.filter((c) => c.estado !== "cancelado");

    if (emitidos.length === 0) {
      result.set(clienteId, {
        clienteId,
        score: null,
        categoria: "sin_datos",
        totalCobros: 0,
        totalCobrado: 0,
        totalPendiente: 0,
        promedioDiasAtraso: 0,
        cobrosVencidos: 0,
        factores: [{ texto: "Sin historial de cobros aún", tipo: "neutral" }],
      });
      continue;
    }

    const pagados = emitidos.filter((c) => c.estado === "pagado");

    let totalCobrado = 0;
    let totalPendiente = 0;
    let cobrosVencidos = 0;
    const muestrasAtraso: number[] = [];

    for (const c of emitidos) {
      const abonado = abonadoPorCobro.get(c.id) ?? 0;
      totalCobrado += abonado;

      const terminal = c.estado === "pagado" || c.estado === "fallido";
      const aCobrar = montoACobrar(c);
      const venc = c.fechaVencimiento ? parseDateOnly(c.fechaVencimiento) : null;

      if (c.estado === "pendiente" || c.estado === "parcial") {
        totalPendiente += Math.max(aCobrar - abonado, 0);
        if (venc && diasEntre(hoy, venc) > 0) {
          cobrosVencidos += 1;
          muestrasAtraso.push(diasEntre(hoy, venc));
        }
      }

      if (c.estado === "pagado" && venc) {
        const pago = ultimoPagoPorCobro.get(c.id);
        if (pago) {
          muestrasAtraso.push(Math.max(0, diasEntre(toDateOnly(pago), venc)));
        }
      }
      void terminal;
    }

    const promedioDiasAtraso =
      muestrasAtraso.length > 0
        ? muestrasAtraso.reduce((a, b) => a + b, 0) / muestrasAtraso.length
        : 0;

    // Component 1 — payment rate (40%)
    const tasaPago = pagados.length / emitidos.length;
    const score1 = tasaPago * 100;

    // Component 2 — average days late (30%); 0 días → 100, 60+ días → 0
    const score2 = clamp(100 - promedioDiasAtraso * (100 / 60));

    // Component 3 — current overdue unpaid cobros (20%)
    const score3 = clamp(100 - cobrosVencidos * 25);

    // Component 4 — recent trend (10%): last 3 months vs. before
    const recientes = emitidos.filter((c) => c.creadoEn >= corteReciente);
    const previos = emitidos.filter((c) => c.creadoEn < corteReciente);
    let score4 = 50; // neutral when there isn't enough history to compare
    let tendencia: "mejorando" | "empeorando" | "estable" = "estable";
    if (recientes.length > 0 && previos.length > 0) {
      const tasaReciente =
        recientes.filter((c) => c.estado === "pagado").length / recientes.length;
      const tasaPrevia = previos.filter((c) => c.estado === "pagado").length / previos.length;
      const delta = tasaReciente - tasaPrevia;
      score4 = clamp(50 + delta * 100);
      if (delta > 0.1) tendencia = "mejorando";
      else if (delta < -0.1) tendencia = "empeorando";
    }

    const score = Math.round(
      clamp(0.4 * score1 + 0.3 * score2 + 0.2 * score3 + 0.1 * score4),
    );

    const factores: ScoreFactor[] = [];
    const pctPagados = Math.round(tasaPago * 100);
    factores.push({
      texto: `Paga el ${pctPagados}% de sus cobros emitidos`,
      tipo: tasaPago >= 0.8 ? "positivo" : tasaPago >= 0.5 ? "neutral" : "negativo",
    });

    const diasRedondeados = Math.round(promedioDiasAtraso);
    if (muestrasAtraso.length === 0) {
      factores.push({ texto: "Aún no hay pagos ni vencimientos para evaluar atrasos", tipo: "neutral" });
    } else if (diasRedondeados <= 2) {
      factores.push({ texto: "Suele pagar a tiempo", tipo: "positivo" });
    } else {
      factores.push({
        texto: `Paga en promedio ${diasRedondeados} día${diasRedondeados !== 1 ? "s" : ""} tarde`,
        tipo: diasRedondeados > 15 ? "negativo" : "neutral",
      });
    }

    if (cobrosVencidos > 0) {
      factores.push({
        texto: `Tiene ${cobrosVencidos} cobro${cobrosVencidos !== 1 ? "s" : ""} vencido${cobrosVencidos !== 1 ? "s" : ""} sin pagar`,
        tipo: "negativo",
      });
    } else {
      factores.push({ texto: "No tiene cobros vencidos actualmente", tipo: "positivo" });
    }

    if (tendencia === "mejorando") {
      factores.push({ texto: "Su comportamiento de pago ha mejorado recientemente", tipo: "positivo" });
    } else if (tendencia === "empeorando") {
      factores.push({ texto: "Su comportamiento de pago ha empeorado recientemente", tipo: "negativo" });
    }

    result.set(clienteId, {
      clienteId,
      score,
      categoria: categoriaFromScore(score),
      totalCobros: emitidos.length,
      totalCobrado,
      totalPendiente,
      promedioDiasAtraso: Math.round(promedioDiasAtraso * 10) / 10,
      cobrosVencidos,
      factores,
    });
  }

  return result;
}
