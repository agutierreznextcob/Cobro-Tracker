import { Router } from "express";
import { db, recordatoriosDefaultTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateRecordatoriosDefaultBody } from "@workspace/api-zod";
import { ensureUserDefaults, procesarRecordatorios } from "../lib/recordatorios";
import { requireSubscription } from "../middlewares/requireSubscription";
import { requireAdmin } from "../middlewares/requireAdmin";

const recordatoriosRouter = Router();

function mapDefault(d: typeof recordatoriosDefaultTable.$inferSelect) {
  return {
    id: d.id,
    canal: d.canal,
    momento: d.momento,
    diasOffset: d.diasOffset,
    activo: d.activo,
    orden: d.orden,
    creadoEn: d.creadoEn.toISOString(),
  };
}

// --- Default sequence (per-user, authenticated) ---

recordatoriosRouter.get(
  "/recordatorios/default",
  (req, res, next) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
    next();
  },
  requireSubscription,
  async (req, res) => {
    try {
      const defaults = await ensureUserDefaults(req.user!.id);
      res.json(defaults.map(mapDefault));
    } catch (err) {
      req.log.error({ err }, "Error getting default reminder sequence");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

recordatoriosRouter.put(
  "/recordatorios/default",
  (req, res, next) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
    next();
  },
  requireSubscription,
  async (req, res) => {
    const parsed = UpdateRecordatoriosDefaultBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = req.user!.id;
    try {
      await db.transaction(async (tx) => {
        await tx.delete(recordatoriosDefaultTable).where(eq(recordatoriosDefaultTable.userId, userId));
        if (parsed.data.items.length > 0) {
          await tx.insert(recordatoriosDefaultTable).values(
            parsed.data.items.map((item, i) => ({
              userId,
              canal: item.canal,
              momento: item.momento,
              diasOffset: item.diasOffset ?? 0,
              activo: item.activo ?? true,
              orden: i,
            })),
          );
        }
      });
      const updated = await db
        .select()
        .from(recordatoriosDefaultTable)
        .where(eq(recordatoriosDefaultTable.userId, userId))
        .orderBy(recordatoriosDefaultTable.orden);
      res.json(updated.map(mapDefault));
    } catch (err) {
      req.log.error({ err }, "Error updating default reminder sequence");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

// --- Manual trigger (admin or cron secret) ---

recordatoriosRouter.post("/recordatorios/run", async (req, res, next) => {
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.header("x-cron-secret");
  if (cronSecret && provided && provided === cronSecret) {
    try {
      const result = await procesarRecordatorios(req.log);
      res.json(result);
    } catch (err) {
      req.log.error({ err }, "Error running reminder engine (cron)");
      res.status(500).json({ error: "Error interno del servidor" });
    }
    return;
  }
  // Fall back to admin authentication
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
}, requireAdmin, async (req, res) => {
  try {
    const result = await procesarRecordatorios(req.log);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error running reminder engine");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default recordatoriosRouter;
