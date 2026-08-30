import { Router, type IRouter, type Request, type Response } from "express";
import { db, tareasTable, cobrosTable, usersTable, type Tarea } from "@workspace/db";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { CompletarTareaParams, CreateTareaBody, ListTareasQueryParams, UpdateTareaEstadoBody } from "@workspace/api-zod";
import { getOrgContext, canAssignTo, userCanAccessCobro, type OrgContext } from "../lib/org";

const tareasRouter: IRouter = Router();

// Prefix-scoped so public routes mounted later are never intercepted.
tareasRouter.use("/tareas", (req, res, next) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "No autorizado" });
  next();
});

function tareaScope(ctx: OrgContext, userId: string): SQL {
  if (ctx.isOrgAdmin && ctx.organizationId != null) return eq(tareasTable.organizationId, ctx.organizationId);
  if (ctx.isSupervisor) return inArray(tareasTable.userId, ctx.teamMemberIds.length ? ctx.teamMemberIds : [userId]);
  return eq(tareasTable.userId, userId);
}

function chileDay(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function addCalendarDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function serializeTarea(t: Tarea, clienteNombre: string | null, responsableNombre: string | null) {
  return {
    id: t.id, organizationId: t.organizationId, userId: t.userId, cobroId: t.cobroId,
    titulo: t.titulo, descripcion: t.descripcion, estado: t.estado, origen: t.origen,
    clienteNombre, responsableNombre, creadoEn: t.creadoEn.toISOString(),
    completadoEn: t.completadoEn?.toISOString() ?? null, venceEn: t.venceEn?.toISOString() ?? null,
    canceladoEn: t.canceladoEn?.toISOString() ?? null,
  };
}

async function enrich(rows: Tarea[]) {
  const cobroIds = [...new Set(rows.flatMap((r) => r.cobroId == null ? [] : [r.cobroId]))];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [cobros, users] = await Promise.all([
    cobroIds.length ? db.select({ id: cobrosTable.id, clienteNombre: cobrosTable.clienteNombre }).from(cobrosTable).where(inArray(cobrosTable.id, cobroIds)) : [],
    db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds)),
  ]);
  const clientes = new Map(cobros.map((c) => [c.id, c.clienteNombre ?? null]));
  const nombres = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || null]));
  return rows.map((t) => serializeTarea(t, t.cobroId == null ? null : clientes.get(t.cobroId) ?? null, nombres.get(t.userId) ?? null));
}

tareasRouter.get("/tareas", async (req, res) => {
  const parsed = ListTareasQueryParams.safeParse({ estado: req.query.estado, responsableId: req.query.responsableId, cobroId: req.query.cobroId, fecha: req.query.fecha });
  if (!parsed.success) return void res.status(400).json({ error: "Filtros inválidos" });
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const { estado, responsableId, cobroId, fecha } = parsed.data;
    if (responsableId && !canAssignTo(ctx, userId, responsableId)) return void res.json([]);
    const conds: SQL[] = [tareaScope(ctx, userId)];
    if (estado) conds.push(eq(tareasTable.estado, estado));
    if (responsableId) conds.push(eq(tareasTable.userId, responsableId));
    if (cobroId) conds.push(eq(tareasTable.cobroId, cobroId));
    const today = chileDay(new Date());
    const lastNextWeekDay = addCalendarDays(today, 7);
    const rows = (await db.select().from(tareasTable).where(and(...conds)))
      .filter((t) => {
        if (!fecha || fecha === "todas") return true;
        if (!t.venceEn) return false;
        const dueDay = chileDay(t.venceEn);
        if (fecha === "vencidas") return dueDay < today;
        if (fecha === "hoy") return dueDay === today;
        return dueDay > today && dueDay <= lastNextWeekDay;
      })
      .sort((a, b) => {
        if (!a.venceEn && !b.venceEn) return b.creadoEn.getTime() - a.creadoEn.getTime();
        if (!a.venceEn) return 1;
        if (!b.venceEn) return -1;
        return a.venceEn.getTime() - b.venceEn.getTime() || b.creadoEn.getTime() - a.creadoEn.getTime();
      });
    res.json(await enrich(rows));
  } catch (err) { req.log.error({ err }, "Error listing tareas"); res.status(500).json({ error: "Error interno del servidor" }); }
});

tareasRouter.post("/tareas", async (req, res) => {
  const parsed = CreateTareaBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const target = parsed.data.responsableId ?? userId;
    if (!canAssignTo(ctx, userId, target)) return void res.status(404).json({ error: "Responsable no encontrado" });
    if (ctx.isOrgAdmin && ctx.organizationId != null) {
      const [responsable] = await db.select({ organizationId: usersTable.organizationId }).from(usersTable).where(eq(usersTable.id, target));
      if (!responsable || responsable.organizationId !== ctx.organizationId) {
        return void res.status(404).json({ error: "Responsable no encontrado" });
      }
    }
    if (parsed.data.cobroId != null) {
      const [cobro] = await db.select({ id: cobrosTable.id, organizationId: cobrosTable.organizationId, responsableId: cobrosTable.responsableId }).from(cobrosTable).where(eq(cobrosTable.id, parsed.data.cobroId));
      if (!cobro || !userCanAccessCobro(ctx, userId, cobro)) return void res.status(404).json({ error: "Cobro no encontrado" });
    }
    const [tarea] = await db.insert(tareasTable).values({
      organizationId: ctx.organizationId, userId: target, cobroId: parsed.data.cobroId ?? null,
      titulo: parsed.data.titulo.trim(), descripcion: parsed.data.descripcion?.trim() || null,
      // Store date-only due dates at UTC noon so they remain on the same
      // calendar day when classified in America/Santiago.
      venceEn: parsed.data.venceEn
        ? new Date(`${parsed.data.venceEn.toISOString().slice(0, 10)}T12:00:00.000Z`)
        : null,
      origen: "manual",
    }).returning();
    res.status(201).json((await enrich([tarea]))[0]);
  } catch (err) { req.log.error({ err }, "Error creating tarea"); res.status(500).json({ error: "Error interno del servidor" }); }
});

async function updateState(req: Request, res: Response, estado: "pendiente" | "completada" | "cancelada") {
  const parsed = CompletarTareaParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return void res.status(400).json({ error: "ID inválido" });
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [tarea] = await db.select().from(tareasTable).where(and(eq(tareasTable.id, parsed.data.id), tareaScope(ctx, userId)));
    if (!tarea) return void res.status(404).json({ error: "Tarea no encontrada" });
    const now = new Date();
    const [updated] = await db.update(tareasTable).set({
      estado, completadoEn: estado === "completada" ? now : null, canceladoEn: estado === "cancelada" ? now : null,
    }).where(eq(tareasTable.id, tarea.id)).returning();
    res.json((await enrich([updated]))[0]);
  } catch (err) { req.log.error({ err }, "Error updating tarea"); res.status(500).json({ error: "Error interno del servidor" }); }
}

tareasRouter.post("/tareas/:id/completar", (req, res) => updateState(req, res, "completada"));
tareasRouter.patch("/tareas/:id/estado", (req, res) => {
  const parsed = UpdateTareaEstadoBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  return updateState(req, res, parsed.data.estado);
});

export default tareasRouter;