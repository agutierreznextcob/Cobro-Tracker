import { Router } from "express";
import { db, notificacionesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

const notificacionesRouter = Router();

notificacionesRouter.use("/notificaciones", (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

function mapNotificacion(n: typeof notificacionesTable.$inferSelect) {
  return {
    id: n.id,
    cobroId: n.cobroId,
    tipo: n.tipo,
    titulo: n.titulo,
    mensaje: n.mensaje,
    waUrl: n.waUrl,
    leida: n.leida,
    creadoEn: n.creadoEn.toISOString(),
  };
}

notificacionesRouter.get("/notificaciones", async (req, res) => {
  const soloNoLeidas = req.query.soloNoLeidas === "true";
  const userId = req.user!.id;
  try {
    const conditions = [eq(notificacionesTable.userId, userId)];
    if (soloNoLeidas) conditions.push(eq(notificacionesTable.leida, false));
    const rows = await db
      .select()
      .from(notificacionesTable)
      .where(and(...conditions))
      .orderBy(desc(notificacionesTable.creadoEn));
    res.json(rows.map(mapNotificacion));
  } catch (err) {
    req.log.error({ err }, "Error listing notifications");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

notificacionesRouter.post("/notificaciones/:id/leida", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const [updated] = await db
      .update(notificacionesTable)
      .set({ leida: true })
      .where(and(eq(notificacionesTable.id, id), eq(notificacionesTable.userId, userId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Notificación no encontrada" });
      return;
    }
    res.json(mapNotificacion(updated));
  } catch (err) {
    req.log.error({ err }, "Error marking notification read");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default notificacionesRouter;
