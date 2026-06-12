import { createHmac, timingSafeEqual } from "crypto";
import { Router } from "express";
import { db, cobrosTable, webhookEventosTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { ReceiveCobroWebhookBody } from "@workspace/api-zod";

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

webhooksRouter.get("/webhooks/eventos", async (req, res) => {
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

webhooksRouter.get("/webhooks/eventos/export", async (req, res) => {
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
