import { Router } from "express";
import { db, usersTable, cobrosTable, organizacionesTable } from "@workspace/db";
import { eq, sql, isNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { computeSubscriptionState } from "../lib/subscription";
import { computePricing } from "../lib/org";
import { sendRenovacionEmail } from "../lib/email";
import { getPublicBaseUrl } from "../lib/flow-api";

const adminRouter = Router();

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const TRIAL_DAYS = 14;

// All admin routes require an authenticated admin user.
adminRouter.use("/admin", (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});
adminRouter.use("/admin", requireAdmin);

function nombreDe(u: { firstName: string | null; lastName: string | null }): string | null {
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || null;
}

// Vencimiento (expiry) is the period end for active subs, otherwise the trial end.
function vencimientoDe(state: {
  status: "prueba" | "activa" | "vencida";
  periodEnd: string | null;
  trialEndsAt: string | null;
}): string | null {
  return state.status === "activa" ? state.periodEnd : state.trialEndsAt;
}

// Builds per-organization aggregates in two grouped queries (active member
// counts and total collected), so the user list doesn't issue per-row queries.
async function buildOrgAggregates(): Promise<{
  miembros: Map<number, number>;
  recaudado: Map<number, number>;
}> {
  const memberRows = await db
    .select({
      organizationId: usersTable.organizationId,
      count: sql<number>`count(*)::int`,
    })
    .from(usersTable)
    .where(eq(usersTable.activo, true))
    .groupBy(usersTable.organizationId);

  const recaudadoRows = await db
    .select({
      organizationId: cobrosTable.organizationId,
      total: sql<number>`coalesce(sum(${cobrosTable.monto}), 0)::float8`,
    })
    .from(cobrosTable)
    .where(eq(cobrosTable.estado, "pagado"))
    .groupBy(cobrosTable.organizationId);

  const miembros = new Map<number, number>();
  for (const r of memberRows) {
    if (r.organizationId != null) miembros.set(r.organizationId, r.count);
  }
  const recaudado = new Map<number, number>();
  for (const r of recaudadoRows) {
    if (r.organizationId != null)
      recaudado.set(r.organizationId, Math.round(r.total));
  }
  return { miembros, recaudado };
}

interface EnrichedUsuario {
  id: string;
  accountId: string | null;
  nombre: string | null;
  email: string | null;
  role: "user" | "admin";
  subscriptionStatus: "prueba" | "activa" | "vencida";
  hasAccess: boolean;
  isAdmin: boolean;
  tieneSuscripcion: boolean;
  createdAt: string | null;
  trialEndsAt: string | null;
  subscriptionPeriodEnd: string | null;
  vencimiento: string | null;
  diasParaVencer: number | null;
  requiereRecordatorio: boolean;
  rut: string | null;
  esDemo: boolean;
  activo: boolean;
  usuariosExtra: number;
  montoMensual: number;
  totalRecaudado: number;
}

async function buildUsuarios(): Promise<EnrichedUsuario[]> {
  const rows = await db.select().from(usersTable);
  const { miembros, recaudado } = await buildOrgAggregates();

  return rows
    .map((u): EnrichedUsuario => {
      const state = computeSubscriptionState({
        subscriptionStatus: u.subscriptionStatus,
        trialEndsAt: u.trialEndsAt,
        subscriptionPeriodEnd: u.subscriptionPeriodEnd,
        flowSubscriptionId: u.flowSubscriptionId,
        role: u.role,
        activo: u.activo,
        esDemo: u.esDemo,
      });

      const vencimiento = vencimientoDe(state);
      let diasParaVencer: number | null = null;
      if (vencimiento) {
        const ms = new Date(vencimiento).getTime() - Date.now();
        diasParaVencer = Math.ceil(ms / MS_PER_DAY);
      }

      const requiereRecordatorio =
        !state.isAdmin &&
        !u.esDemo &&
        (state.status === "vencida" ||
          (diasParaVencer !== null && diasParaVencer <= 3));

      const miembrosActivos =
        u.organizationId != null ? (miembros.get(u.organizationId) ?? 1) : 1;
      const pricing = computePricing(miembrosActivos);
      const totalRecaudado =
        u.organizationId != null ? (recaudado.get(u.organizationId) ?? 0) : 0;

      return {
        id: u.id,
        accountId: u.accountId,
        nombre: nombreDe(u),
        email: u.email,
        role: u.role,
        subscriptionStatus: state.status,
        hasAccess: state.hasAccess,
        isAdmin: state.isAdmin,
        tieneSuscripcion: state.tieneSuscripcion,
        createdAt: u.createdAt ? u.createdAt.toISOString() : null,
        trialEndsAt: state.trialEndsAt,
        subscriptionPeriodEnd: state.periodEnd,
        vencimiento,
        diasParaVencer,
        requiereRecordatorio,
        rut: u.rut,
        esDemo: u.esDemo,
        activo: u.activo,
        usuariosExtra: pricing.usuariosAdicionales,
        montoMensual: pricing.totalMensual,
        totalRecaudado,
      };
    })
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
}

adminRouter.get("/admin/usuarios", async (req, res) => {
  try {
    const usuarios = await buildUsuarios();
    res.json(usuarios);
  } catch (err) {
    req.log.error({ err }, "Error listing admin usuarios");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

adminRouter.get("/admin/metricas", async (req, res) => {
  try {
    const usuarios = await buildUsuarios();

    // Account status breakdown over real customer accounts (exclude platform
    // admins).
    let totalCuentas = 0;
    let enPrueba = 0;
    let activas = 0;
    let vencidas = 0;
    let demo = 0;

    for (const u of usuarios) {
      if (u.isAdmin) continue;
      // Internal demo/showcase accounts are tracked in their own bucket only and
      // must never contaminate trial-conversion metrics (total customer accounts,
      // trial, active, expired) — they are not real prospects/customers.
      if (u.esDemo) {
        demo += 1;
        continue;
      }
      totalCuentas += 1;
      if (u.subscriptionStatus === "activa") activas += 1;
      else if (u.subscriptionStatus === "prueba" && u.hasAccess) enPrueba += 1;
      else vencidas += 1;
    }

    // Org-level sums, counted once per organization. Revenue counts only orgs
    // whose owner has an active subscription.
    const { miembros, recaudado } = await buildOrgAggregates();
    let totalRecaudado = 0;
    for (const v of recaudado.values()) totalRecaudado += v;

    const orgs = await db
      .select({
        id: organizacionesTable.id,
        ownerStatus: usersTable.subscriptionStatus,
      })
      .from(organizacionesTable)
      .leftJoin(usersTable, eq(usersTable.id, organizacionesTable.ownerId));

    let revenueMensual = 0;
    for (const org of orgs) {
      if (org.ownerStatus !== "activa") continue;
      const memberCount = miembros.get(org.id) ?? 1;
      revenueMensual += computePricing(memberCount).totalMensual;
    }

    res.json({
      totalCuentas,
      enPrueba,
      activas,
      vencidas,
      demo,
      revenueMensual,
      totalRecaudado,
    });
  } catch (err) {
    req.log.error({ err }, "Error building admin metricas");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

adminRouter.post("/admin/usuarios/:id/extender-trial", async (req, res) => {
  const { id } = req.params;
  const dias =
    typeof req.body?.dias === "number" && req.body.dias > 0
      ? Math.floor(req.body.dias)
      : TRIAL_DAYS;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });
      return;
    }
    // Extend from the later of now or the current trial end.
    const base = Math.max(
      Date.now(),
      u.trialEndsAt ? u.trialEndsAt.getTime() : Date.now(),
    );
    const nuevoFin = new Date(base + dias * MS_PER_DAY);
    await db
      .update(usersTable)
      .set({ subscriptionStatus: "prueba", trialEndsAt: nuevoFin })
      .where(eq(usersTable.id, id));
    res.json({ ok: true, mensaje: `Prueba extendida ${dias} día(s).` });
  } catch (err) {
    req.log.error({ err }, "Error extending trial");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

adminRouter.post("/admin/usuarios/:id/activar", async (req, res) => {
  const { id } = req.params;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });
      return;
    }
    await db
      .update(usersTable)
      .set({ activo: true })
      .where(eq(usersTable.id, id));
    res.json({ ok: true, mensaje: "Cuenta activada." });
  } catch (err) {
    req.log.error({ err }, "Error activating account");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

adminRouter.post("/admin/usuarios/:id/desactivar", async (req, res) => {
  const { id } = req.params;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });
      return;
    }
    await db
      .update(usersTable)
      .set({ activo: false })
      .where(eq(usersTable.id, id));
    res.json({ ok: true, mensaje: "Cuenta desactivada." });
  } catch (err) {
    req.log.error({ err }, "Error deactivating account");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

adminRouter.post("/admin/usuarios/:id/demo", async (req, res) => {
  const { id } = req.params;
  const esDemo = req.body?.esDemo === true;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });
      return;
    }
    // Marking demo grants permanent access via esDemo (source of truth). Also push
    // trialEndsAt far into the future so the account never reads as expired; the
    // column is NOT NULL so we set a far-future date rather than clearing it.
    await db
      .update(usersTable)
      .set(
        esDemo
          ? { esDemo: true, trialEndsAt: new Date("2099-12-31T00:00:00.000Z") }
          : { esDemo: false },
      )
      .where(eq(usersTable.id, id));
    res.json({
      ok: true,
      mensaje: esDemo
        ? "Cuenta marcada como demo interna."
        : "Cuenta desmarcada como demo.",
    });
  } catch (err) {
    req.log.error({ err }, "Error toggling demo flag");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

// Reassigns "orphaned" cobros (rows with no responsable_id, e.g. left dangling
// by the Replit-Auth → email+password migration) to the given user, adopting
// that user's organization. Scoped to responsable_id IS NULL so it can never
// touch cobros that already belong to another user. Idempotent.
adminRouter.post("/admin/usuarios/:id/reclamar-cobros", async (req, res) => {
  const { id } = req.params;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });
      return;
    }
    const reasignados = await db
      .update(cobrosTable)
      .set({
        responsableId: id,
        responsableNombre: nombreDe(u),
        organizationId: u.organizationId,
      })
      .where(isNull(cobrosTable.responsableId))
      .returning({ id: cobrosTable.id });
    res.json({
      ok: true,
      mensaje:
        reasignados.length === 0
          ? "No había cobros sin responsable por reasignar."
          : `${reasignados.length} cobro(s) sin responsable reasignado(s) a esta cuenta.`,
    });
  } catch (err) {
    req.log.error({ err }, "Error reclaiming orphaned cobros");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

adminRouter.post("/admin/usuarios/:id/recordatorio-email", async (req, res) => {
  const { id } = req.params;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if (!u.email) {
      res.status(400).json({
        ok: false,
        message: "El usuario no tiene un email registrado.",
      });
      return;
    }

    const state = computeSubscriptionState({
      subscriptionStatus: u.subscriptionStatus,
      trialEndsAt: u.trialEndsAt,
      subscriptionPeriodEnd: u.subscriptionPeriodEnd,
      flowSubscriptionId: u.flowSubscriptionId,
      role: u.role,
      activo: u.activo,
      esDemo: u.esDemo,
    });

    const vencimiento = vencimientoDe(state);
    const vencido = state.status === "vencida" || !state.hasAccess;

    const result = await sendRenovacionEmail(
      {
        email: u.email,
        nombre: nombreDe(u),
        estado: state.status,
        vencido,
        vencimiento,
        precioMensual: state.precioMensual,
        ctaUrl: `${getPublicBaseUrl()}/perfil`,
      },
      req.log,
    );

    if (!result.ok) {
      res.status(502).json({
        ok: false,
        message: result.error ?? "No se pudo enviar el recordatorio.",
      });
      return;
    }

    res.json({ ok: true, message: "Recordatorio enviado correctamente." });
  } catch (err) {
    req.log.error({ err }, "Error sending admin recordatorio email");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export { adminRouter };
