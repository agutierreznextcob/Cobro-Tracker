import { Router } from "express";
import {
  db,
  cobrosTable,
  cobroDescuentosTable,
  cobroAjustesTable,
  cobrosEliminadosTable,
  comprobantesTable,
  clientesTable,
  seguimientosCobranzaTable,
  pagosParciales,
  recordatoriosTable,
  recordatoriosEnviadosTable,
  usersTable,
  comprobantesTransferenciaTable,
  gestionesCobranzaTable,
  saludCarteraSnapshotsTable,
} from "@workspace/db";
import type { Cobro, CobroDescuento, CobroAjuste } from "@workspace/db";
import { eq, desc, sql, and, gte, isNull, isNotNull, or, lt, inArray } from "drizzle-orm";
import {
  CreateCobroBody,
  UpdateCobroBody,
  GetCobroParams,
  UpdateCobroParams,
  CreateRecordatorioBody,
  UpdateRecordatorioBody,
  AplicarDescuentoBody,
  AjustarMontoBody,
  EliminarCobroBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { getFlowCredentials, getMpCredentials } from "./profile";
import { crearOrdenFlow, getPublicBaseUrl } from "../lib/flow-api";
import { crearPreferenciaMp } from "../lib/mp-api";
import { sendPaymentLinkEmail, sendRecordatorioEmail, sendAvisoManualEmail } from "../lib/email";
import { requireSubscription } from "../middlewares/requireSubscription";
import { aplicarDefaultsACobro } from "../lib/recordatorios";
import { emitirComprobante } from "../lib/comprobante-service";
import { getOrgContext, cobroScopeCondition, clienteScopeCondition, userCanAccessCobro, userCanAccessCliente, getRemitenteContacto, canAssignTo } from "../lib/org";
import { getDatosBancariosUsuario, buildDatosBancariosHtml } from "../lib/datos-bancarios";
import { computeClienteScores } from "../lib/scoring";
import { userTieneFeature } from "../middlewares/requirePlanFeature";
import { buscarSnapshotPrevio, calcularBloquesUsuario, hoySantiagoStr, sumarDias as sumarDiasSantiago } from "../lib/salud-cartera";

const cobrosRouter = Router();

type TipoDocumento = Cobro["tipoDocumento"];

// Only "afecta" Chilean electronic documents may carry IVA. Exenta documents
// and informal charges (sin_documento) never do.
function tipoDocumentoPermiteIva(tipo: TipoDocumento): boolean {
  return tipo === "factura_afecta" || tipo === "boleta_afecta";
}

// Net amount to charge after the current effective discount.
function montoACobrar(cobro: Pick<Cobro, "monto" | "montoDescuento">): number {
  return Number(cobro.monto) - Number(cobro.montoDescuento ?? 0);
}

// Computes the charged total and IVA breakdown for an entered amount. When IVA
// applies, the entered value is the NETO and the server derives iva + total so
// CLP integer rounding stays server-side (mirrors POST /cobros).
function computeMontoConIva(
  montoEntrada: number,
  aplicaIva: boolean,
): { montoFinal: number; montoNeto: number | null; montoIva: number | null } {
  if (!aplicaIva) return { montoFinal: montoEntrada, montoNeto: null, montoIva: null };
  const montoNeto = Math.round(montoEntrada);
  const montoIva = Math.round(montoNeto * 0.19);
  return { montoFinal: montoNeto + montoIva, montoNeto, montoIva };
}

function serializeAjuste(a: CobroAjuste) {
  return {
    id: a.id,
    cobroId: a.cobroId,
    montoOriginal: Number(a.montoOriginal),
    montoNuevo: Number(a.montoNuevo),
    motivo: a.motivo,
    ajustadoPorNombre: a.ajustadoPorNombre ?? null,
    creadoEn: a.creadoEn.toISOString(),
  };
}

// Standard JSON serialization for a cobro response (numeric + date conversions
// plus the derived montoACobrar field). When `abonado` (sum of confirmed partial
// payments) is provided, the outstanding `saldo` is included; for terminal states
// the saldo is always 0. When omitted, `saldo` is left undefined (dropped from JSON).
function serializeCobro(cobro: Cobro, abonado?: number) {
  const aCobrar = montoACobrar(cobro);
  const terminal =
    cobro.estado === "pagado" || cobro.estado === "cancelado" || cobro.estado === "fallido";
  const saldo =
    abonado === undefined ? undefined : terminal ? 0 : Math.max(aCobrar - abonado, 0);
  return {
    ...cobro,
    monto: Number(cobro.monto),
    montoDescuento: cobro.montoDescuento != null ? Number(cobro.montoDescuento) : null,
    montoACobrar: aCobrar,
    saldo,
    incluyeIva: cobro.incluyeIva,
    montoNeto: cobro.montoNeto != null ? Number(cobro.montoNeto) : null,
    montoIva: cobro.montoIva != null ? Number(cobro.montoIva) : null,
    pagadoEn: cobro.pagadoEn ? cobro.pagadoEn.toISOString() : null,
    creadoEn: cobro.creadoEn.toISOString(),
    actualizadoEn: cobro.actualizadoEn.toISOString(),
  };
}

// Sums confirmed partial payments (abonos) per cobro id, returning a map.
async function abonadoPorCobro(cobroIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (cobroIds.length === 0) return map;
  const sums = await db
    .select({
      cobroId: pagosParciales.cobroId,
      total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
    })
    .from(pagosParciales)
    .where(and(eq(pagosParciales.estado, "confirmado"), inArray(pagosParciales.cobroId, cobroIds)))
    .groupBy(pagosParciales.cobroId);
  for (const s of sums) map.set(s.cobroId, s.total);
  return map;
}

function serializeDescuento(d: CobroDescuento) {
  return {
    id: d.id,
    cobroId: d.cobroId,
    tipo: d.tipo,
    valor: Number(d.valor),
    montoDescuento: Number(d.montoDescuento),
    montoOriginal: Number(d.montoOriginal),
    montoFinal: Number(d.montoFinal),
    motivo: d.motivo,
    fechaVigencia: d.fechaVigencia ?? null,
    aplicadoPorNombre: d.aplicadoPorNombre ?? null,
    creadoEn: d.creadoEn.toISOString(),
  };
}

async function recalcularEstadoCobro(
  cobroId: number,
): Promise<"pagado" | "parcial" | "pendiente" | null> {
  const [result] = await db
    .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
    .from(pagosParciales)
    .where(and(eq(pagosParciales.cobroId, cobroId), eq(pagosParciales.estado, "confirmado")));
  const [cobro] = await db
    .select({ monto: cobrosTable.monto, montoDescuento: cobrosTable.montoDescuento })
    .from(cobrosTable)
    .where(eq(cobrosTable.id, cobroId));
  if (!cobro) return null;
  const totalPagado = result?.total ?? 0;
  const montoTotal = montoACobrar(cobro);
  const nuevoEstado: "pagado" | "parcial" | "pendiente" =
    totalPagado >= montoTotal ? "pagado" : totalPagado > 0 ? "parcial" : "pendiente";
  await db
    .update(cobrosTable)
    .set({
      estado: nuevoEstado,
      actualizadoEn: new Date(),
      // Set pagadoEn on first transition to pagado; clear it if the state drops back.
      pagadoEn:
        nuevoEstado === "pagado"
          ? sql`coalesce(${cobrosTable.pagadoEn}, now())`
          : null,
    })
    .where(eq(cobrosTable.id, cobroId));
  return nuevoEstado;
}

// Authorization guard for any /cobros/:id/* route. Loads the org context and the
// cobro's scope fields, returning true only when the user may access it
// (admin_org in same org, or the assigned ejecutivo). Returns false for both
// missing and forbidden cobros so callers respond 404 without leaking existence.
async function userMayAccessCobroId(userId: string, cobroId: number): Promise<boolean> {
  const ctx = await getOrgContext(userId);
  const [row] = await db
    .select({
      organizationId: cobrosTable.organizationId,
      responsableId: cobrosTable.responsableId,
    })
    .from(cobrosTable)
    .where(eq(cobrosTable.id, cobroId));
  if (!row) return false;
  return userCanAccessCobro(ctx, userId, row);
}

cobrosRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});
cobrosRouter.use(requireSubscription);

cobrosRouter.get("/cobros", async (req, res) => {
  const estado = req.query.estado as string | undefined;
  const metodo = req.query.metodo as string | undefined;
  const responsable = typeof req.query.responsable === "string" ? req.query.responsable : undefined;
  const userId = req.user!.id;

  try {
    const ctx = await getOrgContext(userId);
    const conditions = [];
    const scope = cobroScopeCondition(ctx, userId, responsable);
    if (scope) conditions.push(scope);
    if (estado && ["pendiente", "pagado", "parcial", "fallido", "cancelado"].includes(estado)) {
      conditions.push(eq(cobrosTable.estado, estado as "pendiente" | "pagado" | "parcial" | "fallido" | "cancelado"));
    }
    if (metodo === "flow") conditions.push(isNotNull(cobrosTable.flowLinkPago));
    else if (metodo === "mp") conditions.push(isNotNull(cobrosTable.mpPaymentLinkUrl));
    else if (metodo === "link") conditions.push(or(isNotNull(cobrosTable.flowLinkPago), isNotNull(cobrosTable.mpPaymentLinkUrl))!);
    else if (metodo === "manual") conditions.push(and(isNull(cobrosTable.flowLinkPago), isNull(cobrosTable.mpPaymentLinkUrl))!);

    const cobros = await db
      .select()
      .from(cobrosTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(cobrosTable.creadoEn));

    const abonado = await abonadoPorCobro(cobros.map((c) => c.id));
    res.json(cobros.map((c) => serializeCobro(c, abonado.get(c.id) ?? 0)));
  } catch (err) {
    req.log.error({ err }, "Error listing cobros");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.post("/cobros", async (req, res) => {
  const parsed = CreateCobroBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { monto, descripcion, referencia } = parsed.data;
  const tipoDocumento =
    ((parsed.data as Record<string, unknown>).tipoDocumento as TipoDocumento | undefined) ??
    "sin_documento";
  // Only "afecta" electronic documents may carry IVA. Exenta / sin_documento
  // charges never do, regardless of what the client sent.
  const incluyeIva =
    tipoDocumentoPermiteIva(tipoDocumento) &&
    (parsed.data as Record<string, unknown>).incluyeIva === true;
  const emailPagador = (parsed.data as Record<string, unknown>).emailPagador as string | undefined;
  const clienteId = (parsed.data as Record<string, unknown>).clienteId as number | undefined;
  const fechaVencimiento = (parsed.data as Record<string, unknown>).fechaVencimiento as string | undefined;
  const responsableIdInput = (parsed.data as Record<string, unknown>).responsableId as string | undefined;
  const user = req.isAuthenticated() ? req.user : null;

  try {
    const ctx = user ? await getOrgContext(user.id) : null;

    // Determine who the cobro is assigned to. Org admins may assign a cobro to
    // any member of their organization; supervisors only to members of their
    // team; otherwise it defaults to the creator.
    let responsableId: string | null = user?.id ?? null;
    let responsableNombre: string | null = user
      ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null
      : null;

    if (responsableIdInput && responsableIdInput !== user?.id) {
      if (
        !ctx ||
        ctx.organizationId == null ||
        !user ||
        !canAssignTo(ctx, user.id, responsableIdInput)
      ) {
        res.status(403).json({ error: "No puedes asignar cobros a otros usuarios." });
        return;
      }
      const [assignee] = await db
        .select()
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, responsableIdInput),
            eq(usersTable.organizationId, ctx.organizationId),
          ),
        );
      if (!assignee) {
        res.status(400).json({ error: "El responsable no pertenece a tu organización." });
        return;
      }
      responsableId = assignee.id;
      responsableNombre =
        [assignee.firstName, assignee.lastName].filter(Boolean).join(" ") || assignee.email || null;
    }

    // Optionally resolve client name if clienteId provided. The client must be
    // accessible to the creator (own client, or any client in the org for
    // admin_org) to prevent cross-tenant association/leakage.
    let clienteNombre: string | null = null;
    if (clienteId) {
      const [cliente] = await db.select().from(clientesTable).where(eq(clientesTable.id, clienteId));
      if (!cliente || !ctx || !userCanAccessCliente(ctx, user!.id, cliente)) {
        res.status(404).json({ error: "Cliente no encontrado" });
        return;
      }
      clienteNombre = cliente.nombre;
    }

    // IVA (Chilean VAT 19%). When enabled, the entered `monto` is the NETO; the
    // server computes IVA and total so CLP integer rounding stays server-side.
    // The charged amount (`monto` column) is always the total to charge.
    let montoFinal = monto;
    let montoNeto: number | null = null;
    let montoIva: number | null = null;
    if (incluyeIva) {
      montoNeto = Math.round(monto);
      montoIva = Math.round(montoNeto * 0.19);
      montoFinal = montoNeto + montoIva;
    }

    const [cobro] = await db
      .insert(cobrosTable)
      .values({
        monto: String(montoFinal),
        incluyeIva,
        montoNeto: montoNeto != null ? String(montoNeto) : null,
        montoIva: montoIva != null ? String(montoIva) : null,
        tipoDocumento,
        descripcion,
        referencia: referencia ?? null,
        estado: "pendiente",
        responsableId,
        responsableNombre,
        organizationId: ctx?.organizationId ?? null,
        clienteId: clienteId ?? null,
        clienteNombre,
        emailPagador: emailPagador ?? null,
        fechaVencimiento: fechaVencimiento ?? null,
      })
      .returning();

    // Seed the user's default reminder sequence onto cobros that have a due date.
    if (cobro.fechaVencimiento && user?.id) {
      try {
        await aplicarDefaultsACobro(cobro.id, user.id);
      } catch (err) {
        req.log.warn({ err, cobroId: cobro.id }, "No se pudo aplicar la secuencia de recordatorios por defecto");
      }
    }

    res.status(201).json(serializeCobro(cobro));
  } catch (err) {
    req.log.error({ err }, "Error creating cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.get("/cobros/stats/summary", async (req, res) => {
  const userId = req.user!.id;
  const responsable = typeof req.query.responsable === "string" ? req.query.responsable : undefined;
  try {
    const ctx = await getOrgContext(userId);
    const scope = cobroScopeCondition(ctx, userId, responsable);
    const rows = await db
      .select({
        estado: cobrosTable.estado,
        cantidad: sql<number>`count(*)::int`,
        monto: sql<number>`sum(${cobrosTable.monto})::float`,
      })
      .from(cobrosTable)
      .where(scope)
      .groupBy(cobrosTable.estado);

    const total = rows.reduce((acc, r) => acc + r.cantidad, 0);
    const montoTotal = rows.reduce((acc, r) => acc + (r.monto ?? 0), 0);

    res.json({
      total,
      montoTotal,
      porEstado: rows.map((r) => ({
        estado: r.estado,
        cantidad: r.cantidad,
        monto: r.monto ?? 0,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting cobros summary");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.get("/cobros/:id", async (req, res) => {
  const parsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, parsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, parsed.data.id));

    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    const abonado = await abonadoPorCobro([cobro.id]);
    res.json(serializeCobro(cobro, abonado.get(cobro.id) ?? 0));
  } catch (err) {
    req.log.error({ err }, "Error getting cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- Descuentos ---

cobrosRouter.get("/cobros/:id/descuentos", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const [cobro] = await db
      .select({ id: cobrosTable.id })
      .from(cobrosTable)
      .where(eq(cobrosTable.id, paramsParsed.data.id));
    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    const descuentos = await db
      .select()
      .from(cobroDescuentosTable)
      .where(eq(cobroDescuentosTable.cobroId, paramsParsed.data.id))
      .orderBy(desc(cobroDescuentosTable.creadoEn));
    res.json(descuentos.map(serializeDescuento));
  } catch (err) {
    req.log.error({ err }, "Error listing descuentos");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.post("/cobros/:id/descuentos", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const bodyParsed = AplicarDescuentoBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const { tipo, valor, motivo, fechaVigencia } = bodyParsed.data;
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, paramsParsed.data.id));
    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    if (cobro.estado === "pagado" || cobro.estado === "cancelado") {
      res.status(400).json({ error: "No se puede aplicar un descuento a un cobro pagado o cancelado." });
      return;
    }

    const montoOriginal = Number(cobro.monto);
    if (tipo === "porcentaje" && valor > 100) {
      res.status(400).json({ error: "El porcentaje de descuento no puede ser mayor a 100." });
      return;
    }

    const descuentoAbsoluto =
      tipo === "porcentaje" ? Math.round((montoOriginal * valor) / 100) : Math.round(valor);

    if (descuentoAbsoluto <= 0) {
      res.status(400).json({ error: "El descuento debe ser mayor a 0." });
      return;
    }
    if (descuentoAbsoluto >= montoOriginal) {
      res.status(400).json({ error: "El descuento no puede ser igual o mayor al monto original del cobro." });
      return;
    }

    const montoFinal = montoOriginal - descuentoAbsoluto;
    const user = req.user!;
    const aplicadoPorNombre =
      [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null;

    await db.insert(cobroDescuentosTable).values({
      cobroId: cobro.id,
      tipo,
      valor: String(valor),
      montoDescuento: String(descuentoAbsoluto),
      montoOriginal: String(montoOriginal),
      montoFinal: String(montoFinal),
      motivo,
      fechaVigencia: fechaVigencia ?? null,
      aplicadoPorId: user.id,
      aplicadoPorNombre,
    });

    const [updated] = await db
      .update(cobrosTable)
      .set({ montoDescuento: String(descuentoAbsoluto), actualizadoEn: new Date() })
      .where(eq(cobrosTable.id, cobro.id))
      .returning();

    // Re-evaluate estado in case confirmed abonos already cover the new lower amount.
    const estadoTrasDescuento = await recalcularEstadoCobro(cobro.id);
    if (estadoTrasDescuento === "pagado") {
      void emitirComprobante(cobro.id, { metodo: "manual" }, req.log);
    }
    const [refreshed] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobro.id));

    req.log.info(
      { cobroId: cobro.id, tipo, descuentoAbsoluto, montoFinal },
      "Descuento aplicado al cobro",
    );
    res.json(serializeCobro(refreshed ?? updated));
  } catch (err) {
    req.log.error({ err }, "Error applying descuento");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Amount-adjustment history for a cobro (records of lowering the total under
// partial payments). Newest first.
cobrosRouter.get("/cobros/:id/ajustes", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const ajustes = await db
      .select()
      .from(cobroAjustesTable)
      .where(eq(cobroAjustesTable.cobroId, paramsParsed.data.id))
      .orderBy(desc(cobroAjustesTable.creadoEn));
    res.json(ajustes.map(serializeAjuste));
  } catch (err) {
    req.log.error({ err }, "Error listing ajustes");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Adjust (lower) the total amount of a cobro that already has confirmed partial
// payments. The new amount must be >= what was already paid; if it equals the
// paid amount the cobro becomes "pagado". Every adjustment is recorded with an
// obligatory reason. IVA is recomputed treating the entered value the same way as
// the current cobro (net when incluyeIva, otherwise the final charge).
cobrosRouter.post("/cobros/:id/ajustar-monto", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const bodyParsed = AjustarMontoBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const { monto: montoEntrada, motivo } = bodyParsed.data;
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  const user = req.user!;
  const ajustadoPorNombre =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null;

  try {
    // Validate + write inside a single transaction, locking the cobro row so a
    // concurrent abono confirmation can't slip past the `>= pagado` check.
    type AjusteResult =
      | { ok: false; status: number; error: string }
      | { ok: true; cobroId: number; montoOriginal: number; montoNuevo: number; totalPagado: number };
    const result: AjusteResult = await db.transaction(async (tx): Promise<AjusteResult> => {
      const [cobro] = await tx
        .select()
        .from(cobrosTable)
        .where(eq(cobrosTable.id, paramsParsed.data.id))
        .for("update");
      if (!cobro) {
        return { ok: false, status: 404, error: "Cobro no encontrado" };
      }
      if (cobro.estado !== "parcial") {
        return {
          ok: false,
          status: 400,
          error: "Solo puedes ajustar el monto total de un cobro con pagos parciales.",
        };
      }

      const [sumRow] = await tx
        .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
        .from(pagosParciales)
        .where(and(eq(pagosParciales.cobroId, cobro.id), eq(pagosParciales.estado, "confirmado")));
      const totalPagado = sumRow?.total ?? 0;

      const { montoFinal, montoNeto, montoIva } = computeMontoConIva(montoEntrada, cobro.incluyeIva);

      if (montoFinal < totalPagado) {
        return {
          ok: false,
          status: 400,
          error: `El nuevo monto ($${montoFinal.toLocaleString("es-CL")}) no puede ser menor a lo ya pagado ($${totalPagado.toLocaleString("es-CL")}).`,
        };
      }
      if (montoFinal >= montoACobrar(cobro)) {
        return {
          ok: false,
          status: 400,
          error: "El nuevo monto debe ser menor al monto actual del cobro.",
        };
      }

      const montoOriginal = Number(cobro.monto);

      await tx.insert(cobroAjustesTable).values({
        cobroId: cobro.id,
        montoOriginal: String(montoOriginal),
        montoNuevo: String(montoFinal),
        motivo,
        ajustadoPorId: user.id,
        ajustadoPorNombre,
      });

      // Lowering the total resets any prior discount (the discount was relative to
      // the old total) and invalidates existing payment links.
      await tx
        .update(cobrosTable)
        .set({
          monto: String(montoFinal),
          montoNeto: montoNeto != null ? String(montoNeto) : null,
          montoIva: montoIva != null ? String(montoIva) : null,
          montoDescuento: null,
          flowOrdenId: null,
          flowToken: null,
          flowLinkPago: null,
          mpPreferenceId: null,
          mpPaymentLinkUrl: null,
          actualizadoEn: new Date(),
        })
        .where(eq(cobrosTable.id, cobro.id));

      return { ok: true, cobroId: cobro.id, montoOriginal, montoNuevo: montoFinal, totalPagado };
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const estadoTras = await recalcularEstadoCobro(result.cobroId);
    if (estadoTras === "pagado") {
      void emitirComprobante(result.cobroId, { metodo: "manual" }, req.log);
    }
    const [refreshed] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, result.cobroId));

    req.log.info(
      { cobroId: result.cobroId, montoOriginal: result.montoOriginal, montoNuevo: result.montoNuevo, totalPagado: result.totalPagado },
      "Monto ajustado en cobro con pagos parciales",
    );
    if (!refreshed) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    res.json(serializeCobro(refreshed, result.totalPagado));
  } catch (err) {
    req.log.error({ err }, "Error adjusting monto");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Hard-delete a cobro and its children. Blocked when the cobro is paid or already
// has confirmed partial payments (real money received). Writes a snapshot to the
// superadmin deletion audit log. The associated cliente is NOT deleted.
cobrosRouter.delete("/cobros/:id", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const bodyParsed = EliminarCobroBody.safeParse(req.body ?? {});
  const motivo =
    bodyParsed.success && typeof bodyParsed.data.motivo === "string" && bodyParsed.data.motivo.trim()
      ? bodyParsed.data.motivo.trim()
      : null;
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  const user = req.user!;
  const eliminadoPorNombre =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null;

  try {
    // Validate + delete inside a single transaction, locking the cobro row so a
    // concurrent abono confirmation can't attach money to a cobro we're deleting.
    type DeleteResult =
      | { ok: false; status: number; error: string }
      | { ok: true; cobroId: number; estado: string };
    const deleted: DeleteResult = await db.transaction(async (tx): Promise<DeleteResult> => {
      const [cobro] = await tx
        .select()
        .from(cobrosTable)
        .where(eq(cobrosTable.id, paramsParsed.data.id))
        .for("update");
      if (!cobro) {
        return { ok: false, status: 404, error: "Cobro no encontrado" };
      }
      if (cobro.estado === "pagado") {
        return { ok: false, status: 400, error: "No puedes eliminar un cobro pagado." };
      }

      const [sumRow] = await tx
        .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
        .from(pagosParciales)
        .where(and(eq(pagosParciales.cobroId, cobro.id), eq(pagosParciales.estado, "confirmado")));
      if ((sumRow?.total ?? 0) > 0) {
        return { ok: false, status: 400, error: "No puedes eliminar un cobro con pagos registrados." };
      }

      await tx.insert(cobrosEliminadosTable).values({
        cobroIdOriginal: cobro.id,
        monto: cobro.monto,
        montoACobrar: String(montoACobrar(cobro)),
        estado: cobro.estado,
        descripcion: cobro.descripcion,
        clienteId: cobro.clienteId ?? null,
        clienteNombre: cobro.clienteNombre ?? null,
        organizationId: cobro.organizationId ?? null,
        motivo,
        eliminadoPorId: user.id,
        eliminadoPorNombre,
      });
      // comprobantes has no FK cascade — delete manually before the cobro.
      await tx.delete(comprobantesTable).where(eq(comprobantesTable.cobroId, cobro.id));
      // The rest of the children cascade on cobro delete.
      await tx.delete(cobrosTable).where(eq(cobrosTable.id, cobro.id));
      return { ok: true, cobroId: cobro.id, estado: cobro.estado };
    });

    if (!deleted.ok) {
      res.status(deleted.status).json({ error: deleted.error });
      return;
    }

    req.log.info({ cobroId: deleted.cobroId, estado: deleted.estado }, "Cobro eliminado");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const GenerarFlowLinkInput = z.object({
  emailPagador: z.string().email("Email inválido"),
});

cobrosRouter.post("/cobros/:id/flow-link", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const bodyParsed = GenerarFlowLinkInput.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const { emailPagador } = bodyParsed.data;
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, paramsParsed.data.id));

    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    if (cobro.flowLinkPago) {
      res.json({ linkPago: cobro.flowLinkPago, flowOrdenId: cobro.flowOrdenId! });
      return;
    }

    const creds = await getFlowCredentials(userId);
    if (!creds) {
      res.status(400).json({ error: "No tienes credenciales de Flow configuradas. Ve a tu perfil para configurarlas." });
      return;
    }

    const baseUrl = getPublicBaseUrl();
    req.log.info({ baseUrl }, "Generating Flow payment link");

    const result = await crearOrdenFlow(creds.apiKey, creds.secretKey, {
      commerceOrder: `cobro-${cobro.id}`,
      subject: cobro.descripcion.slice(0, 200),
      currency: "CLP",
      amount: Math.round(montoACobrar(cobro)),
      email: bodyParsed.data.emailPagador,
      urlConfirmation: `${baseUrl}/api/webhooks/flow`,
      urlReturn: `${baseUrl}/cobros/${cobro.id}`,
    });

    const [updated] = await db
      .update(cobrosTable)
      .set({
        flowOrdenId: String(result.flowOrder),
        flowToken: result.token,
        flowLinkPago: result.url,
        emailPagador: bodyParsed.data.emailPagador,
        actualizadoEn: new Date(),
      })
      .where(eq(cobrosTable.id, cobro.id))
      .returning();

    req.log.info({ cobroId: cobro.id, flowOrder: result.flowOrder }, "Flow payment link created");

    // Send payment link email asynchronously (non-blocking)
    const remitente = await getRemitenteContacto(cobro.responsableId);
    sendPaymentLinkEmail({
      emailPagador: bodyParsed.data.emailPagador,
      clienteNombre: cobro.clienteNombre,
      descripcion: cobro.descripcion,
      monto: montoACobrar(cobro),
      linkPago: result.url,
      comercioNombre: cobro.responsableNombre || "NextCob",
      remitenteNombre: remitente.nombre || cobro.responsableNombre,
      remitenteEmail: remitente.email,
    }, req.log).catch((err) => {
      req.log.warn({ err }, "Unhandled error in payment link email");
    });

    res.json({ linkPago: updated.flowLinkPago!, flowOrdenId: updated.flowOrdenId! });
  } catch (err) {
    req.log.error({ err }, "Error creating Flow payment link");
    res.status(500).json({ error: `Error al crear orden en Flow: ${err instanceof Error ? err.message : String(err)}` });
  }
});

cobrosRouter.post("/cobros/:id/mp-link", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, paramsParsed.data.id));

    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    if (cobro.mpPaymentLinkUrl) {
      res.json({ linkPago: cobro.mpPaymentLinkUrl, preferenceId: cobro.mpPreferenceId! });
      return;
    }

    const accessToken = await getMpCredentials(userId);
    if (!accessToken) {
      res.status(400).json({ error: "No tienes credenciales de MercadoPago configuradas. Ve a tu perfil para configurarlas." });
      return;
    }

    const baseUrl = getPublicBaseUrl();
    req.log.info({ baseUrl }, "Generating MercadoPago payment link");

    const result = await crearPreferenciaMp(accessToken, {
      title: cobro.descripcion.slice(0, 256),
      quantity: 1,
      unitPrice: Math.round(montoACobrar(cobro)),
      externalReference: `cobro-${cobro.id}`,
      notificationUrl: `${baseUrl}/api/webhooks/mercadopago`,
      backUrl: `${baseUrl}/cobros/${cobro.id}`,
    });

    const [updated] = await db
      .update(cobrosTable)
      .set({
        mpPreferenceId: result.preferenceId,
        mpPaymentLinkUrl: result.initPoint,
        actualizadoEn: new Date(),
      })
      .where(eq(cobrosTable.id, cobro.id))
      .returning();

    req.log.info({ cobroId: cobro.id, preferenceId: result.preferenceId }, "MercadoPago payment link created");
    res.json({ linkPago: updated.mpPaymentLinkUrl!, preferenceId: updated.mpPreferenceId! });
  } catch (err) {
    req.log.error({ err }, "Error creating MercadoPago payment link");
    res.status(500).json({ error: `Error al crear preferencia en MercadoPago: ${err instanceof Error ? err.message : String(err)}` });
  }
});

cobrosRouter.post("/cobros/:id/recordatorio-email", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, paramsParsed.data.id));

    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    if (!cobro.emailPagador) {
      res.status(400).json({ error: "El cobro no tiene email del pagador registrado." });
      return;
    }

    const linkPago = cobro.flowLinkPago ?? cobro.mpPaymentLinkUrl;
    if (!linkPago) {
      res.status(400).json({ error: "El cobro no tiene link de pago generado. Genera un link de pago primero." });
      return;
    }

    const remitente = await getRemitenteContacto(cobro.responsableId);
    const result = await sendRecordatorioEmail({
      emailPagador: cobro.emailPagador,
      clienteNombre: cobro.clienteNombre,
      descripcion: cobro.descripcion,
      monto: Number(cobro.monto),
      linkPago,
      comercioNombre: cobro.responsableNombre || "NextCob",
      remitenteNombre: remitente.nombre || cobro.responsableNombre,
      remitenteEmail: remitente.email,
    }, req.log);

    if (!result.ok) {
      req.log.warn({ cobroId: cobro.id, emailError: result.error }, "Reminder email failed");
      res.status(500).json({ error: result.error ?? "No se pudo enviar el email." });
      return;
    }

    req.log.info({ cobroId: cobro.id, emailPagador: cobro.emailPagador }, "Reminder email sent");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error sending reminder email");
    res.status(500).json({ error: "Error interno al enviar recordatorio." });
  }
});

const AvisarClienteBody = z.object({
  tipo: z.enum(["email", "whatsapp"]),
  notas: z.string().optional(),
});

cobrosRouter.post("/cobros/:id/avisar", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const bodyParsed = AvisarClienteBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const { tipo, notas } = bodyParsed.data;
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  try {
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, paramsParsed.data.id));
    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    let emailEnviado = false;
    let emailError: string | undefined;

    if (tipo === "email") {
      if (!cobro.emailPagador) {
        res.status(400).json({ error: "El cobro no tiene email del pagador registrado." });
        return;
      }
      const remitente = await getRemitenteContacto(cobro.responsableId);
      const esManual = !cobro.flowLinkPago && !cobro.mpPaymentLinkUrl;
      const datosBancarios = esManual ? await getDatosBancariosUsuario(cobro.responsableId) : null;
      const emailResult = await sendAvisoManualEmail(
        {
          datosBancariosHtml: datosBancarios ? buildDatosBancariosHtml(datosBancarios) : null,
          emailPagador: cobro.emailPagador,
          clienteNombre: cobro.clienteNombre,
          descripcion: cobro.descripcion,
          monto: Number(cobro.monto),
          comercioNombre: cobro.responsableNombre ?? "NextCob",
          remitenteNombre: remitente.nombre || cobro.responsableNombre,
          remitenteEmail: remitente.email,
        },
        req.log,
      );
      emailEnviado = emailResult.ok;
      emailError = emailResult.error;
    }

    const [seg] = await db
      .insert(seguimientosCobranzaTable)
      .values({
        cobroId: cobro.id,
        tipo,
        notas: notas ?? (tipo === "email" ? "Aviso enviado por email" : "Aviso por WhatsApp"),
        creadoEn: new Date(),
      })
      .returning();

    req.log.info({ cobroId: cobro.id, tipo, emailEnviado }, "Aviso de cobranza registrado");
    res.json({ ok: true, seguimientoId: seg.id, emailEnviado, emailError });
  } catch (err) {
    req.log.error({ err }, "Error en aviso de cobranza");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.get("/cobros/:id/seguimientos", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  try {
    const [cobro] = await db
      .select({ id: cobrosTable.id })
      .from(cobrosTable)
      .where(eq(cobrosTable.id, paramsParsed.data.id));
    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    const seguimientos = await db
      .select()
      .from(seguimientosCobranzaTable)
      .where(eq(seguimientosCobranzaTable.cobroId, paramsParsed.data.id))
      .orderBy(desc(seguimientosCobranzaTable.creadoEn));

    res.json(
      seguimientos.map((s) => ({
        ...s,
        creadoEn: s.creadoEn.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing seguimientos");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.patch("/cobros/:id", async (req, res) => {
  const paramsParsed = UpdateCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const bodyParsed = UpdateCobroBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  const [current] = await db
    .select()
    .from(cobrosTable)
    .where(eq(cobrosTable.id, paramsParsed.data.id));
  if (!current) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }

  const body = bodyParsed.data as Record<string, unknown>;
  const fechaVencimiento = body.fechaVencimiento as string | null | undefined;
  const montoInput = body.monto as number | undefined;
  const incluyeIvaInput = body.incluyeIva as boolean | undefined;
  const tipoDocumentoInput = body.tipoDocumento as TipoDocumento | undefined;
  const clienteIdInput = body.clienteId as number | null | undefined;
  const responsableIdInput = body.responsableId as string | undefined;

  // "Edit" fields (as opposed to estado/status transitions and due-date changes)
  // may only be modified while the cobro is still pendiente. A "vencido" cobro is
  // simply a pendiente one past its due date, so it passes this check too. Amount
  // changes on a cobro WITH partial payments go through POST /cobros/:id/ajustar-monto.
  const editFieldsPresent =
    montoInput !== undefined ||
    incluyeIvaInput !== undefined ||
    bodyParsed.data.descripcion !== undefined ||
    bodyParsed.data.referencia !== undefined ||
    tipoDocumentoInput !== undefined ||
    clienteIdInput !== undefined ||
    responsableIdInput !== undefined;
  if (editFieldsPresent && current.estado !== "pendiente") {
    res.status(400).json({
      error:
        current.estado === "parcial"
          ? "Este cobro tiene pagos parciales. Ajusta el monto o aplica un descuento al saldo desde las opciones de pagos parciales."
          : "Solo puedes editar un cobro pendiente.",
    });
    return;
  }

  // Resetting estado to "pendiente" would re-open full editing (see gate above),
  // so it must be blocked whenever the cobro has received money. Otherwise a
  // caller could do parcial→pendiente and then freely edit the amount, bypassing
  // the audited ajustar-monto flow.
  if (bodyParsed.data.estado === "pendiente" && current.estado !== "pendiente") {
    const [abonoRow] = await db
      .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
      .from(pagosParciales)
      .where(and(eq(pagosParciales.cobroId, current.id), eq(pagosParciales.estado, "confirmado")));
    if ((abonoRow?.total ?? 0) > 0) {
      res.status(400).json({
        error: "No puedes volver a pendiente un cobro con pagos registrados.",
      });
      return;
    }
  }

  const updates: Record<string, unknown> = {
    actualizadoEn: new Date(),
  };

  if (bodyParsed.data.estado !== undefined) {
    updates.estado = bodyParsed.data.estado;
    // Record when the cobro was confirmed as paid (keep the first timestamp);
    // clear it if the estado moves away from pagado.
    updates.pagadoEn =
      bodyParsed.data.estado === "pagado"
        ? sql`coalesce(${cobrosTable.pagadoEn}, now())`
        : null;
  }
  if (bodyParsed.data.descripcion !== undefined) updates.descripcion = bodyParsed.data.descripcion;
  if (bodyParsed.data.referencia !== undefined) updates.referencia = bodyParsed.data.referencia ?? null;
  if (fechaVencimiento !== undefined) updates.fechaVencimiento = fechaVencimiento;

  if (tipoDocumentoInput !== undefined) updates.tipoDocumento = tipoDocumentoInput;

  // Resolve the effective document type and whether IVA applies after this edit.
  const effectiveTipo = tipoDocumentoInput ?? current.tipoDocumento;
  const effectiveIncluyeIva =
    tipoDocumentoPermiteIva(effectiveTipo) && (incluyeIvaInput ?? current.incluyeIva);

  if (montoInput !== undefined) {
    // Recompute the charged total and IVA breakdown from the entered amount, reset
    // any prior discount (it was relative to the old total) and invalidate existing
    // payment links (the client must generate new ones for the new amount).
    const { montoFinal, montoNeto, montoIva } = computeMontoConIva(montoInput, effectiveIncluyeIva);
    updates.monto = String(montoFinal);
    updates.incluyeIva = effectiveIncluyeIva;
    updates.montoNeto = montoNeto != null ? String(montoNeto) : null;
    updates.montoIva = montoIva != null ? String(montoIva) : null;
    updates.montoDescuento = null;
    updates.flowOrdenId = null;
    updates.flowToken = null;
    updates.flowLinkPago = null;
    updates.mpPreferenceId = null;
    updates.mpPaymentLinkUrl = null;
  } else if (incluyeIvaInput !== undefined || tipoDocumentoInput !== undefined) {
    // No new amount, but the IVA applicability may have changed. Recompute the
    // breakdown/total from the current net so the charged amount stays consistent.
    const netoActual =
      current.montoNeto != null
        ? Number(current.montoNeto)
        : current.incluyeIva && current.montoIva != null
          ? Number(current.monto) - Number(current.montoIva)
          : Number(current.monto);
    const { montoFinal, montoNeto, montoIva } = computeMontoConIva(netoActual, effectiveIncluyeIva);
    updates.incluyeIva = effectiveIncluyeIva;
    updates.montoNeto = montoNeto != null ? String(montoNeto) : null;
    updates.montoIva = montoIva != null ? String(montoIva) : null;
    updates.monto = String(montoFinal);
  }

  // Reassociate the cliente (or clear it). Must be accessible to the user.
  if (clienteIdInput !== undefined) {
    if (clienteIdInput === null) {
      updates.clienteId = null;
      updates.clienteNombre = null;
    } else {
      const ctx = await getOrgContext(userId);
      const [cliente] = await db
        .select()
        .from(clientesTable)
        .where(eq(clientesTable.id, clienteIdInput));
      if (!cliente || !userCanAccessCliente(ctx, userId, cliente)) {
        res.status(404).json({ error: "Cliente no encontrado" });
        return;
      }
      updates.clienteId = cliente.id;
      updates.clienteNombre = cliente.nombre;
    }
  }

  // Reassign the responsable. Org admins may assign to any member of their
  // organization; supervisors only within their team.
  if (responsableIdInput !== undefined && responsableIdInput !== current.responsableId) {
    const ctx = await getOrgContext(userId);
    if (ctx.organizationId == null || !canAssignTo(ctx, userId, responsableIdInput)) {
      res.status(403).json({ error: "No puedes reasignar cobros a otros usuarios." });
      return;
    }
    const [assignee] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, responsableIdInput), eq(usersTable.organizationId, ctx.organizationId)));
    if (!assignee) {
      res.status(400).json({ error: "El responsable no pertenece a tu organización." });
      return;
    }
    updates.responsableId = assignee.id;
    updates.responsableNombre =
      [assignee.firstName, assignee.lastName].filter(Boolean).join(" ") || assignee.email || null;
  }

  try {
    const [cobro] = await db
      .update(cobrosTable)
      .set(updates)
      .where(eq(cobrosTable.id, paramsParsed.data.id))
      .returning();

    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    // If a due date was just set, seed the user's default reminder sequence
    // (only when this cobro has no reminder rules yet).
    if (fechaVencimiento && cobro.responsableId) {
      try {
        await aplicarDefaultsACobro(cobro.id, cobro.responsableId);
      } catch (err) {
        req.log.warn({ err, cobroId: cobro.id }, "No se pudo aplicar la secuencia de recordatorios por defecto");
      }
    }

    // A manual transition to `pagado` should also emit the receipt (idempotent).
    if (bodyParsed.data.estado === "pagado") {
      void emitirComprobante(cobro.id, { metodo: "manual", referencia: cobro.referencia ?? null }, req.log);
    }

    res.json(serializeCobro(cobro));
  } catch (err) {
    req.log.error({ err }, "Error updating cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const SANTIAGO_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function addCalendarDays(dateStr: string, delta: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12));
  return date.toISOString().slice(0, 10);
}

function startOfSantiagoDay(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  const partsFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  // Converge from UTC midnight to midnight in Santiago. This handles both
  // standard time and DST without hard-coding an offset.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      partsFormatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant += target - representedAsUtc;
  }
  return new Date(instant);
}

function dashboardPeriodStart(periodo: "hoy" | "semana" | "mes" | "total"): Date | null {
  if (periodo === "total") return null;
  const today = SANTIAGO_DAY_FORMATTER.format(new Date());
  if (periodo === "hoy") return startOfSantiagoDay(today);
  if (periodo === "mes") return startOfSantiagoDay(`${today.slice(0, 8)}01`);
  const mondayOffset = (new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  return startOfSantiagoDay(addCalendarDays(today, -mondayOffset));
}

// Dashboard metrics — scoped to the current user's org/team, with Chilean
// calendar periods. Revenue is based on actual confirmed payment events, not
// on when the cobro record was created.
cobrosRouter.get("/dashboard/metrics", async (req, res) => {
  const userId = req.user!.id;
  const requestedPeriod = typeof req.query.periodo === "string" ? req.query.periodo : "mes";
  const periodo: "hoy" | "semana" | "mes" | "total" =
    requestedPeriod === "hoy" || requestedPeriod === "semana" ||
    requestedPeriod === "total" ? requestedPeriod : "mes";
  const periodStart = dashboardPeriodStart(periodo);

  try {
    const ctx = await getOrgContext(userId);
    const scope = cobroScopeCondition(ctx, userId, undefined);
    const confirmedPaymentConditions = [
      scope,
      eq(pagosParciales.estado, "confirmado"),
      isNotNull(pagosParciales.confirmadoEn),
      ...(periodStart ? [gte(pagosParciales.confirmadoEn, periodStart)] : []),
    ];
    const [paymentEvents] = await db
      .select({
        cantidad: sql<number>`count(*)::int`,
        monto: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
      })
      .from(pagosParciales)
      .innerJoin(cobrosTable, eq(cobrosTable.id, pagosParciales.cobroId))
      .where(and(...confirmedPaymentConditions));

    // A cobro may be settled manually without creating an abono. Add only the
    // residual amount not already represented by confirmed payment events.
    const manualPaidConditions = [
      scope,
      eq(cobrosTable.estado, "pagado"),
      isNotNull(cobrosTable.pagadoEn),
      ...(periodStart ? [gte(cobrosTable.pagadoEn, periodStart)] : []),
    ];
    const manualPaidRows = await db
      .select({
        id: cobrosTable.id,
        monto: cobrosTable.monto,
        montoDescuento: cobrosTable.montoDescuento,
      })
      .from(cobrosTable)
      .where(and(...manualPaidConditions));
    const manualPaidAbonos = manualPaidRows.length
      ? await db
          .select({
            cobroId: pagosParciales.cobroId,
            total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
          })
          .from(pagosParciales)
          .where(and(
            inArray(pagosParciales.cobroId, manualPaidRows.map((row) => row.id)),
            eq(pagosParciales.estado, "confirmado"),
          ))
          .groupBy(pagosParciales.cobroId)
      : [];
    const manualPaidMap = new Map(manualPaidAbonos.map((row) => [row.cobroId, Number(row.total)]));
    const manualSettlements = manualPaidRows
      .map((row) => Math.max(Number(row.monto) - Number(row.montoDescuento ?? 0) - (manualPaidMap.get(row.id) ?? 0), 0))
      .filter((amount) => amount > 0);

    const outstandingConditions = [
      scope,
      inArray(cobrosTable.estado, ["pendiente", "parcial"]),
      ...(periodStart ? [gte(cobrosTable.creadoEn, periodStart)] : []),
    ];
    const outstandingRows = await db
      .select({
        id: cobrosTable.id,
        monto: cobrosTable.monto,
        montoDescuento: cobrosTable.montoDescuento,
      })
      .from(cobrosTable)
      .where(and(...outstandingConditions));
    const outstandingAbonos = outstandingRows.length
      ? await db
          .select({
            cobroId: pagosParciales.cobroId,
            total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
          })
          .from(pagosParciales)
          .where(and(
            inArray(pagosParciales.cobroId, outstandingRows.map((row) => row.id)),
            eq(pagosParciales.estado, "confirmado"),
          ))
          .groupBy(pagosParciales.cobroId)
      : [];
    const outstandingPaidMap = new Map(outstandingAbonos.map((row) => [row.cobroId, Number(row.total)]));
    const pendientesMonto = outstandingRows.reduce(
      (sum, row) => sum + Math.max(
        Number(row.monto) - Number(row.montoDescuento ?? 0) - (outstandingPaidMap.get(row.id) ?? 0),
        0,
      ),
      0,
    );

    const transaccionesPagadas = Number(paymentEvents?.cantidad ?? 0) + manualSettlements.length;
    const montoRecaudado =
      Number(paymentEvents?.monto ?? 0) + manualSettlements.reduce((sum, amount) => sum + amount, 0);
    const ticketPromedio = transaccionesPagadas > 0 ? montoRecaudado / transaccionesPagadas : 0;

    res.json({
      transaccionesPagadas,
      montoRecaudado,
      ticketPromedio,
      pendientesCantidad: outstandingRows.length,
      pendientesMonto,
      periodo,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting dashboard metrics");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Portfolio health panel — traffic-light classification of outstanding cobros,
// prioritized action list, and week-over-week trend. Scoped like the rest of
// the dashboard (admin=org, supervisor=team, ejecutivo=own).
cobrosRouter.get("/dashboard/salud-cartera", async (req, res) => {
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const scope = cobroScopeCondition(ctx, userId, undefined);

    // Business-day boundaries in Chile time (fechaVencimiento is a date-only
    // string; classifying with server-local/UTC midnight would roll the day at
    // the wrong hour). en-CA yields YYYY-MM-DD directly.
    const hoy = new Date();
    const hoyStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(hoy);
    // Day arithmetic on a UTC-noon anchor is DST-safe.
    const sumarDias = (ymd: string, dias: number): string =>
      new Date(new Date(`${ymd}T12:00:00Z`).getTime() + dias * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const en7Str = sumarDias(hoyStr, 7);
    const hace7Str = sumarDias(hoyStr, -7);
    const hace7 = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Outstanding cobros now, plus cobros that reached a terminal state during
    // the last 7 days (they were outstanding a week ago — needed for the trend).
    const rows = await db
      .select({
        id: cobrosTable.id,
        clienteId: cobrosTable.clienteId,
        estado: cobrosTable.estado,
        monto: cobrosTable.monto,
        montoDescuento: cobrosTable.montoDescuento,
        fechaVencimiento: cobrosTable.fechaVencimiento,
        pagadoEn: cobrosTable.pagadoEn,
        actualizadoEn: cobrosTable.actualizadoEn,
        creadoEn: cobrosTable.creadoEn,
      })
      .from(cobrosTable)
      .where(
        and(
          scope,
          or(
            inArray(cobrosTable.estado, ["pendiente", "parcial"]),
            and(
              inArray(cobrosTable.estado, ["pagado", "cancelado", "fallido"]),
              gte(cobrosTable.actualizadoEn, hace7),
            ),
          ),
        ),
      );

    const abiertos = rows.filter((r) => r.estado === "pendiente" || r.estado === "parcial");
    const abonado = await abonadoPorCobro(abiertos.map((r) => r.id));
    const saldoDe = (r: (typeof abiertos)[number]) =>
      Math.max(Number(r.monto) - Number(r.montoDescuento ?? 0) - (abonado.get(r.id) ?? 0), 0);

    // Abonos confirmed during the last 7 days, for every fetched cobro — used
    // to reconstruct each cobro's outstanding balance as of the prior cutoff.
    const abonadoReciente = new Map<number, number>();
    if (rows.length > 0) {
      const recientes = await db
        .select({
          cobroId: pagosParciales.cobroId,
          total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
        })
        .from(pagosParciales)
        .where(
          and(
            eq(pagosParciales.estado, "confirmado"),
            inArray(pagosParciales.cobroId, rows.map((r) => r.id)),
            gte(pagosParciales.confirmadoEn, hace7),
          ),
        )
        .groupBy(pagosParciales.cobroId);
      for (const s of recientes) abonadoReciente.set(s.cobroId, s.total);
    }

    type Bloque = "sana" | "riesgo" | "critica";
    const clasificar = (venc: string | null, refHoy: string, ref7: string): Bloque => {
      if (!venc) return "sana";
      if (venc < refHoy) return "critica";
      if (venc <= ref7) return "riesgo";
      return "sana";
    };

    // Current snapshot.
    const actual: Record<Bloque, { monto: number; cantidad: number; sumaMora: number }> = {
      sana: { monto: 0, cantidad: 0, sumaMora: 0 },
      riesgo: { monto: 0, cantidad: 0, sumaMora: 0 },
      critica: { monto: 0, cantidad: 0, sumaMora: 0 },
    };
    const msDia = 24 * 60 * 60 * 1000;
    const diasMoraDe = (venc: string) =>
      Math.max(Math.round((new Date(`${hoyStr}T00:00:00`).getTime() - new Date(`${venc}T00:00:00`).getTime()) / msDia), 0);
    for (const r of abiertos) {
      const bloque = clasificar(r.fechaVencimiento, hoyStr, en7Str);
      const saldo = saldoDe(r);
      actual[bloque].monto += saldo;
      actual[bloque].cantidad += 1;
      if (bloque === "critica" && r.fechaVencimiento) actual[bloque].sumaMora += diasMoraDe(r.fechaVencimiento);
    }

    // Approximate snapshot as of 7 days ago. Rules:
    // - cobros created after the cutoff did not exist then → excluded;
    // - open cobros are valued at today's saldo PLUS abonos confirmed during
    //   the week (those payments had not happened yet at the cutoff);
    // - terminal cobros only count if they closed after the cutoff (pagadoEn
    //   for pagado, actualizadoEn otherwise), valued the same way.
    const previo: Record<Bloque, { monto: number }> = {
      sana: { monto: 0 },
      riesgo: { monto: 0 },
      critica: { monto: 0 },
    };
    for (const r of rows) {
      if (r.creadoEn > hace7) continue; // did not exist a week ago
      const esAbierto = r.estado === "pendiente" || r.estado === "parcial";
      if (!esAbierto) {
        const cierre = r.estado === "pagado" && r.pagadoEn ? r.pagadoEn : r.actualizadoEn;
        if (cierre < hace7) continue; // already closed a week ago
      }
      const neto = Math.max(Number(r.monto) - Number(r.montoDescuento ?? 0), 0);
      const abonadoTotal = esAbierto ? (abonado.get(r.id) ?? 0) : neto;
      const saldoPrevio = Math.max(
        neto - Math.max(abonadoTotal - (abonadoReciente.get(r.id) ?? 0), 0),
        0,
      );
      const bloque = clasificar(r.fechaVencimiento, hace7Str, sumarDias(hace7Str, 7));
      previo[bloque].monto += saldoPrevio;
    }

    // Exact trend when a stored snapshot exists (~7 days ago, ±2-day window):
    // it recorded what this user's dashboard actually showed then, so it wins
    // over the reconstruction above.
    const snapshotPrevio = await buscarSnapshotPrevio(userId, hace7Str);
    if (snapshotPrevio) {
      previo.sana.monto = snapshotPrevio.sana;
      previo.riesgo.monto = snapshotPrevio.riesgo;
      previo.critica.monto = snapshotPrevio.critica;
    }

    // A block "improves" when money moves out of risk/critical or into healthy.
    const tendenciaDe = (bloque: Bloque): "mejor" | "peor" | "igual" => {
      const ahora = actual[bloque].monto;
      const antes = previo[bloque].monto;
      const umbral = Math.max(antes * 0.05, 1000);
      if (Math.abs(ahora - antes) <= umbral) return "igual";
      const subio = ahora > antes;
      if (bloque === "sana") return subio ? "mejor" : "peor";
      return subio ? "peor" : "mejor";
    };

    // Prioritized actions: group open cobros by cliente.
    type Grupo = {
      clienteId: number;
      saldo: number;
      peorMora: number;
      minDiasParaVencer: number | null;
      cobroUrgente: { id: number; orden: number } | null;
    };
    const grupos = new Map<number, Grupo>();
    for (const r of abiertos) {
      if (r.clienteId == null) continue;
      const saldo = saldoDe(r);
      if (saldo <= 0) continue;
      let g = grupos.get(r.clienteId);
      if (!g) {
        g = { clienteId: r.clienteId, saldo: 0, peorMora: 0, minDiasParaVencer: null, cobroUrgente: null };
        grupos.set(r.clienteId, g);
      }
      g.saldo += saldo;
      let orden = 0; // higher = more urgent
      if (r.fechaVencimiento) {
        if (r.fechaVencimiento < hoyStr) {
          const mora = diasMoraDe(r.fechaVencimiento);
          g.peorMora = Math.max(g.peorMora, mora);
          orden = 100000 + mora;
        } else {
          const dias = Math.round(
            (new Date(`${r.fechaVencimiento}T00:00:00`).getTime() - new Date(`${hoyStr}T00:00:00`).getTime()) / msDia,
          );
          g.minDiasParaVencer = g.minDiasParaVencer == null ? dias : Math.min(g.minDiasParaVencer, dias);
          orden = 1000 - dias;
        }
      }
      if (!g.cobroUrgente || orden > g.cobroUrgente.orden) g.cobroUrgente = { id: r.id, orden };
    }

    const clienteIds = Array.from(grupos.keys());
    const [scores, nombres, contactos, tienePredictivo] = await Promise.all([
      computeClienteScores(clienteIds, scope),
      clienteIds.length
        ? db
            .select({ id: clientesTable.id, nombre: clientesTable.nombre })
            .from(clientesTable)
            .where(and(clienteScopeCondition(ctx, userId), inArray(clientesTable.id, clienteIds)))
        : Promise.resolve([] as { id: number; nombre: string }[]),
      clienteIds.length
        ? db
            .select({
              clienteId: cobrosTable.clienteId,
              ultimo: sql<string | null>`max(${gestionesCobranzaTable.creadoEn})`,
            })
            .from(gestionesCobranzaTable)
            .innerJoin(cobrosTable, eq(gestionesCobranzaTable.cobroId, cobrosTable.id))
            .where(and(scope, inArray(cobrosTable.clienteId, clienteIds)))
            .groupBy(cobrosTable.clienteId)
        : Promise.resolve([] as { clienteId: number | null; ultimo: string | null }[]),
      userTieneFeature(userId, "scoring_predictivo"),
    ]);
    const nombrePorId = new Map(nombres.map((n) => [n.id, n.nombre]));
    const ultimoContacto = new Map<number, Date>();
    for (const c of contactos) {
      if (c.clienteId != null && c.ultimo) ultimoContacto.set(c.clienteId, new Date(c.ultimo));
    }

    const maxSaldo = Math.max(...Array.from(grupos.values(), (g) => g.saldo), 1);
    const prioridadDe = (g: Grupo): number => {
      const s = scores.get(g.clienteId);
      const scoreRiesgo = s?.score == null ? 50 : 100 - s.score;
      const mora = Math.min(g.peorMora, 90) / 90;
      const monto = g.saldo / maxSaldo;
      const contacto = ultimoContacto.get(g.clienteId);
      const diasSinContacto = contacto
        ? Math.min(Math.round((hoy.getTime() - contacto.getTime()) / msDia), 60)
        : 60;
      const urgenciaVence =
        g.peorMora === 0 && g.minDiasParaVencer != null ? Math.max(1 - g.minDiasParaVencer / 30, 0) : 0;
      return monto * 0.35 + Math.max(mora, urgenciaVence * 0.8) * 0.3 + (scoreRiesgo / 100) * 0.2 + (diasSinContacto / 60) * 0.15;
    };

    const acciones = Array.from(grupos.values())
      .sort((a, b) => prioridadDe(b) - prioridadDe(a))
      .slice(0, 5)
      .map((g) => {
        const s = scores.get(g.clienteId);
        return {
          clienteId: g.clienteId,
          clienteNombre: nombrePorId.get(g.clienteId) ?? "Cliente",
          cobroId: g.cobroUrgente?.id ?? null,
          saldoPendiente: Math.round(g.saldo),
          diasMora: g.peorMora > 0 ? g.peorMora : null,
          diasParaVencer: g.peorMora === 0 ? g.minDiasParaVencer : null,
          score: s?.score ?? null,
          categoria: s?.categoria ?? "sin_datos",
          // Scoring predictivo: solo plan NextCob.
          probabilidadPago: tienePredictivo ? (s?.probabilidadPago ?? null) : null,
          ultimoContactoEn: ultimoContacto.get(g.clienteId)?.toISOString() ?? null,
        };
      });

    res.json({
      semaforo: {
        sana: {
          monto: Math.round(actual.sana.monto),
          cantidad: actual.sana.cantidad,
          tendencia: tendenciaDe("sana"),
        },
        riesgo: {
          monto: Math.round(actual.riesgo.monto),
          cantidad: actual.riesgo.cantidad,
          tendencia: tendenciaDe("riesgo"),
        },
        critica: {
          monto: Math.round(actual.critica.monto),
          cantidad: actual.critica.cantidad,
          diasPromedioMora:
            actual.critica.cantidad > 0 ? Math.round(actual.critica.sumaMora / actual.critica.cantidad) : 0,
          tendencia: tendenciaDe("critica"),
        },
      },
      acciones,
      resumen: {
        montoRecuperable: Math.round(acciones.reduce((sum, a) => sum + a.saldoPendiente, 0)),
        clientes: acciones.length,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error getting salud de cartera");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Historical evolution of the salud-de-cartera blocks, from the stored daily
// snapshots (one per Santiago day). Days without a snapshot are simply absent
// from the response — the frontend chart bridges those gaps.
cobrosRouter.get("/dashboard/salud-cartera/historial", async (req, res) => {
  const userId = req.user!.id;
  try {
    const dias = req.query.dias === "90" ? 90 : 30;
    const hoyStr = hoySantiagoStr();
    const desde = sumarDiasSantiago(hoyStr, -(dias - 1));
    const rows = await db
      .select({
        fecha: saludCarteraSnapshotsTable.fecha,
        sanaMonto: saludCarteraSnapshotsTable.sanaMonto,
        sanaCantidad: saludCarteraSnapshotsTable.sanaCantidad,
        riesgoMonto: saludCarteraSnapshotsTable.riesgoMonto,
        riesgoCantidad: saludCarteraSnapshotsTable.riesgoCantidad,
        criticaMonto: saludCarteraSnapshotsTable.criticaMonto,
        criticaCantidad: saludCarteraSnapshotsTable.criticaCantidad,
      })
      .from(saludCarteraSnapshotsTable)
      .where(
        and(
          eq(saludCarteraSnapshotsTable.usuarioId, userId),
          gte(saludCarteraSnapshotsTable.fecha, desde),
        ),
      )
      .orderBy(saludCarteraSnapshotsTable.fecha);

    const puntos = rows.map((r) => ({
      fecha: r.fecha,
      sana: Math.round(Number(r.sanaMonto)),
      riesgo: Math.round(Number(r.riesgoMonto)),
      critica: Math.round(Number(r.criticaMonto)),
      sanaCantidad: r.sanaCantidad,
      riesgoCantidad: r.riesgoCantidad,
      criticaCantidad: r.criticaCantidad,
    }));

    // Si el barrido diario aún no generó el snapshot de hoy, agregamos un
    // punto "en vivo" calculado con la misma lógica del sweep para que el
    // gráfico siempre termine en el estado actual.
    if (puntos.length === 0 || puntos[puntos.length - 1].fecha !== hoyStr) {
      const bloques = await calcularBloquesUsuario(userId, hoyStr);
      puntos.push({
        fecha: hoyStr,
        sana: Math.round(bloques.sana.monto),
        riesgo: Math.round(bloques.riesgo.monto),
        critica: Math.round(bloques.critica.monto),
        sanaCantidad: bloques.sana.cantidad,
        riesgoCantidad: bloques.riesgo.cantidad,
        criticaCantidad: bloques.critica.cantidad,
      });
    }

    res.json({
      dias,
      desde,
      hasta: hoyStr,
      puntos,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting historial de salud de cartera");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const AbonoInputSchema = z.object({
  monto: z.number().positive(),
  metodo: z.enum(["flow", "mp", "manual"]),
  notas: z.string().optional(),
  emailPagador: z.string().email().optional(),
});

cobrosRouter.get("/cobros/:id/abonos", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const [cobro] = await db.select({ id: cobrosTable.id }).from(cobrosTable).where(eq(cobrosTable.id, paramsParsed.data.id));
    if (!cobro) { res.status(404).json({ error: "Cobro no encontrado" }); return; }
    const abonos = await db
      .select()
      .from(pagosParciales)
      .where(eq(pagosParciales.cobroId, paramsParsed.data.id))
      .orderBy(desc(pagosParciales.creadoEn));
    res.json(abonos.map((a) => ({
      ...a,
      monto: Number(a.monto),
      creadoEn: a.creadoEn.toISOString(),
      confirmadoEn: a.confirmadoEn?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Error listing abonos");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.post("/cobros/:id/abonos", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) { res.status(400).json({ error: "ID inválido" }); return; }
  const bodyParsed = AbonoInputSchema.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }
  const { monto, metodo, notas, emailPagador } = bodyParsed.data;
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, paramsParsed.data.id));
    if (!cobro) { res.status(404).json({ error: "Cobro no encontrado" }); return; }

    if (metodo === "manual") {
      const [abono] = await db.insert(pagosParciales).values({
        cobroId: cobro.id, monto: String(monto), metodo: "manual",
        estado: "confirmado", notas: notas ?? null, confirmadoEn: new Date(), creadoEn: new Date(),
      }).returning();
      const estadoTrasAbono = await recalcularEstadoCobro(cobro.id);
      if (estadoTrasAbono === "pagado") {
        void emitirComprobante(cobro.id, { metodo: "manual" }, req.log);
      }
      req.log.info({ cobroId: cobro.id, abonoId: abono.id, monto }, "Manual abono confirmed");
      res.status(201).json({ ...abono, monto: Number(abono.monto), creadoEn: abono.creadoEn.toISOString(), confirmadoEn: abono.confirmadoEn?.toISOString() ?? null });
      return;
    }

    if (metodo === "flow") {
      const creds = await getFlowCredentials(userId);
      if (!creds) { res.status(400).json({ error: "No tienes credenciales de Flow configuradas." }); return; }
      const email = emailPagador ?? cobro.emailPagador;
      if (!email) { res.status(400).json({ error: "Se requiere email del pagador para generar link Flow." }); return; }
      const [abono] = await db.insert(pagosParciales).values({
        cobroId: cobro.id, monto: String(monto), metodo: "flow",
        estado: "pendiente", notas: notas ?? null, creadoEn: new Date(),
      }).returning();
      try {
        const baseUrl = getPublicBaseUrl();
        const result = await crearOrdenFlow(creds.apiKey, creds.secretKey, {
          commerceOrder: `abono-${abono.id}`,
          subject: `Abono: ${cobro.descripcion}`.slice(0, 200),
          currency: "CLP",
          amount: Math.round(monto),
          email,
          urlConfirmation: `${baseUrl}/api/webhooks/flow`,
          urlReturn: `${baseUrl}/cobros/${cobro.id}`,
        });
        const [updated] = await db.update(pagosParciales).set({
          flowToken: result.token, flowOrdenId: String(result.flowOrder), linkPago: result.url,
        }).where(eq(pagosParciales.id, abono.id)).returning();
        req.log.info({ cobroId: cobro.id, abonoId: abono.id }, "Flow abono link created");
        res.status(201).json({ ...updated, monto: Number(updated.monto), creadoEn: updated.creadoEn.toISOString(), confirmadoEn: null });
      } catch (flowErr) {
        await db.delete(pagosParciales).where(eq(pagosParciales.id, abono.id));
        throw flowErr;
      }
      return;
    }

    if (metodo === "mp") {
      const accessToken = await getMpCredentials(userId);
      if (!accessToken) { res.status(400).json({ error: "No tienes credenciales de MercadoPago configuradas." }); return; }
      const [abono] = await db.insert(pagosParciales).values({
        cobroId: cobro.id, monto: String(monto), metodo: "mp",
        estado: "pendiente", notas: notas ?? null, creadoEn: new Date(),
      }).returning();
      try {
        const baseUrl = getPublicBaseUrl();
        const result = await crearPreferenciaMp(accessToken, {
          title: `Abono: ${cobro.descripcion}`.slice(0, 256),
          quantity: 1,
          unitPrice: Math.round(monto),
          externalReference: `abono-${abono.id}`,
          notificationUrl: `${baseUrl}/api/webhooks/mercadopago`,
          backUrl: `${baseUrl}/cobros/${cobro.id}`,
        });
        const [updated] = await db.update(pagosParciales).set({
          mpPreferenceId: result.preferenceId, linkPago: result.initPoint,
        }).where(eq(pagosParciales.id, abono.id)).returning();
        req.log.info({ cobroId: cobro.id, abonoId: abono.id }, "MP abono link created");
        res.status(201).json({ ...updated, monto: Number(updated.monto), creadoEn: updated.creadoEn.toISOString(), confirmadoEn: null });
      } catch (mpErr) {
        await db.delete(pagosParciales).where(eq(pagosParciales.id, abono.id));
        throw mpErr;
      }
      return;
    }

    res.status(400).json({ error: "Método no válido" });
  } catch (err) {
    req.log.error({ err }, "Error creating abono");
    res.status(500).json({ error: `Error al crear abono: ${err instanceof Error ? err.message : String(err)}` });
  }
});

cobrosRouter.post("/cobros/:id/abonos/:abonoId/confirmar", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  const abonoId = Number(req.params.abonoId);
  if (!paramsParsed.success || isNaN(abonoId)) { res.status(400).json({ error: "ID inválido" }); return; }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const [abono] = await db.select().from(pagosParciales).where(
      and(eq(pagosParciales.id, abonoId), eq(pagosParciales.cobroId, paramsParsed.data.id))
    );
    if (!abono) { res.status(404).json({ error: "Abono no encontrado" }); return; }
    if (abono.estado === "confirmado") { res.status(400).json({ error: "El abono ya está confirmado" }); return; }
    const [updated] = await db.update(pagosParciales)
      .set({ estado: "confirmado", confirmadoEn: new Date() })
      .where(eq(pagosParciales.id, abonoId))
      .returning();
    const estadoTrasConfirmar = await recalcularEstadoCobro(paramsParsed.data.id);
    if (estadoTrasConfirmar === "pagado") {
      void emitirComprobante(paramsParsed.data.id, { metodo: "manual" }, req.log);
    }
    req.log.info({ abonoId, cobroId: paramsParsed.data.id }, "Abono confirmed manually");
    res.json({ ...updated, monto: Number(updated.monto), creadoEn: updated.creadoEn.toISOString(), confirmadoEn: updated.confirmadoEn?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Error confirming abono");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- Comprobantes de transferencia (subidos por el deudor desde el portal) ---

cobrosRouter.get("/cobros/:id/comprobantes-transferencia", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) { res.status(400).json({ error: "ID inválido" }); return; }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(comprobantesTransferenciaTable)
      .where(eq(comprobantesTransferenciaTable.cobroId, paramsParsed.data.id))
      .orderBy(desc(comprobantesTransferenciaTable.creadoEn));
    res.json(
      rows.map((r) => ({
        id: r.id,
        cobroId: r.cobroId,
        archivo: r.archivo,
        nombreArchivo: r.nombreArchivo,
        comentario: r.comentario,
        estado: r.estado,
        creadoEn: r.creadoEn.toISOString(),
        resueltoEn: r.resueltoEn ? r.resueltoEn.toISOString() : null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing transfer receipts");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.post("/cobros/:id/comprobantes-transferencia/:comprobanteId/confirmar", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  const comprobanteId = Number(req.params.comprobanteId);
  if (!paramsParsed.success || isNaN(comprobanteId)) { res.status(400).json({ error: "ID inválido" }); return; }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    // Transacción: lock del cobro, exigir estado cobrable, claim del
    // comprobante y transición a pagado como una sola unidad. Así un fallo
    // parcial nunca deja un comprobante confirmado con el cobro impago, ni
    // convierte en pagado un cobro cancelado/fallido.
    const resultado = await db.transaction(async (tx) => {
      const [cobro] = await tx
        .select({ id: cobrosTable.id, estado: cobrosTable.estado })
        .from(cobrosTable)
        .where(eq(cobrosTable.id, paramsParsed.data.id))
        .for("update");
      if (!cobro) return { error: "Cobro no encontrado" as const };
      if (cobro.estado !== "pendiente" && cobro.estado !== "parcial" && cobro.estado !== "pagado") {
        return { error: `El cobro está en estado "${cobro.estado}" y no puede confirmarse como pagado.` as const };
      }

      // Claim: solo un confirmar/rechazar gana sobre un comprobante pendiente.
      const [comprobante] = await tx
        .update(comprobantesTransferenciaTable)
        .set({ estado: "confirmado", resueltoEn: new Date() })
        .where(
          and(
            eq(comprobantesTransferenciaTable.id, comprobanteId),
            eq(comprobantesTransferenciaTable.cobroId, paramsParsed.data.id),
            eq(comprobantesTransferenciaTable.estado, "pendiente"),
          ),
        )
        .returning({ id: comprobantesTransferenciaTable.id });
      if (!comprobante) return { error: "El comprobante no existe o ya fue resuelto." as const };

      // El dinero manda: nunca degrada un estado; pagadoEn se conserva si ya existía.
      await tx
        .update(cobrosTable)
        .set({ estado: "pagado", pagadoEn: sql`coalesce(${cobrosTable.pagadoEn}, now())` })
        .where(eq(cobrosTable.id, paramsParsed.data.id));
      return { ok: true as const };
    });

    if ("error" in resultado) {
      res.status(400).json({ error: resultado.error });
      return;
    }

    // Solo tras el commit: efectos secundarios (email de comprobante, encuesta).
    void emitirComprobante(paramsParsed.data.id, { metodo: "manual" }, req.log);

    req.log.info(
      { cobroId: paramsParsed.data.id, comprobanteId },
      "Comprobante de transferencia confirmado; cobro marcado pagado",
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error confirming transfer receipt");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.post("/cobros/:id/comprobantes-transferencia/:comprobanteId/rechazar", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  const comprobanteId = Number(req.params.comprobanteId);
  if (!paramsParsed.success || isNaN(comprobanteId)) { res.status(400).json({ error: "ID inválido" }); return; }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, paramsParsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const [comprobante] = await db
      .update(comprobantesTransferenciaTable)
      .set({ estado: "rechazado", resueltoEn: new Date() })
      .where(
        and(
          eq(comprobantesTransferenciaTable.id, comprobanteId),
          eq(comprobantesTransferenciaTable.cobroId, paramsParsed.data.id),
          eq(comprobantesTransferenciaTable.estado, "pendiente"),
        ),
      )
      .returning({ id: comprobantesTransferenciaTable.id });
    if (!comprobante) {
      res.status(400).json({ error: "El comprobante no existe o ya fue resuelto." });
      return;
    }
    req.log.info({ cobroId: paramsParsed.data.id, comprobanteId }, "Comprobante de transferencia rechazado");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error rejecting transfer receipt");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- Per-cobro automatic reminder rules ---

function mapRecordatorio(r: typeof recordatoriosTable.$inferSelect) {
  return {
    id: r.id,
    cobroId: r.cobroId,
    canal: r.canal,
    momento: r.momento,
    diasOffset: r.diasOffset,
    activo: r.activo,
    creadoEn: r.creadoEn.toISOString(),
  };
}

cobrosRouter.get("/cobros/:id/recordatorios", async (req, res) => {
  const parsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, parsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(recordatoriosTable)
      .where(eq(recordatoriosTable.cobroId, parsed.data.id))
      .orderBy(recordatoriosTable.id);
    res.json(rows.map(mapRecordatorio));
  } catch (err) {
    req.log.error({ err }, "Error listing recordatorios");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.get("/cobros/:id/recordatorios/historial", async (req, res) => {
  const parsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, parsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(recordatoriosEnviadosTable)
      .where(eq(recordatoriosEnviadosTable.cobroId, parsed.data.id))
      .orderBy(desc(recordatoriosEnviadosTable.creadoEn));
    res.json(
      rows.map((r) => ({
        id: r.id,
        cobroId: r.cobroId,
        recordatorioId: r.recordatorioId,
        canal: r.canal,
        estado: r.estado,
        detalle: r.detalle,
        fecha: r.fecha,
        creadoEn: r.creadoEn.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing reminder history");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.post("/cobros/:id/recordatorios", async (req, res) => {
  const parsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, parsed.data.id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  const bodyParsed = CreateRecordatorioBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const { canal, momento } = bodyParsed.data;
  const diasOffset = bodyParsed.data.diasOffset ?? 0;
  if (momento !== "dia" && diasOffset < 1) {
    res.status(400).json({ error: "Debes indicar la cantidad de días (mínimo 1) para este tipo de recordatorio." });
    return;
  }
  try {
    const [cobro] = await db
      .select({ id: cobrosTable.id })
      .from(cobrosTable)
      .where(eq(cobrosTable.id, parsed.data.id));
    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    const [created] = await db
      .insert(recordatoriosTable)
      .values({
        cobroId: parsed.data.id,
        canal,
        momento,
        diasOffset: momento === "dia" ? 0 : diasOffset,
        activo: true,
      })
      .returning();
    res.status(201).json(mapRecordatorio(created));
  } catch (err) {
    req.log.error({ err }, "Error creating recordatorio");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.patch("/cobros/:id/recordatorios/:recordatorioId", async (req, res) => {
  const id = Number(req.params.id);
  const recordatorioId = Number(req.params.recordatorioId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(recordatorioId) || recordatorioId <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const bodyParsed = UpdateRecordatorioBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const [existing] = await db
      .select()
      .from(recordatoriosTable)
      .where(and(eq(recordatoriosTable.id, recordatorioId), eq(recordatoriosTable.cobroId, id)));
    if (!existing) {
      res.status(404).json({ error: "Recordatorio no encontrado" });
      return;
    }

    const canal = bodyParsed.data.canal ?? existing.canal;
    const momento = bodyParsed.data.momento ?? existing.momento;
    const diasOffset =
      bodyParsed.data.diasOffset ?? existing.diasOffset;
    const finalDiasOffset = momento === "dia" ? 0 : diasOffset;
    if (momento !== "dia" && finalDiasOffset < 1) {
      res.status(400).json({ error: "Debes indicar la cantidad de días (mínimo 1) para este tipo de recordatorio." });
      return;
    }

    const updates: Record<string, unknown> = {
      canal,
      momento,
      diasOffset: finalDiasOffset,
    };
    if (bodyParsed.data.activo !== undefined) updates.activo = bodyParsed.data.activo;

    const [updated] = await db
      .update(recordatoriosTable)
      .set(updates)
      .where(and(eq(recordatoriosTable.id, recordatorioId), eq(recordatoriosTable.cobroId, id)))
      .returning();
    res.json(mapRecordatorio(updated));
  } catch (err) {
    req.log.error({ err }, "Error updating recordatorio");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.delete("/cobros/:id/recordatorios/:recordatorioId", async (req, res) => {
  const id = Number(req.params.id);
  const recordatorioId = Number(req.params.recordatorioId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(recordatorioId) || recordatorioId <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  if (!(await userMayAccessCobroId(userId, id))) {
    res.status(404).json({ error: "Cobro no encontrado" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(recordatoriosTable)
      .where(and(eq(recordatoriosTable.id, recordatorioId), eq(recordatoriosTable.cobroId, id)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Recordatorio no encontrado" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Error deleting recordatorio");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default cobrosRouter;
