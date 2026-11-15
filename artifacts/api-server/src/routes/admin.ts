import { Router } from "express";
import { db, usersTable, cobrosTable, organizacionesTable, cobrosEliminadosTable, pagosSuscripcionTable, trialExtensionesTable, invitacionesTable } from "@workspace/db";
import { leerUltimaEjecucionSweep } from "../lib/salud-cartera";
import type { CobroEliminado } from "@workspace/db";
import { eq, sql, isNull, desc, or, ilike } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { computeSubscriptionState } from "../lib/subscription";
import { computePricing, createSoloOrganization, backfillUserOrgRecords } from "../lib/org";
import { normalizarPacks } from "../lib/plans";
import { sendRenovacionEmail, sendTrialExtendidoEmail } from "../lib/email";
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
  status: "prueba" | "activa" | "vencida" | "cancelada";
  periodEnd: string | null;
  trialEndsAt: string | null;
}): string | null {
  return state.status === "activa" || state.status === "cancelada"
    ? state.periodEnd
    : state.trialEndsAt;
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
  subscriptionStatus: "prueba" | "activa" | "vencida" | "cancelada";
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
  plan: "starter" | "nextcob" | null;
  planNombre: string;
  planInicioEn: string | null;
  usuariosExtra: number;
  montoMensual: number;
  totalRecaudado: number;
  // Suscripción Reveniu: último pago registrado y próximo cobro estimado.
  ultimoPagoEn: string | null;
  ultimoPagoMonto: number | null;
  proximoCobroEn: string | null;
  organizationId: number | null;
}

// Optional server-side search: case-insensitive substring match over account ID
// (NCB), email, RUT and full name, so the superadmin panel doesn't need to ship
// the whole user list to the browser to find one account.
async function buildUsuarios(q?: string): Promise<EnrichedUsuario[]> {
  const term = q?.trim();
  const query = db.select().from(usersTable);
  // Escape LIKE wildcards so searching e.g. "100%" matches literally.
  const pattern = term
    ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    : null;
  const rows = pattern
    ? await query.where(
        or(
          ilike(usersTable.accountId, pattern),
          ilike(usersTable.email, pattern),
          ilike(usersTable.rut, pattern),
          sql`concat_ws(' ', ${usersTable.firstName}, ${usersTable.lastName}) ilike ${pattern}`,
        ),
      )
    : await query;
  const { miembros, recaudado } = await buildOrgAggregates();

  // Último pago de suscripción registrado por usuario (una consulta agrupada;
  // DISTINCT ON toma la fila más reciente por user_id).
  const ultimoPagoRows = await db
    .selectDistinctOn([pagosSuscripcionTable.userId], {
      userId: pagosSuscripcionTable.userId,
      fecha: pagosSuscripcionTable.fecha,
      montoTotal: pagosSuscripcionTable.montoTotal,
    })
    .from(pagosSuscripcionTable)
    .where(eq(pagosSuscripcionTable.estado, "pagado"))
    .orderBy(pagosSuscripcionTable.userId, desc(pagosSuscripcionTable.fecha));
  const ultimoPago = new Map(ultimoPagoRows.map((r) => [r.userId, r]));

  return rows
    .map((u): EnrichedUsuario => {
      const state = computeSubscriptionState({
        subscriptionStatus: u.subscriptionStatus,
        trialEndsAt: u.trialEndsAt,
        subscriptionPeriodEnd: u.subscriptionPeriodEnd,
        flowSubscriptionId: u.flowSubscriptionId,
        reveniuSubscriptionId: u.reveniuSubscriptionId,
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

      const pricing = computePricing(u.plan ?? "nextcob", normalizarPacks(u.packsUsuarios));
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
        plan: u.plan ?? null,
        planNombre: pricing.planNombre,
        planInicioEn: ultimoPago.get(u.id)?.fecha?.toISOString() ?? null,
        usuariosExtra: pricing.cupoPacks,
        montoMensual: pricing.totalMensual,
        totalRecaudado,
        ultimoPagoEn: ultimoPago.get(u.id)?.fecha?.toISOString() ?? null,
        ultimoPagoMonto: ultimoPago.get(u.id)?.montoTotal ?? null,
        proximoCobroEn:
          (state.status === "activa" && state.tieneSuscripcion) ? state.periodEnd : null,
        organizationId: u.organizationId ?? null,
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
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const usuarios = await buildUsuarios(q);
    res.json(usuarios);
  } catch (err) {
    req.log.error({ err }, "Error listing admin usuarios");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Registro de pagos de suscripción de la plataforma (libro de ingresos de
// NextCob SpA). Une cada pago con los datos actuales del cliente.
adminRouter.get("/admin/pagos-suscripcion", async (req, res) => {
  try {
    const desde = typeof req.query.desde === "string" ? req.query.desde : null;
    const hasta = typeof req.query.hasta === "string" ? req.query.hasta : null;
    const estado = typeof req.query.estado === "string" ? req.query.estado : null;

    const conds = [];
    if (desde) conds.push(sql`${pagosSuscripcionTable.fecha} >= ${new Date(desde)}`);
    if (hasta) {
      const h = new Date(hasta);
      h.setUTCHours(23, 59, 59, 999);
      conds.push(sql`${pagosSuscripcionTable.fecha} <= ${h}`);
    }
    if (estado === "pagado" || estado === "pendiente" || estado === "fallido") {
      conds.push(eq(pagosSuscripcionTable.estado, estado));
    }

    const base = db
      .select({
        pago: pagosSuscripcionTable,
        accountId: usersTable.accountId,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        companyName: usersTable.companyName,
        email: usersTable.email,
      })
      .from(pagosSuscripcionTable)
      .leftJoin(usersTable, eq(usersTable.id, pagosSuscripcionTable.userId))
      .orderBy(desc(pagosSuscripcionTable.fecha));

    const rows = conds.length
      ? await base.where(conds.reduce((a, b) => sql`${a} AND ${b}`))
      : await base;

    res.json(
      rows.map((r) => {
        const extra = r.pago.usuariosAdicionales;
        const nombre =
          r.companyName ||
          [r.firstName, r.lastName].filter(Boolean).join(" ").trim() ||
          null;
        return {
          id: r.pago.id,
          fecha: r.pago.fecha.toISOString(),
          accountId: r.accountId,
          clienteNombre: nombre,
          clienteEmail: r.email,
          plan: extra > 0 ? "con usuarios extra" : "base",
          detalle:
            r.pago.detalle ||
            (extra > 0
              ? `Plan base + ${extra} usuario${extra === 1 ? "" : "s"} extra`
              : "Plan base"),
          usuariosAdicionales: extra,
          montoNeto: r.pago.montoNeto,
          montoIva: r.pago.montoIva,
          montoTotal: r.pago.montoTotal,
          estado: r.pago.estado,
          metodo: r.pago.metodo,
          periodoHasta: r.pago.periodoHasta?.toISOString() ?? null,
        };
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Error listando pagos de suscripción");
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
        ownerPlan: usersTable.plan,
        ownerPacks: usersTable.packsUsuarios,
      })
      .from(organizacionesTable)
      .leftJoin(usersTable, eq(usersTable.id, organizacionesTable.ownerId));

    let revenueMensual = 0;
    for (const org of orgs) {
      if (org.ownerStatus !== "activa") continue;
      revenueMensual += computePricing(
        org.ownerPlan ?? "nextcob",
        normalizarPacks(org.ownerPacks),
      ).totalMensual;
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

// Convierte YYYY-MM-DD al instante "fin de ese día" (23:59:59) en
// America/Santiago respetando el horario de verano (UTC-3 en verano, UTC-4 en
// invierno): parte de un candidato y lo corrige con el offset real que rige en
// ese instante (dos iteraciones cubren los cambios de DST).
function finDeDiaSantiago(fecha: string): Date {
  const [y, m, d] = fecha.split("-").map(Number);
  const targetUtc = Date.UTC(y, m - 1, d, 23, 59, 59);
  let candidato = new Date(`${fecha}T23:59:59-03:00`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(
      fmt.formatToParts(candidato).map((x) => [x.type, x.value]),
    );
    const localUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour) % 24,
      Number(p.minute),
      Number(p.second),
    );
    if (localUtc === targetUtc) break;
    candidato = new Date(candidato.getTime() + (targetUtc - localUtc));
  }
  return candidato;
}

// Extiende el trial hasta una FECHA elegida por el superadmin (calendario en
// la UI). Registra la extensión en trial_extensiones (auditoría) y avisa al
// usuario por email (fire-and-forget con .catch — nunca bloquea la respuesta).
adminRouter.post("/admin/usuarios/:id/extender-trial", async (req, res) => {
  const { id } = req.params;
  const nuevaFechaRaw = req.body?.nuevaFecha;
  const motivo =
    typeof req.body?.motivo === "string" && req.body.motivo.trim()
      ? req.body.motivo.trim().slice(0, 500)
      : null;
  if (
    typeof nuevaFechaRaw !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(nuevaFechaRaw)
  ) {
    res.status(400).json({
      ok: false,
      mensaje: "Debes indicar la nueva fecha de vencimiento (YYYY-MM-DD).",
    });
    return;
  }
  // Validación semántica: JS normaliza fechas imposibles (2026-02-30 →
  // 2026-03-02); exigimos que el calendario la reconozca tal cual.
  const [y, m, d] = nuevaFechaRaw.split("-").map(Number);
  const chequeo = new Date(Date.UTC(y, m - 1, d));
  if (
    chequeo.getUTCFullYear() !== y ||
    chequeo.getUTCMonth() !== m - 1 ||
    chequeo.getUTCDate() !== d
  ) {
    res.status(400).json({ ok: false, mensaje: "La fecha no es válida." });
    return;
  }
  const nuevoFin = finDeDiaSantiago(nuevaFechaRaw);
  if (nuevoFin.getTime() <= Date.now()) {
    res.status(400).json({
      ok: false,
      mensaje: "La nueva fecha debe ser posterior a hoy.",
    });
    return;
  }
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });
      return;
    }
    if (u.esDemo) {
      res.json({
        ok: true,
        mensaje: "La cuenta demo tiene acceso permanente; no requiere extensión.",
      });
      return;
    }
    const fechaAnterior = u.trialEndsAt;
    const admin = req.user!;
    // Actualización + auditoría en UNA transacción: la extensión nunca queda
    // aplicada sin su registro de auditoría (ni al revés).
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ subscriptionStatus: "prueba", trialEndsAt: nuevoFin })
        .where(eq(usersTable.id, id));
      await tx.insert(trialExtensionesTable).values({
        usuarioId: u.id,
        usuarioNombre: nombreDe(u),
        usuarioEmail: u.email,
        usuarioAccountId: u.accountId,
        adminId: admin.id,
        adminNombre: nombreDe(admin),
        fechaAnterior,
        fechaNueva: nuevoFin,
        motivo,
      });
    });

    const fechaTexto = nuevoFin.toLocaleDateString("es-CL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Santiago",
    });
    if (u.email) {
      sendTrialExtendidoEmail(
        {
          email: u.email,
          nombre: nombreDe(u),
          fechaTexto,
          ctaUrl: `${getPublicBaseUrl()}/dashboard`,
        },
        req.log,
      ).catch((err) =>
        req.log.warn({ err }, "Error sending trial-extension email"),
      );
    }

    res.json({
      ok: true,
      mensaje: `Prueba extendida hasta el ${fechaTexto}.`,
    });
  } catch (err) {
    req.log.error({ err }, "Error extending trial");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

// Historial de extensiones de trial (auditoría del superadmin), más recientes
// primero.
adminRouter.get("/admin/trial-extensiones", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(trialExtensionesTable)
      .orderBy(desc(trialExtensionesTable.id))
      .limit(200);
    res.json(
      rows.map((r) => ({
        id: r.id,
        usuarioId: r.usuarioId,
        usuarioNombre: r.usuarioNombre,
        usuarioEmail: r.usuarioEmail,
        usuarioAccountId: r.usuarioAccountId,
        adminNombre: r.adminNombre,
        fechaAnterior: r.fechaAnterior?.toISOString() ?? null,
        fechaNueva: r.fechaNueva.toISOString(),
        motivo: r.motivo,
        creadoEn: r.creadoEn.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing trial extensions");
    res.status(500).json({ error: "Error interno del servidor" });
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

// Actualiza packs de usuarios adicionales para una cuenta.
// body: { usuariosExtra: number } — total de usuarios extra a asignar (0..50).
adminRouter.post("/admin/usuarios/:id/packs-usuarios", async (req, res) => {
  const { id } = req.params;
  const usuariosExtra = Number(req.body?.usuariosExtra ?? 0);
  if (!Number.isInteger(usuariosExtra) || usuariosExtra < 0 || usuariosExtra > 50) {
    res.status(400).json({ ok: false, mensaje: "usuariosExtra debe ser un entero entre 0 y 50." });
    return;
  }
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) { res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" }); return; }
    // Representamos el total como un pack "individual" de N unidades.
    const packs = usuariosExtra > 0 ? { individual: usuariosExtra } : {};
    await db.update(usersTable).set({ packsUsuarios: packs }).where(eq(usersTable.id, id));
    res.json({ ok: true, mensaje: `Packs actualizados: ${usuariosExtra} usuario(s) extra.`, usuariosExtra });
  } catch (err) {
    req.log.error({ err }, "Error updating packs");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

// Sets the orgRole of a user (admin tool for fixing orgs).
// body: { orgRole: "admin_org" | "supervisor" | "ejecutivo" }
adminRouter.post("/admin/usuarios/:id/org-role", async (req, res) => {
  const { id } = req.params;
  const orgRole = req.body?.orgRole;
  if (!["admin_org", "supervisor", "ejecutivo"].includes(orgRole)) {
    res.status(400).json({ ok: false, mensaje: "orgRole debe ser admin_org, supervisor o ejecutivo." });
    return;
  }
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) { res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" }); return; }
    await db.update(usersTable).set({ orgRole, updatedAt: new Date() }).where(eq(usersTable.id, id));
    res.json({ ok: true, mensaje: `Rol actualizado a ${orgRole}.`, orgRole });
  } catch (err) {
    req.log.error({ err }, "Error updating orgRole");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

// Creates a solo organization for a user that has none (fixes accounts that
// missed auto-provisioning on first login). Idempotent: no-op if already has org.
adminRouter.post("/admin/usuarios/:id/crear-org", async (req, res) => {
  const { id } = req.params;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) { res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" }); return; }
    if (u.organizationId != null) {
      res.json({ ok: true, mensaje: `La cuenta ya tiene organización (id: ${u.organizationId}). No se hizo nada.`, organizationId: u.organizationId });
      return;
    }
    const organizationId = await createSoloOrganization(u);
    await backfillUserOrgRecords(id, organizationId);
    res.json({ ok: true, mensaje: "Organización creada correctamente. El usuario ahora puede invitar personas.", organizationId });
  } catch (err) {
    req.log.error({ err }, "Error creating org for user");
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
      reveniuSubscriptionId: u.reveniuSubscriptionId,
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

function serializeCobroEliminado(c: CobroEliminado) {
  return {
    id: c.id,
    cobroIdOriginal: c.cobroIdOriginal,
    monto: Number(c.monto),
    montoACobrar: Number(c.montoACobrar),
    estado: c.estado,
    descripcion: c.descripcion,
    clienteId: c.clienteId ?? null,
    clienteNombre: c.clienteNombre ?? null,
    organizationId: c.organizationId ?? null,
    motivo: c.motivo ?? null,
    eliminadoPorId: c.eliminadoPorId ?? null,
    eliminadoPorNombre: c.eliminadoPorNombre ?? null,
    eliminadoEn: c.eliminadoEn.toISOString(),
  };
}

// Sweep health: returns the last time the salud-de-cartera daily sweep ran
// successfully and a `stale` flag (true when the gap exceeds 25 hours).
// Useful for monitoring dashboards and manual operator checks.
const SWEEP_ALERTA_HORAS = 24;
adminRouter.get("/admin/sweep-health", async (req, res) => {
  try {
    const ultimaEjecucion = await leerUltimaEjecucionSweep();
    const horasDesdeUltimaEjecucion = ultimaEjecucion
      ? (Date.now() - ultimaEjecucion.getTime()) / (1000 * 60 * 60)
      : null;
    const stale =
      ultimaEjecucion === null ||
      (horasDesdeUltimaEjecucion !== null && horasDesdeUltimaEjecucion > SWEEP_ALERTA_HORAS);
    res.json({
      ultimaEjecucion: ultimaEjecucion ? ultimaEjecucion.toISOString() : null,
      horasDesdeUltimaEjecucion: horasDesdeUltimaEjecucion !== null
        ? Math.round(horasDesdeUltimaEjecucion * 10) / 10
        : null,
      stale,
      umbralHoras: SWEEP_ALERTA_HORAS,
    });
  } catch (err) {
    req.log.error({ err }, "Error checking sweep health");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Superadmin audit log of hard-deleted cobros (newest first).
adminRouter.get("/admin/cobros-eliminados", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(cobrosEliminadosTable)
      .orderBy(desc(cobrosEliminadosTable.eliminadoEn));
    res.json(rows.map(serializeCobroEliminado));
  } catch (err) {
    req.log.error({ err }, "Error listing deleted cobros");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Anonymise / GDPR-delete a user account: wipes PII and frees the email.
// Does NOT delete cobros or business data — only personal identifiers.
// Cannot be used on the superadmin account itself.
adminRouter.delete("/admin/usuarios/:id", async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  if (id === adminId) {
    res.status(400).json({ ok: false, mensaje: "No puedes eliminar tu propia cuenta de administrador." });
    return;
  }
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });
      return;
    }
    if (u.role === "admin") {
      res.status(400).json({ ok: false, mensaje: "No se puede eliminar una cuenta de administrador de plataforma." });
      return;
    }
    // Cancel any pending invitations for this org
    if (u.organizationId) {
      await db.delete(invitacionesTable).where(eq(invitacionesTable.organizationId, u.organizationId));
    }
    // Anonymise the user: wipe PII, free the email, deactivate
    const anonEmail = `deleted_${id}@deleted.nextcob.com`;
    await db.update(usersTable).set({
      email: anonEmail,
      firstName: "Cuenta",
      lastName: "Eliminada",
      rut: null,
      phone: null,
      activo: false,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, id));
    res.json({ ok: true, mensaje: "Cuenta anonimizada correctamente. El email ha sido liberado." });
  } catch (err) {
    req.log.error({ err }, "Error deleting user account");
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

export { adminRouter };
