import { Router } from "express";
import { db, cobrosTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  CreateCobroBody,
  UpdateCobroBody,
  GetCobroParams,
  UpdateCobroParams,
} from "@workspace/api-zod";
import { z } from "zod";
import { getFlowCredentials } from "./profile";
import { crearOrdenFlow } from "../lib/flow-api";

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
  const emailPagador = (parsed.data as Record<string, unknown>).emailPagador as string | undefined;
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
        emailPagador: emailPagador ?? null,
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

const GenerarFlowLinkInput = z.object({
  emailPagador: z.string().email("Email inválido"),
});

cobrosRouter.post("/cobros/:id/flow-link", async (req, res) => {
  const paramsParsed = GetCobroParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const bodyParsed = GenerarFlowLinkInput.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const { emailPagador } = bodyParsed.data;
  const userId = req.user!.id;

  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, paramsParsed.data.id));

    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    if (cobro.flowLinkPago) {
      res.json({ linkPago: cobro.flowLinkPago, flowOrdenId: cobro.flowOrdenId! });
      return;
    }

    const creds = await getFlowCredentials(userId);
    if (!creds) {
      res.status(400).json({ error: "No tienes credenciales de Flow configuradas. Ve a tu perfil para configurarlas." });
      return;
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost"}`;
    const result = await crearOrdenFlow(creds.apiKey, creds.secretKey, {
      commerceOrder: `cobro-${cobro.id}`,
      subject: cobro.descripcion.slice(0, 200),
      currency: "CLP",
      amount: Math.round(Number(cobro.monto)),
      email: bodyParsed.data.emailPagador,
      urlConfirmation: `${baseUrl}/api/webhooks/flow`,
      urlReturn: `${baseUrl}/cobros/${cobro.id}`,
    });

    const [updated] = await db
      .update(cobrosTable)
      .set({
        flowOrdenId: String(result.flowOrder),
        flowLinkPago: result.url,
        emailPagador: bodyParsed.data.emailPagador,
        actualizadoEn: new Date(),
      })
      .where(eq(cobrosTable.id, cobro.id))
      .returning();

    req.log.info({ cobroId: cobro.id, flowOrder: result.flowOrder }, "Flow payment link created");
    res.json({ linkPago: updated.flowLinkPago!, flowOrdenId: updated.flowOrdenId! });
  } catch (err) {
    req.log.error({ err }, "Error creating Flow payment link");
    res.status(500).json({ error: `Error al crear orden en Flow: ${err instanceof Error ? err.message : String(err)}` });
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
