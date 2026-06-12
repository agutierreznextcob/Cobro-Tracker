import { Router } from "express";
import { db, cobrosTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  CreateCobroBody,
  UpdateCobroBody,
  GetCobroParams,
  UpdateCobroParams,
} from "@workspace/api-zod";

const cobrosRouter = Router();

cobrosRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

cobrosRouter.get("/cobros", async (req, res) => {
  try {
    const cobros = await db
      .select()
      .from(cobrosTable)
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
  const user = req.isAuthenticated() ? req.user : null;
  const responsableNombre = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null
    : null;

  try {
    const [cobro] = await db
      .insert(cobrosTable)
      .values({
        monto: String(monto),
        descripcion,
        referencia: referencia ?? null,
        estado: "pendiente",
        responsableId: user?.id ?? null,
        responsableNombre,
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

export default cobrosRouter;
