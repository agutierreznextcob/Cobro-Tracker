import { randomBytes } from "crypto";
import { Router } from "express";
import { db, clientesTable, cobrosTable, organizacionesTable } from "@workspace/db";
import { eq, and, or, ilike, desc, type SQL } from "drizzle-orm";
import { z } from "zod";
import { EnviarPortalClienteBody } from "@workspace/api-zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { getOrgContext, userCanAccessCliente, getRemitenteContacto, cobroScopeCondition, clienteScopeCondition } from "../lib/org";
import { computeClienteScores } from "../lib/scoring";
import { getPublicBaseUrl } from "../lib/flow-api";
import { sendPortalEmail } from "../lib/email";
import { isWhatsAppConfigured, sendWhatsAppMensaje } from "../lib/whatsapp";
import { isValidRut } from "../lib/rut";

const clientesRouter = Router();

clientesRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});
clientesRouter.use(requireSubscription);

const ClienteInputSchema = z.object({
  nombre: z.string().min(1).max(200),
  rut: z
    .string()
    .max(20)
    .optional()
    .refine((v) => !v || v.trim() === "" || isValidRut(v), {
      message: "RUT inválido",
    }),
  email: z.string().email().max(200).optional().or(z.literal("")),
  telefono: z.string().max(30).optional(),
});

clientesRouter.get("/clientes", async (req, res) => {
  const userId = req.user!.id;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;

  try {
    const ctx = await getOrgContext(userId);
    // admin_org sees every client in the org; supervisor their team's; everyone else their own.
    const baseWhere: SQL = clienteScopeCondition(ctx, userId);
    const rows = await db
      .select()
      .from(clientesTable)
      .where(
        q
          ? and(baseWhere, or(ilike(clientesTable.nombre, `%${q}%`), ilike(clientesTable.rut, `%${q}%`)))
          : baseWhere
      )
      .orderBy(desc(clientesTable.creadoEn));

    const scopeCobros = cobroScopeCondition(ctx, userId);
    const scores = await computeClienteScores(
      rows.map((r) => r.id),
      scopeCobros,
    );

    const conScore = rows.map((r) => {
      const s = scores.get(r.id);
      return {
        ...r,
        score: s?.score ?? null,
        categoria: s?.categoria ?? "sin_datos",
        totalCobros: s?.totalCobros ?? 0,
        totalCobrado: s?.totalCobrado ?? 0,
        totalPendiente: s?.totalPendiente ?? 0,
        promedioDiasAtraso: s?.promedioDiasAtraso ?? 0,
        cobrosVencidos: s?.cobrosVencidos ?? 0,
      };
    });

    res.json(conScore);
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
    const ctx = await getOrgContext(userId);
    const { nombre, rut, email, telefono } = parsed.data;
    const [created] = await db
      .insert(clientesTable)
      .values({
        nombre,
        rut: rut || null,
        email: email || null,
        telefono: telefono || null,
        userId,
        organizationId: ctx.organizationId ?? null,
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
    const ctx = await getOrgContext(userId);
    const [cliente] = await db
      .select()
      .from(clientesTable)
      .where(eq(clientesTable.id, id));

    if (!cliente || !userCanAccessCliente(ctx, userId, cliente)) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    const scopeCobros = cobroScopeCondition(ctx, userId);
    const cobros = await db
      .select()
      .from(cobrosTable)
      .where(and(eq(cobrosTable.clienteId, id), scopeCobros))
      .orderBy(desc(cobrosTable.creadoEn));

    const scores = await computeClienteScores([id], scopeCobros);
    const s = scores.get(id);
    const scoreDetalle = {
      score: s?.score ?? null,
      categoria: s?.categoria ?? ("sin_datos" as const),
      totalCobros: s?.totalCobros ?? 0,
      totalCobrado: s?.totalCobrado ?? 0,
      totalPendiente: s?.totalPendiente ?? 0,
      promedioDiasAtraso: s?.promedioDiasAtraso ?? 0,
      cobrosVencidos: s?.cobrosVencidos ?? 0,
      factores: s?.factores ?? [],
    };

    res.json({ ...cliente, cobros, scoreDetalle });
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
    const ctx = await getOrgContext(userId);
    const [existing] = await db
      .select()
      .from(clientesTable)
      .where(eq(clientesTable.id, id));

    if (!existing || !userCanAccessCliente(ctx, userId, existing)) {
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

// Rotate the debtor portal token for a cliente, invalidating any previously
// shared link. Org-guarded like every other :id route.
clientesRouter.post("/clientes/:id/portal/regenerar", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const ctx = await getOrgContext(userId);
    const [cliente] = await db
      .select()
      .from(clientesTable)
      .where(eq(clientesTable.id, id));

    if (!cliente || !userCanAccessCliente(ctx, userId, cliente)) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    const token = randomBytes(24).toString("base64url");
    await db
      .update(clientesTable)
      .set({ portalToken: token, actualizadoEn: new Date() })
      .where(eq(clientesTable.id, id));

    req.log.info({ clienteId: id }, "Portal token regenerated");
    res.json({ ok: true, url: `${getPublicBaseUrl()}/portal/${token}` });
  } catch (err) {
    req.log.error({ err }, "Error regenerating portal token");
    res.status(500).json({ error: "Error interno" });
  }
});

// Generate (or reuse) the debtor portal magic link for a cliente and send it
// via email and/or WhatsApp. Org-guarded like every other :id route.
clientesRouter.post("/clientes/:id/portal", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = EnviarPortalClienteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Canal inválido" });
    return;
  }
  const canal = parsed.data.canal;

  try {
    const ctx = await getOrgContext(userId);
    const [cliente] = await db
      .select()
      .from(clientesTable)
      .where(eq(clientesTable.id, id));

    if (!cliente || !userCanAccessCliente(ctx, userId, cliente)) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    // Generate a token the first time the portal is shared for this cliente.
    let token = cliente.portalToken;
    if (!token) {
      token = randomBytes(24).toString("base64url");
      await db
        .update(clientesTable)
        .set({ portalToken: token, actualizadoEn: new Date() })
        .where(eq(clientesTable.id, id));
    }

    const url = `${getPublicBaseUrl()}/portal/${token}`;
    const remitente = await getRemitenteContacto(userId);

    let empresa = remitente.nombre || "NextCob";
    if (ctx.organizationId != null) {
      const [org] = await db
        .select({ nombre: organizacionesTable.nombre })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, ctx.organizationId));
      if (org?.nombre) empresa = org.nombre;
    }

    let emailEnviado = false;
    let whatsappEnviado = false;

    if ((canal === "email" || canal === "ambos") && cliente.email) {
      const result = await sendPortalEmail(
        {
          emailDestino: cliente.email,
          clienteNombre: cliente.nombre,
          empresa,
          url,
          remitenteNombre: remitente.nombre,
          remitenteEmail: remitente.email,
        },
        req.log,
      );
      emailEnviado = result.ok;
    }

    if ((canal === "whatsapp" || canal === "ambos") && cliente.telefono && isWhatsAppConfigured()) {
      const mensaje = `Hola ${cliente.nombre}, ${empresa} habilitó tu portal de pagos. Revisa y paga tus cobros aquí: ${url}`;
      const result = await sendWhatsAppMensaje(
        { telefono: cliente.telefono, mensaje },
        req.log,
      );
      whatsappEnviado = result.ok;
    }

    req.log.info({ clienteId: id, canal, emailEnviado, whatsappEnviado }, "Portal link sent");
    res.json({ ok: true, url, emailEnviado, whatsappEnviado });
  } catch (err) {
    req.log.error({ err }, "Error sending portal link");
    res.status(500).json({ error: "Error interno" });
  }
});

export default clientesRouter;
