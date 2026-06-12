import { Router } from "express";
import { db, cobrosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ReceiveCobroWebhookBody } from "@workspace/api-zod";

const webhooksRouter = Router();

const EVENTO_A_ESTADO: Record<string, "pagado" | "fallido" | "cancelado" | "pendiente"> = {
  "pago.completado": "pagado",
  "pago.fallido": "fallido",
  "pago.cancelado": "cancelado",
  "pago.pendiente": "pendiente",
};

webhooksRouter.post("/webhooks/cobro", async (req, res) => {
  const parsed = ReceiveCobroWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { evento, cobroId, referencia } = parsed.data;

  req.log.info({ evento, cobroId }, "Webhook received");

  const nuevoEstado = EVENTO_A_ESTADO[evento];

  if (!nuevoEstado) {
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
      res.status(400).json({ error: "Cobro no encontrado" });
      return;
    }

    req.log.info({ cobroId, nuevoEstado }, "Cobro updated via webhook");
    res.json({ recibido: true, cobroActualizado: true });
  } catch (err) {
    req.log.error({ err }, "Error processing webhook");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default webhooksRouter;
