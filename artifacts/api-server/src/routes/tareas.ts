import { Router, type IRouter } from "express";
import { db, tareasTable, cobrosTable, type Tarea } from "@workspace/db";
import { and, eq, inArray, desc, type SQL } from "drizzle-orm";
import { CompletarTareaParams, ListTareasQueryParams } from "@workspace/api-zod";
import { getOrgContext, type OrgContext } from "../lib/org";

const tareasRouter: IRouter = Router();

tareasRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

// Tasks are per-assignee. Admins see the whole org's tasks; ejecutivos see own.
function tareaScope(ctx: OrgContext, userId: string): SQL | undefined {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return eq(tareasTable.organizationId, ctx.organizationId);
  }
  return eq(tareasTable.userId, userId);
}

function serializeTarea(t: Tarea, clienteNombre?: string | null) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    userId: t.userId,
    cobroId: t.cobroId,
    titulo: t.titulo,
    descripcion: t.descripcion,
    estado: t.estado,
    origen: t.origen,
    clienteNombre: clienteNombre ?? null,
    creadoEn: t.creadoEn.toISOString(),
    completadoEn: t.completadoEn ? t.completadoEn.toISOString() : null,
  };
}

tareasRouter.get("/tareas", async (req, res) => {
  const parsed = ListTareasQueryParams.safeParse({
    estado: typeof req.query.estado === "string" ? req.query.estado : undefined,
  });
  const estado = parsed.success ? parsed.data.estado : undefined;
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const conds: SQL[] = [];
    const scope = tareaScope(ctx, userId);
    if (scope) conds.push(scope);
    if (estado) conds.push(eq(tareasTable.estado, estado));
    const rows = await db
      .select()
      .from(tareasTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(tareasTable.creadoEn));

    const cobroIds = [...new Set(rows.map((r) => r.cobroId).filter((v): v is number => v != null))];
    const cobros = cobroIds.length
      ? await db
          .select({ id: cobrosTable.id, clienteNombre: cobrosTable.clienteNombre })
          .from(cobrosTable)
          .where(inArray(cobrosTable.id, cobroIds))
      : [];
    const nameById = new Map(cobros.map((c) => [c.id, c.clienteNombre]));
    res.json(rows.map((t) => serializeTarea(t, t.cobroId != null ? nameById.get(t.cobroId) : null)));
  } catch (err) {
    req.log.error({ err }, "Error listing tareas");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

tareasRouter.post("/tareas/:id/completar", async (req, res) => {
  const parsed = CompletarTareaParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [tarea] = await db.select().from(tareasTable).where(eq(tareasTable.id, parsed.data.id));
    const allowed =
      tarea &&
      (ctx.isOrgAdmin && ctx.organizationId != null
        ? tarea.organizationId === ctx.organizationId
        : tarea.userId === userId);
    if (!allowed) {
      res.status(404).json({ error: "Tarea no encontrada" });
      return;
    }
    const [updated] = await db
      .update(tareasTable)
      .set({ estado: "completada", completadoEn: new Date() })
      .where(eq(tareasTable.id, tarea.id))
      .returning();
    let clienteNombre: string | null = null;
    if (updated!.cobroId != null) {
      const [c] = await db
        .select({ clienteNombre: cobrosTable.clienteNombre })
        .from(cobrosTable)
        .where(eq(cobrosTable.id, updated!.cobroId));
      clienteNombre = c?.clienteNombre ?? null;
    }
    res.json(serializeTarea(updated!, clienteNombre));
  } catch (err) {
    req.log.error({ err }, "Error completing tarea");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default tareasRouter;
