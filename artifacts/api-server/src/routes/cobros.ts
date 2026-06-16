import { Router } from "express";
import { db, cobrosTable, clientesTable, seguimientosCobranzaTable, pagosParciales } from "@workspace/db";
import { eq, desc, sql, and, gte, isNull, isNotNull, or, lt } from "drizzle-orm";
import {
  CreateCobroBody,
  UpdateCobroBody,
  GetCobroParams,
  UpdateCobroParams,
} from "@workspace/api-zod";
import { z } from "zod";
import { getFlowCredentials, getMpCredentials } from "./profile";
import { crearOrdenFlow, getPublicBaseUrl } from "../lib/flow-api";
import { crearPreferenciaMp } from "../lib/mp-api";
import { sendPaymentLinkEmail, sendRecordatorioEmail, sendAvisoManualEmail } from "../lib/email";
import { requireSubscription } from "../middlewares/requireSubscription";

const cobrosRouter = Router();

async function recalcularEstadoCobro(cobroId: number): Promise<void> {
  const [result] = await db
    .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
    .from(pagosParciales)
    .where(and(eq(pagosParciales.cobroId, cobroId), eq(pagosParciales.estado, "confirmado")));
  const [cobro] = await db
    .select({ monto: cobrosTable.monto })
    .from(cobrosTable)
    .where(eq(cobrosTable.id, cobroId));
  if (!cobro) return;
  const totalPagado = result?.total ?? 0;
  const montoTotal = Number(cobro.monto);
  const nuevoEstado: "pagado" | "parcial" | "pendiente" =
    totalPagado >= montoTotal ? "pagado" : totalPagado > 0 ? "parcial" : "pendiente";
  await db.update(cobrosTable).set({ estado: nuevoEstado, actualizadoEn: new Date() }).where(eq(cobrosTable.id, cobroId));
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

  try {
    const conditions = [];
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

    res.json(
      cobros.map((c) => ({
        ...c,
        monto: Number(c.monto),
        creadoEn: c.creadoEn.toISOString(),
        actualizadoEn: c.actualizadoEn.toISOString(),
      })),
    );
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
  const user = req.isAuthenticated() ? req.user : null;
  const responsableNombre = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null
    : null;

  try {
    // Optionally resolve client name if clienteId provided
    let clienteNombre: string | null = null;
    if (clienteId) {
      const [cliente] = await db.select().from(clientesTable).where(eq(clientesTable.id, clienteId));
      if (cliente) clienteNombre = cliente.nombre;
    }

    const [cobro] = await db
      .insert(cobrosTable)
      .values({
        monto: String(monto),
        descripcion,
        referencia: referencia ?? null,
        estado: "pendiente",
        responsableId: user?.id ?? null,
        responsableNombre,
        clienteId: clienteId ?? null,
        clienteNombre,
        emailPagador: emailPagador ?? null,
      })
      .returning();

    res.status(201).json({
      ...cobro,
      monto: Number(cobro.monto),
      creadoEn: cobro.creadoEn.toISOString(),
      actualizadoEn: cobro.actualizadoEn.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

cobrosRouter.get("/cobros/stats/summary", async (req, res) => {
  try {
    const rows = await db
      .select({
        estado: cobrosTable.estado,
        cantidad: sql<number>`count(*)::int`,
        monto: sql<number>`sum(${cobrosTable.monto})::float`,
      })
      .from(cobrosTable)
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

  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, parsed.data.id));

    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    res.json({
      ...cobro,
      monto: Number(cobro.monto),
      creadoEn: cobro.creadoEn.toISOString(),
      actualizadoEn: cobro.actualizadoEn.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting cobro");
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
      amount: Math.round(Number(cobro.monto)),
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
      monto: Number(cobro.monto),
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
      unitPrice: Math.round(Number(cobro.monto)),
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

  const updates: Record<string, unknown> = {
    actualizadoEn: new Date(),
  };

  if (bodyParsed.data.estado !== undefined) updates.estado = bodyParsed.data.estado;
  if (bodyParsed.data.descripcion !== undefined) updates.descripcion = bodyParsed.data.descripcion;
  if (bodyParsed.data.referencia !== undefined) updates.referencia = bodyParsed.data.referencia;

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

    res.json({
      ...cobro,
      monto: Number(cobro.monto),
      creadoEn: cobro.creadoEn.toISOString(),
      actualizadoEn: cobro.actualizadoEn.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Dashboard metrics — scoped to current user, with period filter
cobrosRouter.get("/dashboard/metrics", async (req, res) => {
  const userId = req.user!.id;
  const periodo = (req.query.periodo as string) || "mes";

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
    const baseConditions = periodStart
      ? and(eq(cobrosTable.responsableId, userId), gte(cobrosTable.creadoEn, periodStart))
      : eq(cobrosTable.responsableId, userId);

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

export default cobrosRouter;
