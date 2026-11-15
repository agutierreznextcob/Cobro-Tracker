import { randomBytes } from "crypto";
import { Router } from "express";
import { db, clientesTable, cobrosTable, organizacionesTable } from "@workspace/db";
import { eq, and, or, ilike, desc, type SQL } from "drizzle-orm";
import { z } from "zod";
import { EnviarPortalClienteBody } from "@workspace/api-zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { getOrgContext, userCanAccessCliente, getRemitenteContacto, cobroScopeCondition, clienteScopeCondition } from "../lib/org";
import { computeClienteScores } from "../lib/scoring";
import { userTieneFeature } from "../middlewares/requirePlanFeature";
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
  empresa: z.string().max(200).optional().or(z.literal("")),
  direccion: z.string().max(500).optional().or(z.literal("")),
  giro: z.string().max(300).optional(),
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
    const [scores, tienePredictivo] = await Promise.all([
      computeClienteScores(
        rows.map((r) => r.id),
        scopeCobros,
      ),
      userTieneFeature(userId, "scoring_predictivo"),
    ]);

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
        // Scoring predictivo: solo plan NextCob.
        probabilidadPago: tienePredictivo ? (s?.probabilidadPago ?? null) : null,
      };
    });

    res.json(conScore);
  } catch (err) {
    req.log.error({ err }, "Error listing clientes");
    res.status(500).json({ error: "Error interno" });
  }
});

// ---------------------------------------------------------------------------
// GET /clientes/buscar-rut/:rut — consulta datos del contribuyente en el SII
// Devuelve razón social y giro si el RUT existe y tiene inicio de actividades.
// ---------------------------------------------------------------------------
clientesRouter.get("/clientes/buscar-rut/:rut", async (req, res) => {
  const { normalizeRut } = await import("../lib/rut");
  const rawRut = req.params.rut;
  const normalized = normalizeRut(rawRut);
  if (!normalized) {
    res.status(400).json({ error: "RUT inválido" });
    return;
  }

  // Separar cuerpo y dígito verificador
  const [body, dv] = normalized.split("-");

  try {
    // El SII expone un endpoint XML que no requiere captcha para esta consulta
    const url = `https://zeus.sii.cl/cvc_cgi/stc/getstc?RUT=${body}&DV=${dv.toUpperCase()}`;
    const response = await fetch(url, {
      headers: {
        "Referer": "https://zeus.sii.cl/cvc/stc/stc.html",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      res.status(502).json({ error: "El SII no respondió. Ingresa los datos manualmente." });
      return;
    }

    const xml = await response.text();

    // Extraer campos del XML de respuesta del SII
    const razonSocial = xml.match(/<RAZON_SOCIAL>([\s\S]*?)<\/RAZON_SOCIAL>/)?.[1]?.trim() ?? null;
    const giroRaw = xml.match(/<GIRO_DESCRIPCION>([\s\S]*?)<\/GIRO_DESCRIPCION>/)?.[1]?.trim() ?? null;
    // Algunos formatos alternativos del SII
    const razonAlt = xml.match(/<nombre>([\s\S]*?)<\/nombre>/i)?.[1]?.trim() ?? null;
    const giroAlt = xml.match(/<giro>([\s\S]*?)<\/giro>/i)?.[1]?.trim() ?? null;

    const nombre = razonSocial ?? razonAlt;
    const giro = giroRaw ?? giroAlt;

    if (!nombre) {
      // RUT no encontrado o sin actividades en el SII
      res.status(404).json({ error: "RUT no encontrado en el SII. Verifica el número o ingresa los datos manualmente." });
      return;
    }

    res.json({ rut: normalized, nombre, giro: giro ?? null });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TimeoutError") {
      res.status(504).json({ error: "El SII tardó demasiado. Ingresa los datos manualmente." });
      return;
    }
    req.log.warn({ err }, "Error consultando SII");
    res.status(502).json({ error: "No se pudo consultar el SII. Ingresa los datos manualmente." });
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
    const { nombre, empresa, rut, email, telefono, direccion, giro } = parsed.data;
    const [created] = await db
      .insert(clientesTable)
      .values({
        nombre,
        direccion: direccion || null,
        giro: giro || null,
        empresa: empresa || null,
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

// ── Bulk import ───────────────────────────────────────────────────────────────
// The frontend parses the uploaded Excel and sends plain rows; we validate each
// row (RUT chileno, email) and skip duplicates (existing RUT in the caller's
// scope or repeated within the file), returning a per-row summary.
const ImportarClienteRow = z.object({
  nombre: z.string().max(200).optional().or(z.literal("")),
  empresa: z.string().max(200).optional().or(z.literal("")),
  rut: z.string().max(20).optional().or(z.literal("")),
  email: z.string().max(200).optional().or(z.literal("")),
  telefono: z.string().max(30).optional().or(z.literal("")),
});
const ImportarClientesBody = z.object({
  clientes: z.array(ImportarClienteRow).min(1).max(500),
});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

clientesRouter.post("/clientes/importar", async (req, res) => {
  const userId = req.user!.id;
  const parsed = ImportarClientesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de importación inválidos" });
    return;
  }

  try {
    const ctx = await getOrgContext(userId);
    // Existing RUTs within the caller's visibility scope (normalized).
    const existentes = await db
      .select({ rut: clientesTable.rut })
      .from(clientesTable)
      .where(clienteScopeCondition(ctx, userId));
    const normalizar = (r: string) => r.replace(/\./g, "").replace(/-/g, "").toLowerCase();
    const rutsExistentes = new Set(
      existentes.map((e) => (e.rut ? normalizar(e.rut) : "")).filter(Boolean),
    );

    const omitidos: { fila: number; nombre: string; motivo: string }[] = [];
    const aInsertar: {
      nombre: string;
      empresa: string | null;
      rut: string;
      email: string;
      telefono: string | null;
    }[] = [];
    const vistosEnArchivo = new Set<string>();

    parsed.data.clientes.forEach((row, i) => {
      const fila = i + 2; // 1-based + header row, matches the Excel row number
      const nombre = (row.nombre ?? "").trim();
      const rut = (row.rut ?? "").trim();
      const email = (row.email ?? "").trim();
      const telefono = (row.telefono ?? "").trim();
      const empresa = (row.empresa ?? "").trim();

      const omitir = (motivo: string): void => {
        omitidos.push({ fila, nombre: nombre || "(sin nombre)", motivo });
      };
      if (!nombre) return omitir("Falta el nombre");
      if (!rut) return omitir("Falta el RUT");
      if (!isValidRut(rut)) return omitir(`RUT inválido (${rut})`);
      if (!email) return omitir("Falta el email");
      if (!EMAIL_RE.test(email)) return omitir(`Email inválido (${email})`);

      const rutNorm = normalizar(rut);
      if (rutsExistentes.has(rutNorm)) return omitir(`RUT ya existe (${rut})`);
      if (vistosEnArchivo.has(rutNorm)) return omitir(`RUT repetido en el archivo (${rut})`);

      vistosEnArchivo.add(rutNorm);
      aInsertar.push({ nombre, empresa: empresa || null, rut, email, telefono: telefono || null });
    });

    if (aInsertar.length > 0) {
      await db.insert(clientesTable).values(
        aInsertar.map((c) => ({
          ...c,
          userId,
          organizationId: ctx.organizationId ?? null,
        })),
      );
    }

    req.log.info(
      { importados: aInsertar.length, omitidos: omitidos.length },
      "Clientes importados masivamente",
    );
    res.json({ importados: aInsertar.length, omitidos });
  } catch (err) {
    req.log.error({ err }, "Error importing clientes");
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

    const [scores, tienePredictivo] = await Promise.all([
      computeClienteScores([id], scopeCobros),
      userTieneFeature(userId, "scoring_predictivo"),
    ]);
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
      // Scoring predictivo: solo plan NextCob.
      probabilidadPago: tienePredictivo ? (s?.probabilidadPago ?? null) : null,
      fechaEstimadaPago: tienePredictivo ? (s?.fechaEstimadaPago ?? null) : null,
      promesasIncumplidas: tienePredictivo ? (s?.promesasIncumplidas ?? 0) : 0,
      ultimoContactoEn: tienePredictivo ? (s?.ultimoContactoEn ?? null) : null,
      recomendacion: tienePredictivo ? (s?.recomendacion ?? null) : null,
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

    const { nombre, empresa, rut, email, telefono, direccion, giro } = parsed.data;
    const [updated] = await db
      .update(clientesTable)
      .set({
        nombre,
        ...(direccion !== undefined ? { direccion: direccion || null } : {}),
        ...(giro !== undefined ? { giro: giro || null } : {}),
        empresa: empresa || null,
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

clientesRouter.delete("/clientes/:id", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  try {
    const ctx = await getOrgContext(userId);
    const [existing] = await db.select().from(clientesTable).where(eq(clientesTable.id, id));
    if (!existing || !userCanAccessCliente(ctx, userId, existing)) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }
    // Check for active cobros
    const [cobroActivo] = await db
      .select({ id: cobrosTable.id })
      .from(cobrosTable)
      .where(and(eq(cobrosTable.clienteId, id), cobroScopeCondition(ctx, userId)))
      .limit(1);
    if (cobroActivo) {
      res.status(409).json({ error: "No se puede eliminar un cliente que tiene cobros asociados. Elimina primero sus cobros." });
      return;
    }
    await db.delete(clientesTable).where(eq(clientesTable.id, id));
    req.log.info({ clienteId: id }, "Cliente deleted");
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting cliente");
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
      .set({ portalToken: token, portalTokenGeneradoEn: new Date(), actualizadoEn: new Date() })
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
        .set({ portalToken: token, portalTokenGeneradoEn: new Date(), actualizadoEn: new Date() })
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

    // Record the last successful send (date + channel(s) that actually went out)
    // so ejecutivos can see whether the debtor already got the current link.
    let portalEnviadoEn: Date | null = null;
    let portalEnviadoCanal: string | null = null;
    if (emailEnviado || whatsappEnviado) {
      portalEnviadoEn = new Date();
      portalEnviadoCanal =
        emailEnviado && whatsappEnviado ? "ambos" : emailEnviado ? "email" : "whatsapp";
      await db
        .update(clientesTable)
        .set({ portalEnviadoEn, portalEnviadoCanal, actualizadoEn: new Date() })
        .where(eq(clientesTable.id, id));
    }

    req.log.info({ clienteId: id, canal, emailEnviado, whatsappEnviado }, "Portal link sent");
    res.json({
      ok: true,
      url,
      emailEnviado,
      whatsappEnviado,
      portalEnviadoEn: portalEnviadoEn ? portalEnviadoEn.toISOString() : null,
      portalEnviadoCanal,
    });
  } catch (err) {
    req.log.error({ err }, "Error sending portal link");
    res.status(500).json({ error: "Error interno" });
  }
});

export default clientesRouter;
