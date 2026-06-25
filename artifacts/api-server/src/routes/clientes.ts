import { randomBytes } from "crypto";
import { Router } from "express";
import { db, clientesTable, cobrosTable, organizacionesTable } from "@workspace/db";
import { eq, and, or, ilike, desc, type SQL } from "drizzle-orm";
import { z } from "zod";
import { EnviarPortalClienteBody } from "@workspace/api-zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { getOrgContext, userCanAccessCliente, getRemitenteContacto } from "../lib/org";
import { getPublicBaseUrl } from "../lib/flow-api";
import { sendPortalEmail } from "../lib/email";
import { isWhatsAppConfigured, sendWhatsAppMensaje } from "../lib/whatsapp";

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
  rut: z.string().max(20).optional(),
  email: z.string().email().max(200).optional().or(z.literal("")),
  telefono: z.string().max(30).optional(),
});

clientesRouter.get("/clientes", async (req, res) => {
  const userId = req.user!.id;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;

  try {
    const ctx = await getOrgContext(userId);
    // admin_org sees every client in the organization; everyone else only their own.
    const baseWhere: SQL =
      ctx.isOrgAdmin && ctx.organizationId != null
        ? eq(clientesTable.organizationId, ctx.organizationId)
        : eq(clientesTable.userId, userId);
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
