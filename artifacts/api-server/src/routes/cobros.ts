import { Router } from "express";
import {
  db,
  cobrosTable,
  cobroDescuentosTable,
  clientesTable,
  seguimientosCobranzaTable,
  pagosParciales,
  recordatoriosTable,
  recordatoriosEnviadosTable,
  usersTable,
} from "@workspace/db";
import type { Cobro, CobroDescuento } from "@workspace/db";
import { eq, desc, sql, and, gte, isNull, isNotNull, or, lt } from "drizzle-orm";
import {
  CreateCobroBody,
  UpdateCobroBody,
  GetCobroParams,
  UpdateCobroParams,
  CreateRecordatorioBody,
  UpdateRecordatorioBody,
  AplicarDescuentoBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { getFlowCredentials, getMpCredentials } from "./profile";
import { crearOrdenFlow, getPublicBaseUrl } from "../lib/flow-api";
import { crearPreferenciaMp } from "../lib/mp-api";
import { sendPaymentLinkEmail, sendRecordatorioEmail, sendAvisoManualEmail } from "../lib/email";
import { requireSubscription } from "../middlewares/requireSubscription";
import { aplicarDefaultsACobro } from "../lib/recordatorios";
import { getOrgContext, cobroScopeCondition, userCanAccessCobro, userCanAccessCliente } from "../lib/org";

const cobrosRouter = Router();

// Net amount to charge after the current effective discount.
function montoACobrar(cobro: Pick<Cobro, "monto" | "montoDescuento">): number {
  return Number(cobro.monto) - Number(cobro.montoDescuento ?? 0);
}

// Standard JSON serialization for a cobro response (numeric + date conversions
// plus the derived montoACobrar field).
function serializeCobro(cobro: Cobro) {
  return {
    ...cobro,
    monto: Number(cobro.monto),
    montoDescuento: cobro.montoDescuento != null ? Number(cobro.montoDescuento) : null,
    montoACobrar: montoACobrar(cobro),
    creadoEn: cobro.creadoEn.toISOString(),
    actualizadoEn: cobro.actualizadoEn.toISOString(),
  };
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

async function recalcularEstadoCobro(cobroId: number): Promise<void> {
  const [result] = await db
    .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
    .from(pagosParciales)
    .where(and(eq(pagosParciales.cobroId, cobroId), eq(pagosParciales.estado, "confirmado")));
  const [cobro] = await db
    .select({ monto: cobrosTable.monto, montoDescuento: cobrosTable.montoDescuento })
    .from(cobrosTable)
    .where(eq(cobrosTable.id, cobroId));
  if (!cobro) return;
  const totalPagado = result?.total ?? 0;
  const montoTotal = montoACobrar(cobro);
  const nuevoEstado: "pagado" | "parcial" | "pendiente" =
    totalPagado >= montoTotal ? "pagado" : totalPagado > 0 ? "parcial" : "pendiente";
  await db.update(cobrosTable).set({ estado: nuevoEstado, actualizadoEn: new Date() }).where(eq(cobrosTable.id, cobroId));
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

    res.json(cobros.map(serializeCobro));
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
  const emailPagador = (parsed.data as Record<string, unknown>).emailPagador as string | undefined;
  const clienteId = (parsed.data as Record<string, unknown>).clienteId as number | undefined;
  const fechaVencimiento = (parsed.data as Record<string, unknown>).fechaVencimiento as string | undefined;
  const responsableIdInput = (parsed.data as Record<string, unknown>).responsableId as string | undefined;
  const user = req.isAuthenticated() ? req.user : null;

  try {
    const ctx = user ? await getOrgContext(user.id) : null;

    // Determine who the cobro is assigned to. Only org admins may assign a cobro
    // to another member of their organization; otherwise it defaults to the
    // creator. The assignee must belong to the same organization.
    let responsableId: string | null = user?.id ?? null;
    let responsableNombre: string | null = user
      ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null
      : null;

    if (responsableIdInput && responsableIdInput !== user?.id) {
      if (!ctx?.isOrgAdmin || ctx.organizationId == null) {
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

    const [cobro] = await db
      .insert(cobrosTable)
      .values({
        monto: String(monto),
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

    res.json(serializeCobro(cobro));
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
    await recalcularEstadoCobro(cobro.id);
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
    sendPaymentLinkEmail({
      emailPagador: bodyParsed.data.emailPagador,
      clienteNombre: cobro.clienteNombre,
      descripcion: cobro.descripcion,
      monto: montoACobrar(cobro),
      linkPago: result.url,
      comercioNombre: cobro.responsableNombre || "Cobro Simple",
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

    if (!cobro.flowLinkPago) {
      res.status(400).json({ error: "El cobro no tiene link de pago generado. Genera el link de Flow primero." });
      return;
    }

    const result = await sendRecordatorioEmail({
      emailPagador: cobro.emailPagador,
      clienteNombre: cobro.clienteNombre,
      descripcion: cobro.descripcion,
      monto: Number(cobro.monto),
      linkPago: cobro.flowLinkPago,
      comercioNombre: cobro.responsableNombre || "Cobro Simple",
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
      const emailResult = await sendAvisoManualEmail(
        {
          emailPagador: cobro.emailPagador,
          clienteNombre: cobro.clienteNombre,
          descripcion: cobro.descripcion,
          monto: Number(cobro.monto),
          comercioNombre: cobro.responsableNombre ?? "Cobro Simple",
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

  const updates: Record<string, unknown> = {
    actualizadoEn: new Date(),
  };

  const fechaVencimiento = (bodyParsed.data as Record<string, unknown>).fechaVencimiento as
    | string
    | null
    | undefined;

  if (bodyParsed.data.estado !== undefined) updates.estado = bodyParsed.data.estado;
  if (bodyParsed.data.descripcion !== undefined) updates.descripcion = bodyParsed.data.descripcion;
  if (bodyParsed.data.referencia !== undefined) updates.referencia = bodyParsed.data.referencia;
  if (fechaVencimiento !== undefined) updates.fechaVencimiento = fechaVencimiento;

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

    res.json(serializeCobro(cobro));
  } catch (err) {
    req.log.error({ err }, "Error updating cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Dashboard metrics — scoped to current user, with period filter
cobrosRouter.get("/dashboard/metrics", async (req, res) => {
  const userId = req.user!.id;
  const periodo = (req.query.periodo as string) || "mes";
  const responsable = typeof req.query.responsable === "string" ? req.query.responsable : undefined;

  let periodStart: Date | null = null;
  const now = new Date();
  if (periodo === "hoy") {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  } else if (periodo === "semana") {
    const day = now.getDay(); // 0=Sun
    const diff = (day + 6) % 7; // days since Monday
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff, 0, 0, 0, 0);
  } else if (periodo === "mes") {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  // "total" => no date filter

  try {
    const ctx = await getOrgContext(userId);
    const scope = cobroScopeCondition(ctx, userId, responsable);
    const baseConditions = periodStart
      ? and(scope, gte(cobrosTable.creadoEn, periodStart))
      : scope;

    const rows = await db
      .select({
        estado: cobrosTable.estado,
        cantidad: sql<number>`count(*)::int`,
        monto: sql<number>`coalesce(sum(${cobrosTable.monto})::float, 0)`,
      })
      .from(cobrosTable)
      .where(baseConditions)
      .groupBy(cobrosTable.estado);

    const pagado = rows.find((r) => r.estado === "pagado");
    const pendiente = rows.find((r) => r.estado === "pendiente");

    const transaccionesPagadas = pagado?.cantidad ?? 0;
    const montoRecaudado = pagado?.monto ?? 0;
    const ticketPromedio = transaccionesPagadas > 0 ? montoRecaudado / transaccionesPagadas : 0;

    res.json({
      transaccionesPagadas,
      montoRecaudado,
      ticketPromedio,
      pendientesCantidad: pendiente?.cantidad ?? 0,
      pendientesMonto: pendiente?.monto ?? 0,
      periodo: ["hoy", "semana", "mes", "total"].includes(periodo) ? periodo : "mes",
    });
  } catch (err) {
    req.log.error({ err }, "Error getting dashboard metrics");
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
      await recalcularEstadoCobro(cobro.id);
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
    await recalcularEstadoCobro(paramsParsed.data.id);
    req.log.info({ abonoId, cobroId: paramsParsed.data.id }, "Abono confirmed manually");
    res.json({ ...updated, monto: Number(updated.monto), creadoEn: updated.creadoEn.toISOString(), confirmadoEn: updated.confirmadoEn?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Error confirming abono");
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
