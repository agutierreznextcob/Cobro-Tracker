import { Router, type IRouter, type Request } from "express";
import { db, leadsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { CrearLeadPublicoBody, ActualizarLeadEstadoBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { sendLeadNotificationEmail } from "../lib/email";

const leadsRouter: IRouter = Router();

const ESTADOS = ["nuevo", "contactado", "en_proceso", "cerrado", "descartado"] as const;

// ---- Abuse protection for the unauthenticated lead form ---------------------
// Fixed-window limiter so a single visitor (or the whole world) can't spam the
// sales inbox. Per-IP cap stops one source; global cap bounds total volume.
const WINDOW_MS = 60_000;
const PER_IP_MAX = 5;
const GLOBAL_MAX = 60;

type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { count: 0, resetAt: Date.now() + WINDOW_MS };

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of ipBuckets) {
    if (now > b.resetAt) ipBuckets.delete(ip);
  }
}, WINDOW_MS).unref();

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim();
  return req.ip ?? "unknown";
}

function isRateLimited(req: Request): boolean {
  const now = Date.now();
  if (now > globalBucket.resetAt) globalBucket = { count: 0, resetAt: now + WINDOW_MS };
  globalBucket.count += 1;
  if (globalBucket.count > GLOBAL_MAX) return true;

  const ip = getClientIp(req);
  let bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count > PER_IP_MAX;
}

function mapLead(l: typeof leadsTable.$inferSelect) {
  return {
    id: l.id,
    nombre: l.nombre,
    telefono: l.telefono,
    email: l.email,
    mensaje: l.mensaje,
    estado: l.estado,
    creadoEn: l.creadoEn.toISOString(),
    actualizadoEn: l.actualizadoEn.toISOString(),
  };
}

// ---- Public endpoint: submit a lead from the landing page -------------------
leadsRouter.post("/public/leads", async (req, res) => {
  if (isRateLimited(req)) {
    res.status(429).json({ error: "Demasiadas solicitudes. Inténtalo más tarde." });
    return;
  }

  const parsed = CrearLeadPublicoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }

  const { nombre, telefono, email, mensaje } = parsed.data;

  try {
    const [lead] = await db
      .insert(leadsTable)
      .values({
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        email: email.trim(),
        mensaje: mensaje?.trim() || null,
        estado: "nuevo",
      })
      .returning();

    // Fire-and-forget the sales notification; never block the visitor on email.
    sendLeadNotificationEmail(
      { nombre: lead!.nombre, telefono: lead!.telefono, email: lead!.email, mensaje: lead!.mensaje },
      req.log,
    ).catch((err) => {
      req.log.warn({ err }, "Unhandled error sending lead notification email");
    });

    res.status(201).json({ ok: true, id: lead!.id });
  } catch (err) {
    req.log.error({ err }, "Error creating lead");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- Admin endpoints: gated behind the platform admin role ------------------
leadsRouter.use("/leads", requireAdmin);

leadsRouter.get("/leads/nuevos/count", async (req, res) => {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(eq(leadsTable.estado, "nuevo"));
    res.json({ count: row?.count ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Error counting new leads");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

leadsRouter.get("/leads", async (req, res) => {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  try {
    const conditions = [];
    if (estado && (ESTADOS as readonly string[]).includes(estado)) {
      conditions.push(eq(leadsTable.estado, estado));
    }
    const rows = await db
      .select()
      .from(leadsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(leadsTable.creadoEn));
    res.json(rows.map(mapLead));
  } catch (err) {
    req.log.error({ err }, "Error listing leads");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

leadsRouter.patch("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = ActualizarLeadEstadoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Estado inválido" });
    return;
  }

  try {
    const [updated] = await db
      .update(leadsTable)
      .set({ estado: parsed.data.estado, actualizadoEn: new Date() })
      .where(eq(leadsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Lead no encontrado" });
      return;
    }
    res.json(mapLead(updated));
  } catch (err) {
    req.log.error({ err }, "Error updating lead");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default leadsRouter;
