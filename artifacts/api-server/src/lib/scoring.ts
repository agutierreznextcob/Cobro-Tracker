import { db, cobrosTable, pagosParciales, gestionesCobranzaTable } from "@workspace/db";
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

export interface ScoreRecomendacion {
  titulo: string;
  detalle: string;
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
  // --- Predictive layer ---
  // Probability (0-100) that the client pays within the next 7 days.
  // null when there is nothing outstanding or no history to predict from.
  probabilidadPago: number | null;
  // Estimated payment date (YYYY-MM-DD) for the earliest open cobro, based on
  // the client's average lateness. null when nothing is outstanding.
  fechaEstimadaPago: string | null;
  // Payment promises (gestiones with a "will pay" result) whose deadline
  // passed with the cobro still unpaid, in the last 6 months.
  promesasIncumplidas: number;
  // Latest gestión of any kind for this client (ISO timestamp) or null.
  ultimoContactoEn: string | null;
  // Rule-based recommended action derived from the risk profile.
  recomendacion: ScoreRecomendacion | null;
}

// Gestión results that constitute a payment promise.
const RESULTADOS_PROMESA = new Set(["contactado_pagara", "acordo_fecha_pago", "acordo_pago_parcial"]);

// Fixed action guidance per score category (spec-defined).
function recomendacionPara(
  categoria: ScoreCategoria,
  opts: { cobrosVencidos: number; promesasIncumplidas: number },
): ScoreRecomendacion | null {
  const extra =
    opts.promesasIncumplidas > 0
      ? ` Registra un compromiso concreto: acumula ${opts.promesasIncumplidas} promesa${opts.promesasIncumplidas !== 1 ? "s" : ""} de pago incumplida${opts.promesasIncumplidas !== 1 ? "s" : ""}.`
      : "";
  switch (categoria) {
    case "excelente":
      return { titulo: "Recordatorio amable", detalle: "Cliente confiable. Un recordatorio amable es suficiente." + extra };
    case "bueno":
      return { titulo: "Recordatorio anticipado", detalle: "Enviar recordatorio 3 días antes del vencimiento." + extra };
    case "regular":
      return { titulo: opts.cobrosVencidos > 0 ? "Contactar hoy" : "Contactar esta semana", detalle: "Contactar por WhatsApp y email simultáneamente." + extra };
    case "riesgoso":
      return { titulo: "Contactar hoy", detalle: "Llamada directa recomendada. Considerar descuento de negociación." + extra };
    case "critico":
      return { titulo: "Escalar hoy", detalle: "Escalar a administrador. Evaluar acción legal o derivación a cobranza extrajudicial." + extra };
    default:
      return null;
  }
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
  pagadoEn: Date | null;
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

  const cobroConds: SQL[] = [inArray(cobrosTable.clienteId, clienteIds), eq(cobrosTable.moneda, "CLP")];
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
      pagadoEn: cobrosTable.pagadoEn,
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

  // Gestiones for these cobros: last contact per client + payment promises.
  interface GestionRow {
    cobroId: number;
    resultado: string;
    proximaGestionEn: Date | null;
    creadoEn: Date;
  }
  let gestiones: GestionRow[] = [];
  if (cobroIds.length > 0) {
    gestiones = await db
      .select({
        cobroId: gestionesCobranzaTable.cobroId,
        resultado: gestionesCobranzaTable.resultado,
        proximaGestionEn: gestionesCobranzaTable.proximaGestionEn,
        creadoEn: gestionesCobranzaTable.creadoEn,
      })
      .from(gestionesCobranzaTable)
      .where(inArray(gestionesCobranzaTable.cobroId, cobroIds));
  }

  const hoy = toDateOnly(new Date());
  const now = new Date();
  const corteReciente = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  const corte6Meses = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());

  const clientePorCobro = new Map<number, number>();
  for (const c of cobros) if (c.clienteId != null) clientePorCobro.set(c.id, c.clienteId);
  const cobroPorId = new Map<number, CobroRow>();
  for (const c of cobros) cobroPorId.set(c.id, c);

  // Per-client: latest contact, and promise outcomes over the last 6 months.
  //
  // Promise model (product rule): a gestión whose resultado is a "will pay"
  // commitment carries a deadline = proximaGestionEn if set, else 7 days after
  // the gestión (plus 1 day of grace either way). It is evaluated against the
  // confirmed payment timestamp of ITS cobro (latest confirmed abono, or
  // pagadoEn for cobros closed without abono records):
  //   - kept:   a payment landed after the promise and within the deadline.
  //   - broken: the cobro is fallido; or the deadline passed with no payment
  //             after the promise (including cobros later paid late).
  //   - open:   deadline still in the future and no payment yet — not counted.
  const ultimoContactoPorCliente = new Map<number, Date>();
  const promesasIncumplidasPorCliente = new Map<number, number>();
  const promesasCumplidasPorCliente = new Map<number, number>();
  const GRACIA = 1 * MS_DAY;
  for (const g of gestiones) {
    const clienteId = clientePorCobro.get(g.cobroId);
    if (clienteId == null) continue;
    const prev = ultimoContactoPorCliente.get(clienteId);
    if (!prev || g.creadoEn > prev) ultimoContactoPorCliente.set(clienteId, g.creadoEn);

    if (!RESULTADOS_PROMESA.has(g.resultado) || g.creadoEn < corte6Meses) continue;
    const cobro = cobroPorId.get(g.cobroId);
    if (!cobro || cobro.estado === "cancelado") continue;

    const limite = new Date((g.proximaGestionEn ?? new Date(g.creadoEn.getTime() + 7 * MS_DAY)).getTime() + GRACIA);
    // Payment timestamp for this cobro, if any.
    const abonoEn = ultimoPagoPorCobro.get(g.cobroId) ?? null;
    const pagoEn =
      cobro.estado === "pagado"
        ? (abonoEn && cobro.pagadoEn ? (abonoEn > cobro.pagadoEn ? abonoEn : cobro.pagadoEn) : (abonoEn ?? cobro.pagadoEn))
        : abonoEn;
    const pagoTrasPromesa = pagoEn != null && pagoEn >= g.creadoEn;

    const incr = (m: Map<number, number>) => m.set(clienteId, (m.get(clienteId) ?? 0) + 1);
    if (pagoTrasPromesa && pagoEn! <= limite) {
      incr(promesasCumplidasPorCliente);
    } else if (cobro.estado === "fallido" || (limite < now && (!pagoTrasPromesa || pagoEn! > limite))) {
      incr(promesasIncumplidasPorCliente);
    }
  }

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
        probabilidadPago: null,
        fechaEstimadaPago: null,
        promesasIncumplidas: 0,
        ultimoContactoEn: null,
        recomendacion: null,
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

    // ---------------- Predictive layer ----------------
    const abiertos = emitidos.filter((c) => c.estado === "pendiente" || c.estado === "parcial");
    const promesasIncumplidas = promesasIncumplidasPorCliente.get(clienteId) ?? 0;
    const promesasCumplidas = promesasCumplidasPorCliente.get(clienteId) ?? 0;
    const ultimoContacto = ultimoContactoPorCliente.get(clienteId) ?? null;

    let probabilidadPago: number | null = null;
    let fechaEstimadaPago: string | null = null;

    if (abiertos.length > 0) {
      // p1 (40%) — payment history: share of emitted cobros actually paid.
      const p1 = tasaPago * 100;

      // p2 (25%) — current lateness: worst mora among open cobros; 0 días → 100, 45+ → 0.
      let peorMora = 0;
      for (const c of abiertos) {
        const venc = c.fechaVencimiento ? parseDateOnly(c.fechaVencimiento) : null;
        if (venc) peorMora = Math.max(peorMora, Math.max(diasEntre(hoy, venc), 0));
      }
      const p2 = clamp(100 - peorMora * (100 / 45));

      // p3 (20%) — promises kept vs broken in the last 6 months; neutral 60 with no promises.
      const totalPromesas = promesasCumplidas + promesasIncumplidas;
      const p3 = totalPromesas > 0 ? (promesasCumplidas / totalPromesas) * 100 : 60;

      // p4 (15%) — outstanding amount vs the largest cobro historically paid:
      // amounts within the client's usual range are more likely to be paid.
      const montosPagados = pagados.map((c) => montoACobrar(c)).filter((m) => m > 0);
      const maxPagado = montosPagados.length > 0 ? Math.max(...montosPagados) : 0;
      const p4 =
        maxPagado <= 0
          ? 50
          : totalPendiente <= maxPagado
            ? 100
            : clamp(100 - (totalPendiente / maxPagado - 1) * 50);

      probabilidadPago = Math.round(clamp(0.4 * p1 + 0.25 * p2 + 0.2 * p3 + 0.15 * p4, 3, 97));

      // Estimated payment date: earliest open due date (or today if already
      // past) plus the client's average lateness.
      let vencMasProximo: Date | null = null;
      for (const c of abiertos) {
        const venc = c.fechaVencimiento ? parseDateOnly(c.fechaVencimiento) : null;
        if (venc && (!vencMasProximo || venc < vencMasProximo)) vencMasProximo = venc;
      }
      if (vencMasProximo) {
        const base = vencMasProximo < hoy ? hoy : vencMasProximo;
        const estimada = new Date(base.getTime() + Math.round(promedioDiasAtraso) * MS_DAY);
        fechaEstimadaPago = estimada.toISOString().slice(0, 10);
      }
    }

    if (promesasIncumplidas > 0) {
      factores.push({
        texto: `${promesasIncumplidas} promesa${promesasIncumplidas !== 1 ? "s" : ""} de pago incumplida${promesasIncumplidas !== 1 ? "s" : ""} en los últimos 6 meses`,
        tipo: "negativo",
      });
    }

    const categoria = categoriaFromScore(score);
    result.set(clienteId, {
      clienteId,
      score,
      categoria,
      totalCobros: emitidos.length,
      totalCobrado,
      totalPendiente,
      promedioDiasAtraso: Math.round(promedioDiasAtraso * 10) / 10,
      cobrosVencidos,
      factores,
      probabilidadPago,
      fechaEstimadaPago,
      promesasIncumplidas,
      ultimoContactoEn: ultimoContacto ? ultimoContacto.toISOString() : null,
      recomendacion: recomendacionPara(categoria, { cobrosVencidos, promesasIncumplidas }),
    });
  }

  return result;
}
