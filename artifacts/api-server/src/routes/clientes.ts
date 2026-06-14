import { Router } from "express";
import { db, clientesTable, cobrosTable } from "@workspace/db";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import { z } from "zod";

const clientesRouter = Router();

clientesRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

const ClienteInputSchema = z.object({
  nombre: z.string().min(1).max(200),
  rut: z.string().max(20).optional(),
  email: z.string().email().max(200).optional().or(z.literal("")),
  telefono: z.string().max(30).optional(),
});

clientesRouter.get("/clientes", async (req, res) => {
  const userId = req.user!.id;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;

  try {
    const baseWhere = eq(clientesTable.userId, userId);
    const rows = await db
      .select()
      .from(clientesTable)
      .where(
        q
          ? and(baseWhere, or(ilike(clientesTable.nombre, `%${q}%`), ilike(clientesTable.rut, `%${q}%`)))
          : baseWhere
      )
      .orderBy(desc(clientesTable.creadoEn));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error listing clientes");
    res.status(500).json({ error: "Error interno" });
  }
});

clientesRouter.post("/clientes", async (req, res) => {
  const userId = req.user!.id;
  const parsed = ClienteInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const { nombre, rut, email, telefono } = parsed.data;
    const [created] = await db
      .insert(clientesTable)
      .values({
        nombre,
        rut: rut || null,
        email: email || null,
        telefono: telefono || null,
        userId,
      })
      .returning();

    req.log.info({ clienteId: created.id }, "Cliente created");
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Error creating cliente");
    res.status(500).json({ error: "Error interno" });
  }
});

clientesRouter.get("/clientes/:id", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const [cliente] = await db
      .select()
      .from(clientesTable)
      .where(and(eq(clientesTable.id, id), eq(clientesTable.userId, userId)));

    if (!cliente) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    const cobros = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.clienteId, id))
      .orderBy(desc(cobrosTable.creadoEn));

    res.json({ ...cliente, cobros });
  } catch (err) {
    req.log.error({ err }, "Error getting cliente");
    res.status(500).json({ error: "Error interno" });
  }
});

clientesRouter.patch("/clientes/:id", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = ClienteInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(clientesTable)
      .where(and(eq(clientesTable.id, id), eq(clientesTable.userId, userId)));

    if (!existing) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    const { nombre, rut, email, telefono } = parsed.data;
    const [updated] = await db
      .update(clientesTable)
      .set({
        nombre,
        rut: rut || null,
        email: email || null,
        telefono: telefono || null,
        actualizadoEn: new Date(),
      })
      .where(eq(clientesTable.id, id))
      .returning();

    req.log.info({ clienteId: id }, "Cliente updated");
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating cliente");
    res.status(500).json({ error: "Error interno" });
  }
});

export default clientesRouter;
