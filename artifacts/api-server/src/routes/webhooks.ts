import { createHmac, timingSafeEqual } from "crypto";
import { Router } from "express";
import { db, cobrosTable, webhookEventosTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { ReceiveCobroWebhookBody } from "@workspace/api-zod";
import { verificarPagoFlow } from "../lib/flow-api";
import { getFlowCredentials } from "./profile";

const webhooksRouter = Router();

const EVENTO_A_ESTADO: Record<string, "pagado" | "fallido" | "cancelado" | "pendiente"> = {
  "pago.completado": "pagado",
  "pago.fallido": "fallido",
  "pago.cancelado": "cancelado",
  "pago.pendiente": "pendiente",
};

function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(`sha256=${expected}`, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

async function logEvento({
  evento,
  cobroId,
  ipOrigen,
  exitoso,
  detalle,
}: {
  evento: string;
  cobroId?: number | null;
  ipOrigen?: string | null;
  exitoso: boolean;
  detalle?: string | null;
}) {
  await db.insert(webhookEventosTable).values({
    evento,
    cobroId: cobroId ?? null,
    ipOrigen: ipOrigen ?? null,
    resultado: exitoso ? "exitoso" : "fallido",
    exitoso,
    detalle: detalle ?? null,
  });
}

function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first?.trim() ?? null;
  }
  return req.socket.remoteAddress ?? null;
}

// Flow sends POST (form-urlencoded) with just `token` to urlConfirmation.
// We must call back to Flow API with getStatus to verify the real payment status.
// Security: trust only comes from calling Flow's API, not from the body content.
webhooksRouter.post("/webhooks/flow", async (req, res) => {
  const ip = getClientIp(req as Parameters<typeof getClientIp>[0]);

  // Flow sends token via form-urlencoded body
  const token = (req.body?.token ?? req.query?.token) as string | undefined;

  req.log.info({ token, body: req.body, query: req.query }, "Flow webhook received");

  if (!token || typeof token !== "string" || token.trim() === "") {
    req.log.warn({ body: req.body }, "Flow webhook: missing token");
    await logEvento({ evento: "flow.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: "Falta token en la notificación de Flow" });
    // Flow requires 200 OK even on errors, otherwise it retries
    res.status(200).json({ ok: false, error: "Falta token" });
    return;
  }

  try {
    // 1. Find the cobro by the stored token (set when creating the Flow order)
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.flowToken, token.trim()));

    if (!cobro) {
      req.log.warn({ token }, "Flow webhook: no cobro found for token");
      await logEvento({ evento: "flow.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Token desconocido: ${token}` });
      res.status(200).json({ ok: false, error: "Token no reconocido" });
      return;
    }

    req.log.info({ cobroId: cobro.id, token }, "Found cobro for Flow token");

    // 2. Get the credentials of the user who created this cobro
    if (!cobro.responsableId) {
      req.log.error({ cobroId: cobro.id }, "Cobro has no responsableId, cannot verify Flow payment");
      await logEvento({ evento: "flow.webhook.error", cobroId: cobro.id, ipOrigen: ip, exitoso: false, detalle: "Cobro sin responsableId — no se pueden obtener credenciales" });
      res.status(200).json({ ok: false });
      return;
    }

    const creds = await getFlowCredentials(cobro.responsableId);
    if (!creds) {
      req.log.error({ cobroId: cobro.id, responsableId: cobro.responsableId }, "No Flow credentials found for cobro owner");
      await logEvento({ evento: "flow.webhook.error", cobroId: cobro.id, ipOrigen: ip, exitoso: false, detalle: "No hay credenciales Flow del responsable del cobro" });
      res.status(200).json({ ok: false });
      return;
    }

    // 3. Call Flow API to get the REAL payment status (this is the actual verification)
    const pagoStatus = await verificarPagoFlow(creds.apiKey, creds.secretKey, token);

    req.log.info({ cobroId: cobro.id, flowStatus: pagoStatus.status, flowOrder: pagoStatus.flowOrder }, "Flow payment status verified");

    // Flow status: 1=pending, 2=paid, 3=rejected/failed, 4=cancelled
    const estadoMap: Record<number, "pagado" | "fallido" | "cancelado" | "pendiente"> = {
      1: "pendiente",
      2: "pagado",
      3: "fallido",
      4: "cancelado",
    };
    const nuevoEstado = estadoMap[pagoStatus.status];

    if (!nuevoEstado || nuevoEstado === "pendiente") {
      // Still pending — don't update, just acknowledge
      await logEvento({
        evento: "flow.pago.pendiente",
        cobroId: cobro.id,
        ipOrigen: ip,
        exitoso: true,
        detalle: `Flow status ${pagoStatus.status} — pago aún pendiente`,
      });
      res.status(200).json({ ok: true });
      return;
    }

    // 4. Update cobro with the verified status
    await db
      .update(cobrosTable)
      .set({ estado: nuevoEstado, actualizadoEn: new Date() })
      .where(eq(cobrosTable.id, cobro.id));

    await logEvento({
      evento: `flow.pago.${nuevoEstado}`,
      cobroId: cobro.id,
      ipOrigen: ip,
      exitoso: true,
      detalle: `Flow status ${pagoStatus.status} → ${nuevoEstado}. FlowOrder: ${pagoStatus.flowOrder}. Token: ${token}`,
    });

    req.log.info({ cobroId: cobro.id, nuevoEstado }, "Cobro updated via Flow webhook (verified)");
    res.status(200).json({ ok: true });
  } catch (err) {
    req.log.error({ err, token }, "Error processing Flow webhook");
    await logEvento({ evento: "flow.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Error interno: ${String(err)}` });
    // Return 200 so Flow doesn't retry infinitely — the error is on our side
    res.status(200).json({ ok: false, error: "Error interno" });
  }
});

webhooksRouter.post("/webhooks/cobro", async (req, res) => {
  const secret = process.env.WEBHOOK_SECRET;
  const signatureHeader = req.headers["x-webhook-signature"];
  const ip = getClientIp(req as Parameters<typeof getClientIp>[0]);

  if (secret) {
    if (!signatureHeader || typeof signatureHeader !== "string") {
      await logEvento({ evento: "desconocido", cobroId: null, ipOrigen: ip, exitoso: false, detalle: "Falta header X-Webhook-Signature" });
      req.log.warn("Webhook rejected: missing X-Webhook-Signature header");
      res.status(401).json({ error: "Falta la firma del webhook (X-Webhook-Signature)" });
      return;
    }

    if (!req.rawBody) {
      req.log.error("rawBody not available for signature verification");
      res.status(500).json({ error: "Error interno del servidor" });
      return;
    }

    if (!verifySignature(req.rawBody, signatureHeader, secret)) {
      await logEvento({ evento: "desconocido", cobroId: null, ipOrigen: ip, exitoso: false, detalle: "Firma HMAC inválida" });
      req.log.warn({ signatureHeader }, "Webhook rejected: invalid signature");
      res.status(401).json({ error: "Firma inválida" });
      return;
    }
  }

  const parsed = ReceiveCobroWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    await logEvento({ evento: "desconocido", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Payload inválido: ${parsed.error.message}` });
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { evento, cobroId, referencia } = parsed.data;

  req.log.info({ evento, cobroId }, "Webhook received and verified");

  const nuevoEstado = EVENTO_A_ESTADO[evento];

  if (!nuevoEstado) {
    await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: true, detalle: `Evento no mapeado a estado: ${evento}` });
    res.json({ recibido: true, cobroActualizado: false });
    return;
  }

  try {
    const updates: Record<string, unknown> = {
      estado: nuevoEstado,
      actualizadoEn: new Date(),
    };

    if (referencia) {
      updates.referencia = referencia;
    }

    const [cobro] = await db
      .update(cobrosTable)
      .set(updates)
      .where(eq(cobrosTable.id, cobroId))
      .returning();

    if (!cobro) {
      await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: false, detalle: `Cobro #${cobroId} no encontrado` });
      res.status(400).json({ error: "Cobro no encontrado" });
      return;
    }

    await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: true, detalle: `Estado actualizado a: ${nuevoEstado}` });
    req.log.info({ cobroId, nuevoEstado }, "Cobro updated via webhook");
    res.json({ recibido: true, cobroActualizado: true });
  } catch (err) {
    await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: false, detalle: `Error interno: ${String(err)}` });
    req.log.error({ err }, "Error processing webhook");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

webhooksRouter.get("/webhooks/eventos", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const resultado = req.query.resultado as "exitoso" | "fallido" | undefined;
  const evento = req.query.evento as string | undefined;

  try {
    const conditions = [];
    if (resultado === "exitoso") conditions.push(eq(webhookEventosTable.exitoso, true));
    else if (resultado === "fallido") conditions.push(eq(webhookEventosTable.exitoso, false));
    if (evento) conditions.push(eq(webhookEventosTable.evento, evento));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [eventosRows, countRows, eventosUnicosRows] = await Promise.all([
      db
        .select()
        .from(webhookEventosTable)
        .where(where)
        .orderBy(desc(webhookEventosTable.creadoEn))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(webhookEventosTable)
        .where(where),
      db
        .selectDistinct({ evento: webhookEventosTable.evento })
        .from(webhookEventosTable)
        .orderBy(webhookEventosTable.evento),
    ]);

    res.json({
      items: eventosRows.map((e) => ({
        ...e,
        creadoEn: e.creadoEn.toISOString(),
      })),
      total: countRows[0]?.count ?? 0,
      limit,
      offset,
      eventosUnicos: eventosUnicosRows.map((r) => r.evento),
    });
  } catch (err) {
    req.log.error({ err }, "Error listing webhook eventos");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

webhooksRouter.get("/webhooks/eventos/export", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, async (req, res) => {
  const resultado = req.query.resultado as "exitoso" | "fallido" | undefined;
  const evento = req.query.evento as string | undefined;

  try {
    const conditions = [];
    if (resultado === "exitoso") conditions.push(eq(webhookEventosTable.exitoso, true));
    else if (resultado === "fallido") conditions.push(eq(webhookEventosTable.exitoso, false));
    if (evento) conditions.push(eq(webhookEventosTable.evento, evento));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(webhookEventosTable)
      .where(where)
      .orderBy(desc(webhookEventosTable.creadoEn));

    const escape = (v: string | number | boolean | null | undefined): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = ["id", "evento", "cobro_id", "ip_origen", "resultado", "exitoso", "detalle", "creado_en"].join(",");
    const lines = rows.map((r) =>
      [
        escape(r.id),
        escape(r.evento),
        escape(r.cobroId),
        escape(r.ipOrigen),
        escape(r.resultado),
        escape(r.exitoso),
        escape(r.detalle),
        escape(r.creadoEn.toISOString()),
      ].join(","),
    );

    const csv = [header, ...lines].join("\n");
    const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `webhook-eventos-${now}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + csv); // UTF-8 BOM for Excel compatibility
  } catch (err) {
    req.log.error({ err }, "Error exporting webhook eventos");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default webhooksRouter;
