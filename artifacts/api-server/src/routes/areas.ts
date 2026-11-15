/**
 * Áreas, departamentos y centros de costo de una organización.
 * Solo admin_org puede crear/editar/eliminar áreas.
 * Todos los miembros pueden listar las áreas de su organización.
 */
import { Router } from "express";
import { db, areasOrgTable, usersTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { getOrgContext } from "../lib/org";
import { requireSubscription } from "../middlewares/requireSubscription";
import { z } from "zod/v4";

export const areasRouter = Router();

// GET /api/areas — lista todas las áreas de la organización del usuario
areasRouter.get("/areas", requireSubscription, async (req, res) => {
  const userId = (req.user as { id: string } | undefined)?.id;
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  const ctx = await getOrgContext(userId);
  if (!ctx.organizationId) return res.status(404).json({ error: "Sin organización" });

  const areas = await db
    .select()
    .from(areasOrgTable)
    .where(
      and(
        eq(areasOrgTable.organizationId, ctx.organizationId),
        eq(areasOrgTable.activa, "true"),
      ),
    )
    .orderBy(asc(areasOrgTable.nombre));

  // Enrich with miembros count
  const areaIds = areas.map((a) => a.id);
  let miembrosPorArea: Record<number, number> = {};
  if (areaIds.length > 0) {
    const miembros = await db
      .select({ areaId: usersTable.areaId, id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.organizationId, ctx.organizationId));
    for (const m of miembros) {
      if (m.areaId != null) {
        miembrosPorArea[m.areaId] = (miembrosPorArea[m.areaId] ?? 0) + 1;
      }
    }
  }

  return res.json(
    areas.map((a) => ({ ...a, miembros: miembrosPorArea[a.id] ?? 0 })),
  );
});

// POST /api/areas — crea un área (solo admin_org)
const crearAreaSchema = z.object({
  nombre: z.string().min(1).max(100),
  tipo: z.enum(["area", "departamento", "centro_costo"]).optional().default("area"),
  descripcion: z.string().max(500).optional(),
  parentAreaId: z.number().int().positive().optional(),
  responsableId: z.string().optional(),
});

areasRouter.post("/areas", requireSubscription, async (req, res) => {
  const userId = (req.user as { id: string } | undefined)?.id;
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  const ctx = await getOrgContext(userId);
  if (!ctx.isOrgAdmin) return res.status(403).json({ error: "Solo el administrador puede gestionar áreas" });
  if (!ctx.organizationId) return res.status(404).json({ error: "Sin organización" });

  const parsed = crearAreaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const { nombre, tipo, descripcion, parentAreaId, responsableId } = parsed.data;

  const [area] = await db
    .insert(areasOrgTable)
    .values({
      organizationId: ctx.organizationId,
      nombre,
      tipo,
      descripcion: descripcion ?? null,
      parentAreaId: parentAreaId ?? null,
      responsableId: responsableId ?? null,
    })
    .returning();

  return res.status(201).json(area);
});

// PATCH /api/areas/:id — actualiza un área (solo admin_org)
const actualizarAreaSchema = z.object({
  nombre: z.string().min(1).max(100).optional(),
  tipo: z.enum(["area", "departamento", "centro_costo"]).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  parentAreaId: z.number().int().positive().nullable().optional(),
  responsableId: z.string().nullable().optional(),
});

areasRouter.patch("/areas/:id", requireSubscription, async (req, res) => {
  const userId = (req.user as { id: string } | undefined)?.id;
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  const ctx = await getOrgContext(userId);
  if (!ctx.isOrgAdmin) return res.status(403).json({ error: "Solo el administrador puede gestionar áreas" });
  if (!ctx.organizationId) return res.status(404).json({ error: "Sin organización" });

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const parsed = actualizarAreaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  // Verify the area belongs to the org
  const [existing] = await db
    .select({ id: areasOrgTable.id })
    .from(areasOrgTable)
    .where(and(eq(areasOrgTable.id, id), eq(areasOrgTable.organizationId, ctx.organizationId)));
  if (!existing) return res.status(404).json({ error: "Área no encontrada" });

  const updates: Partial<typeof areasOrgTable.$inferInsert> = {};
  const d = parsed.data;
  if (d.nombre !== undefined) updates.nombre = d.nombre;
  if (d.tipo !== undefined) updates.tipo = d.tipo;
  if (d.descripcion !== undefined) updates.descripcion = d.descripcion;
  if (d.parentAreaId !== undefined) updates.parentAreaId = d.parentAreaId;
  if (d.responsableId !== undefined) updates.responsableId = d.responsableId;

  const [updated] = await db
    .update(areasOrgTable)
    .set(updates)
    .where(eq(areasOrgTable.id, id))
    .returning();

  return res.json(updated);
});

// DELETE /api/areas/:id — desactiva un área (solo admin_org)
areasRouter.delete("/areas/:id", requireSubscription, async (req, res) => {
  const userId = (req.user as { id: string } | undefined)?.id;
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  const ctx = await getOrgContext(userId);
  if (!ctx.isOrgAdmin) return res.status(403).json({ error: "Solo el administrador puede gestionar áreas" });
  if (!ctx.organizationId) return res.status(404).json({ error: "Sin organización" });

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [existing] = await db
    .select({ id: areasOrgTable.id })
    .from(areasOrgTable)
    .where(and(eq(areasOrgTable.id, id), eq(areasOrgTable.organizationId, ctx.organizationId)));
  if (!existing) return res.status(404).json({ error: "Área no encontrada" });

  await db
    .update(areasOrgTable)
    .set({ activa: "false" })
    .where(eq(areasOrgTable.id, id));

  return res.json({ ok: true, mensaje: "Área desactivada" });
});
