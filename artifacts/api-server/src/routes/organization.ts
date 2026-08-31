import { Router } from "express";
import crypto from "crypto";
import {
  db,
  usersTable,
  organizacionesTable,
  invitacionesTable,
  cobrosTable,
  pagosParciales,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { InvitarUsuarioBody, UpdateMiembroBody } from "@workspace/api-zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { requireOrgAdmin } from "../middlewares/requireOrgAdmin";
import { requirePlanFeature, orgPuedeActivarMiembroTx } from "../middlewares/requirePlanFeature";
import { getOrgContext, computePricing } from "../lib/org";
import { normalizarPacks } from "../lib/plans";
import { sendInvitacionEmail } from "../lib/email";
import { getPublicBaseUrl } from "../lib/flow-api";
import { notificarInvitacionAceptada } from "../lib/notificaciones-service";

const organizationRouter = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Validates that `supervisorId` is an active member of `organizationId` with
// the supervisor role. Returns an error string or null when valid.
async function validarSupervisor(
  organizationId: number,
  supervisorId: string,
): Promise<string | null> {
  const [sup] = await db
    .select({ orgRole: usersTable.orgRole, activo: usersTable.activo })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, supervisorId),
        eq(usersTable.organizationId, organizationId),
      ),
    );
  if (!sup || sup.orgRole !== "supervisor" || !sup.activo) {
    return "El supervisor seleccionado no es válido.";
  }
  return null;
}

function nombreDe(u: { firstName: string | null; lastName: string | null }): string | null {
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || null;
}

// Drizzle transaction type (inferred so it stays in sync with the driver).
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ¿Puede este usuario abandonar su organización actual para unirse a otra?
// Solo si es el DUEÑO de su propia organización y es su único miembro activo
// (una "solo org" recién creada). Nunca si pertenece a la org de un tercero
// o si su org tiene más miembros (dejaría un equipo sin dueño).
async function usuarioPuedeCambiarDeOrgTx(
  tx: DbTx,
  userId: string,
  organizationId: number,
): Promise<boolean> {
  const [org] = await tx
    .select({ ownerId: organizacionesTable.ownerId })
    .from(organizacionesTable)
    .where(eq(organizacionesTable.id, organizationId));
  if (!org || org.ownerId !== userId) return false;
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.organizationId, organizationId),
        eq(usersTable.activo, true),
      ),
    );
  return (row?.count ?? 0) <= 1;
}

organizationRouter.use("/organization", (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});
organizationRouter.use("/organization", requireSubscription);

// --- Organization info + pricing breakdown ---
organizationRouter.get("/organization", async (req, res) => {
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    if (ctx.organizationId == null) {
      res.status(404).json({ error: "No perteneces a ninguna organización" });
      return;
    }

    const [org] = await db
      .select()
      .from(organizacionesTable)
      .where(eq(organizacionesTable.id, ctx.organizationId));
    if (!org) {
      res.status(404).json({ error: "Organización no encontrada" });
      return;
    }

    const [{ count: miembrosActivos }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.organizationId, ctx.organizationId),
          eq(usersTable.activo, true),
        ),
      );

    // Invitaciones pendientes no expiradas: reservan cupo (el chequeo al
    // invitar las cuenta), así el frontend informa asientos realmente libres.
    const [{ count: invitacionesPendientes }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invitacionesTable)
      .where(
        and(
          eq(invitacionesTable.organizationId, ctx.organizationId),
          eq(invitacionesTable.estado, "pendiente"),
          sql`(${invitacionesTable.expiraEn} is null or ${invitacionesTable.expiraEn} > now())`,
        ),
      );

    // El plan que fija los precios es el del dueño de la organización (quien paga).
    const [owner] = await db
      .select({
        plan: usersTable.plan,
        subscriptionStatus: usersTable.subscriptionStatus,
        packsUsuarios: usersTable.packsUsuarios,
      })
      .from(usersTable)
      .where(eq(usersTable.id, org.ownerId));
    const ownerPlan =
      owner?.subscriptionStatus === "prueba" ? "nextcob" : (owner?.plan ?? "nextcob");
    const pricing = computePricing(ownerPlan, normalizarPacks(owner?.packsUsuarios));

    res.json({
      id: org.id,
      nombre: org.nombre,
      esAdmin: ctx.isOrgAdmin,
      esOwner: org.ownerId === userId,
      miembrosActivos,
      invitacionesPendientes,
      cupoUsuarios: pricing.usuariosIncluidos + pricing.cupoPacks,
      ...pricing,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting organization");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- List members ---
organizationRouter.get("/organization/usuarios", async (req, res) => {
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    if (ctx.organizationId == null) {
      res.json([]);
      return;
    }

    const [org] = await db
      .select({ ownerId: organizacionesTable.ownerId })
      .from(organizacionesTable)
      .where(eq(organizacionesTable.id, ctx.organizationId));

    // Supervisores solo ven su propio equipo (él mismo + sus ejecutivos);
    // ejecutivos solo se ven a sí mismos. La frontera es el backend, no la UI.
    const scopeCondition =
      ctx.orgRole === "admin_org"
        ? eq(usersTable.organizationId, ctx.organizationId)
        : and(
            eq(usersTable.organizationId, ctx.organizationId),
            inArray(
              usersTable.id,
              ctx.orgRole === "supervisor" ? ctx.teamMemberIds : [userId],
            ),
          );

    const rows = await db
      .select()
      .from(usersTable)
      .where(scopeCondition)
      .orderBy(desc(usersTable.createdAt));

    const nombrePorId = new Map(rows.map((u) => [u.id, nombreDe(u) ?? u.email]));

    res.json(
      rows.map((u) => ({
        id: u.id,
        nombre: nombreDe(u),
        email: u.email,
        orgRole: u.orgRole,
        supervisorId: u.supervisorId ?? null,
        supervisorNombre: u.supervisorId
          ? (nombrePorId.get(u.supervisorId) ?? null)
          : null,
        activo: u.activo,
        esOwner: org?.ownerId === u.id,
        createdAt: u.createdAt ? u.createdAt.toISOString() : null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing miembros");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- Update a member (admin only) ---
organizationRouter.patch(
  "/organization/usuarios/:id",
  requireOrgAdmin,
  async (req, res) => {
    const userId = req.user!.id;
    const targetId = String(req.params.id);
    const parsed = UpdateMiembroBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const ctx = await getOrgContext(userId);
      if (ctx.organizationId == null) {
        res.status(404).json({ error: "Organización no encontrada" });
        return;
      }

      const [target] = await db
        .select()
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, targetId),
            eq(usersTable.organizationId, ctx.organizationId),
          ),
        );
      if (!target) {
        res.status(404).json({ error: "Miembro no encontrado" });
        return;
      }

      const [org] = await db
        .select({ ownerId: organizacionesTable.ownerId })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, ctx.organizationId));

      const nuevoRol = parsed.data.orgRole;
      const nuevoActivo = parsed.data.activo;
      const nuevoSupervisorId =
        "supervisorId" in parsed.data ? (parsed.data.supervisorId ?? null) : undefined;

      // Guard: the owner must remain an active admin_org.
      if (org?.ownerId === targetId) {
        if (nuevoRol && nuevoRol !== "admin_org") {
          res.status(400).json({
            error: "No puedes cambiar el rol del dueño de la organización.",
          });
          return;
        }
        if (nuevoActivo === false) {
          res.status(400).json({
            error: "No puedes desactivar al dueño de la organización.",
          });
          return;
        }
      }

      const updates: Record<string, unknown> = {};
      if (nuevoRol !== undefined) updates.orgRole = nuevoRol;
      if (nuevoActivo !== undefined) updates.activo = nuevoActivo;

      const rolFinal = nuevoRol ?? target.orgRole;

      if (nuevoSupervisorId !== undefined) {
        if (nuevoSupervisorId !== null && rolFinal !== "ejecutivo") {
          res.status(400).json({
            error: "Solo los ejecutivos pueden tener un supervisor asignado.",
          });
          return;
        }
        if (nuevoSupervisorId !== null) {
          if (nuevoSupervisorId === targetId) {
            res.status(400).json({ error: "Un usuario no puede ser su propio supervisor." });
            return;
          }
          const errSup = await validarSupervisor(ctx.organizationId, nuevoSupervisorId);
          if (errSup) {
            res.status(400).json({ error: errSup });
            return;
          }
        }
        updates.supervisorId = nuevoSupervisorId;
      } else if (nuevoRol !== undefined && nuevoRol !== "ejecutivo") {
        // Promotions to supervisor/admin clear their own supervisor.
        updates.supervisorId = null;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nada que actualizar" });
        return;
      }
      updates.updatedAt = new Date();

      // Reactivating a member: check capacity inside a transaction that locks
      // the owner row so concurrent reactivations / pack removals cannot
      // double-book the same seat.
      if (nuevoActivo === true && !target.activo) {
        type ReactivateResult =
          | { sinCupo: true }
          | { updated: typeof usersTable.$inferSelect };
        const result = await db.transaction(async (tx): Promise<ReactivateResult> => {
          if (!(await orgPuedeActivarMiembroTx(tx, ctx.organizationId))) {
            return { sinCupo: true };
          }
          const [updated] = await tx
            .update(usersTable)
            .set(updates)
            .where(eq(usersTable.id, targetId))
            .returning();
          // If a supervisor stops being supervisor, clear their reports.
          if (target.orgRole === "supervisor" && updated.orgRole !== "supervisor") {
            await tx
              .update(usersTable)
              .set({ supervisorId: null, updatedAt: new Date() })
              .where(
                and(
                  eq(usersTable.organizationId, ctx.organizationId!),
                  eq(usersTable.supervisorId, targetId),
                ),
              );
          }
          return { updated };
        });

        if ("sinCupo" in result) {
          res.status(403).json({
            error:
              "Tu plan actual no permite más usuarios activos. Mejora al plan NextCob para reactivar miembros.",
            code: "plan_upgrade",
            feature: "equipo",
          });
          return;
        }

        const updated = result.updated;
        let supervisorNombre: string | null = null;
        if (updated.supervisorId) {
          const [sup] = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.id, updated.supervisorId));
          supervisorNombre = sup ? (nombreDe(sup) ?? sup.email) : null;
        }
        res.json({
          id: updated.id,
          nombre: nombreDe(updated),
          email: updated.email,
          orgRole: updated.orgRole,
          supervisorId: updated.supervisorId ?? null,
          supervisorNombre,
          activo: updated.activo,
          esOwner: org?.ownerId === updated.id,
          createdAt: updated.createdAt ? updated.createdAt.toISOString() : null,
        });
        return;
      }

      // Non-seat-affecting update (role change, supervisor assignment, etc.):
      // no transaction needed.
      const [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, targetId))
        .returning();

      // If a supervisor stops being supervisor, their ejecutivos go back to
      // reporting directly to the admin.
      if (target.orgRole === "supervisor" && updated.orgRole !== "supervisor") {
        await db
          .update(usersTable)
          .set({ supervisorId: null, updatedAt: new Date() })
          .where(
            and(
              eq(usersTable.organizationId, ctx.organizationId),
              eq(usersTable.supervisorId, targetId),
            ),
          );
      }

      let supervisorNombre: string | null = null;
      if (updated.supervisorId) {
        const [sup] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, updated.supervisorId));
        supervisorNombre = sup ? (nombreDe(sup) ?? sup.email) : null;
      }

      res.json({
        id: updated.id,
        nombre: nombreDe(updated),
        email: updated.email,
        orgRole: updated.orgRole,
        supervisorId: updated.supervisorId ?? null,
        supervisorNombre,
        activo: updated.activo,
        esOwner: org?.ownerId === updated.id,
        createdAt: updated.createdAt ? updated.createdAt.toISOString() : null,
      });
    } catch (err) {
      req.log.error({ err }, "Error updating miembro");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

// --- Deactivate a member (admin only) ---
organizationRouter.delete(
  "/organization/usuarios/:id",
  requireOrgAdmin,
  async (req, res) => {
    const userId = req.user!.id;
    const targetId = String(req.params.id);

    try {
      const ctx = await getOrgContext(userId);
      if (ctx.organizationId == null) {
        res.status(404).json({ error: "Organización no encontrada" });
        return;
      }
      if (targetId === userId) {
        res.status(400).json({ error: "No puedes eliminarte a ti mismo." });
        return;
      }

      const [target] = await db
        .select()
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, targetId),
            eq(usersTable.organizationId, ctx.organizationId),
          ),
        );
      if (!target) {
        res.status(404).json({ error: "Miembro no encontrado" });
        return;
      }

      const [org] = await db
        .select({ ownerId: organizacionesTable.ownerId })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, ctx.organizationId));
      if (org?.ownerId === targetId) {
        res
          .status(400)
          .json({ error: "No puedes eliminar al dueño de la organización." });
        return;
      }

      const [updated] = await db
        .update(usersTable)
        .set({ activo: false, updatedAt: new Date() })
        .where(eq(usersTable.id, targetId))
        .returning();

      res.json({
        id: updated.id,
        nombre: nombreDe(updated),
        email: updated.email,
        orgRole: updated.orgRole,
        activo: updated.activo,
        esOwner: false,
        createdAt: updated.createdAt ? updated.createdAt.toISOString() : null,
      });
    } catch (err) {
      req.log.error({ err }, "Error deactivating miembro");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

// --- Invitations ---
function serializeInvitacion(inv: typeof invitacionesTable.$inferSelect) {
  return {
    id: inv.id,
    email: inv.email,
    orgRole: inv.orgRole,
    supervisorId: inv.supervisorId ?? null,
    estado: inv.estado,
    invitadoPorNombre: inv.invitadoPorNombre ?? null,
    creadoEn: inv.creadoEn.toISOString(),
    expiraEn: inv.expiraEn ? inv.expiraEn.toISOString() : null,
  };
}

organizationRouter.get(
  "/organization/invitaciones",
  requireOrgAdmin,
  async (req, res) => {
    const userId = req.user!.id;
    try {
      const ctx = await getOrgContext(userId);
      if (ctx.organizationId == null) {
        res.json([]);
        return;
      }
      const rows = await db
        .select()
        .from(invitacionesTable)
        .where(eq(invitacionesTable.organizationId, ctx.organizationId))
        .orderBy(desc(invitacionesTable.creadoEn));
      res.json(rows.map(serializeInvitacion));
    } catch (err) {
      req.log.error({ err }, "Error listing invitaciones");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

organizationRouter.post(
  "/organization/invitaciones",
  requireOrgAdmin,
  requirePlanFeature("equipo"),
  async (req, res) => {
    const userId = req.user!.id;
    const parsed = InvitarUsuarioBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const orgRole = parsed.data.orgRole;
    const supervisorId =
      orgRole === "ejecutivo" ? (parsed.data.supervisorId ?? null) : null;

    try {
      const ctx = await getOrgContext(userId);
      if (ctx.organizationId == null) {
        res.status(404).json({ error: "Organización no encontrada" });
        return;
      }

      if (supervisorId) {
        const errSup = await validarSupervisor(ctx.organizationId, supervisorId);
        if (errSup) {
          res.status(400).json({ error: errSup });
          return;
        }
      }

      // Cupo del plan: capacity check + insert inside a transaction that locks
      // the owner row (FOR UPDATE via orgPuedeActivarMiembroTx) so that two
      // simultaneous invite requests cannot both observe the same free seat.
      // contarPendientes=true counts existing pending invitations so we don't
      // over-sell slots before anyone accepts.
      const token = crypto.randomBytes(24).toString("hex");
      const expiraEn = new Date(Date.now() + INVITE_TTL_MS);
      const invitadoPorNombre = nombreDe(req.user!) || req.user!.email || null;

      type InviteResult =
        | { sinCupo: true }
        | { yaEnOrg: true }
        | { inv: typeof invitacionesTable.$inferSelect };
      const invResult = await db.transaction(async (tx): Promise<InviteResult> => {
        if (!(await orgPuedeActivarMiembroTx(tx, ctx.organizationId, { contarPendientes: true }))) {
          return { sinCupo: true };
        }
        // Reject if a user with this email already belongs to an organization
        // OTHER than their own empty solo org. Existing accounts that are the
        // sole member of their own organization CAN be invited (they accept
        // via /invitacion/:token and are moved into the inviting org).
        const [existingUser] = await tx
          .select({
            id: usersTable.id,
            organizationId: usersTable.organizationId,
          })
          .from(usersTable)
          .where(eq(usersTable.email, email));
        if (existingUser?.organizationId != null) {
          const elegible = await usuarioPuedeCambiarDeOrgTx(
            tx,
            existingUser.id,
            existingUser.organizationId,
          );
          if (!elegible) return { yaEnOrg: true };
        }
        // Reuse any existing pending invitation for this email in this org.
        const [existingInv] = await tx
          .select()
          .from(invitacionesTable)
          .where(
            and(
              eq(invitacionesTable.organizationId, ctx.organizationId!),
              eq(invitacionesTable.email, email),
              eq(invitacionesTable.estado, "pendiente"),
            ),
          );
        let inv: typeof invitacionesTable.$inferSelect;
        if (existingInv) {
          [inv] = await tx
            .update(invitacionesTable)
            .set({ orgRole, supervisorId, token, expiraEn, invitadoPorId: userId, invitadoPorNombre })
            .where(eq(invitacionesTable.id, existingInv.id))
            .returning();
        } else {
          [inv] = await tx
            .insert(invitacionesTable)
            .values({
              organizationId: ctx.organizationId!,
              email,
              orgRole,
              supervisorId,
              token,
              estado: "pendiente",
              invitadoPorId: userId,
              invitadoPorNombre,
              expiraEn,
            })
            .returning();
        }
        return { inv };
      });

      if ("sinCupo" in invResult) {
        res.status(403).json({
          error:
            "Alcanzaste el cupo de usuarios de tu plan. Agrega un pack de usuarios adicionales para invitar a más personas.",
          code: "sin_cupo",
        });
        return;
      }
      if ("yaEnOrg" in invResult) {
        res.status(400).json({
          error: "Este usuario ya pertenece a una organización.",
        });
        return;
      }

      const inv = invResult.inv;

      const [org] = await db
        .select({ nombre: organizacionesTable.nombre })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, ctx.organizationId));

      // Send the invitation email (non-blocking).
      sendInvitacionEmail(
        {
          email,
          organizacionNombre: org?.nombre ?? "tu organización",
          invitadoPorNombre,
          invitadoPorEmail: req.user!.email ?? null,
          orgRole,
          ctaUrl: `${getPublicBaseUrl()}/invitacion/${token}`,
        },
        req.log,
      ).catch((err) => {
        req.log.warn({ err }, "Unhandled error in invitation email");
      });

      req.log.info(
        { invitacionId: inv.id, email, orgRole },
        "Invitación creada",
      );
      res.status(201).json(serializeInvitacion(inv));
    } catch (err) {
      req.log.error({ err }, "Error creating invitacion");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

organizationRouter.delete(
  "/organization/invitaciones/:id",
  requireOrgAdmin,
  async (req, res) => {
    const userId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    try {
      const ctx = await getOrgContext(userId);
      if (ctx.organizationId == null) {
        res.status(404).json({ error: "Organización no encontrada" });
        return;
      }
      const [inv] = await db
        .select()
        .from(invitacionesTable)
        .where(
          and(
            eq(invitacionesTable.id, id),
            eq(invitacionesTable.organizationId, ctx.organizationId),
          ),
        );
      if (!inv) {
        res.status(404).json({ error: "Invitación no encontrada" });
        return;
      }
      const [updated] = await db
        .update(invitacionesTable)
        .set({ estado: "cancelada" })
        .where(eq(invitacionesTable.id, id))
        .returning();
      res.json(serializeInvitacion(updated));
    } catch (err) {
      req.log.error({ err }, "Error cancelling invitacion");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

// --- Team performance (admin: all members; supervisor: their team) ---
organizationRouter.get(
  "/organization/rendimiento",
  requirePlanFeature("informes_avanzados"),
  async (req, res) => {
    const userId = req.user!.id;
    const supervisorFiltro =
      typeof req.query.supervisorId === "string" && req.query.supervisorId
        ? req.query.supervisorId
        : undefined;
    try {
      const ctx = await getOrgContext(userId);
      if (ctx.organizationId == null) {
        res.json([]);
        return;
      }
      if (!ctx.isOrgAdmin && !ctx.isSupervisor) {
        res.status(403).json({ error: "No autorizado" });
        return;
      }

      let miembros = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.organizationId, ctx.organizationId));

      const nombrePorId = new Map(
        miembros.map((u) => [u.id, nombreDe(u) ?? u.email]),
      );

      if (ctx.isSupervisor) {
        // Supervisors only see their own team (their ejecutivos + themselves).
        miembros = miembros.filter((m) => ctx.teamMemberIds.includes(m.id));
      } else if (supervisorFiltro) {
        // Admin drill-down: the supervisor's team (ejecutivos + the supervisor).
        miembros = miembros.filter(
          (m) => m.supervisorId === supervisorFiltro || m.id === supervisorFiltro,
        );
      }

      // Sum the net amount to charge (monto - descuento), not the raw monto,
      // so discounts don't inflate recaudado/pendiente figures.
      const stats = await db
        .select({
          responsableId: cobrosTable.responsableId,
          estado: cobrosTable.estado,
          cantidad: sql<number>`count(*)::int`,
          monto: sql<number>`coalesce(sum(${cobrosTable.monto} - coalesce(${cobrosTable.montoDescuento}, 0))::float, 0)`,
        })
        .from(cobrosTable)
        .where(eq(cobrosTable.organizationId, ctx.organizationId))
        .groupBy(cobrosTable.responsableId, cobrosTable.estado);

      // Confirmed partial payments (abonos) on non-terminal cobros, per responsable.
      // They count as recaudado and reduce the outstanding pendiente.
      const abonosStats = await db
        .select({
          responsableId: cobrosTable.responsableId,
          abonado: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
        })
        .from(pagosParciales)
        .innerJoin(cobrosTable, eq(pagosParciales.cobroId, cobrosTable.id))
        .where(
          and(
            eq(cobrosTable.organizationId, ctx.organizationId),
            eq(pagosParciales.estado, "confirmado"),
            sql`${cobrosTable.estado} in ('pendiente', 'parcial')`,
          ),
        )
        .groupBy(cobrosTable.responsableId);
      const abonadoPorResp = new Map(
        abonosStats.map((s) => [s.responsableId, s.abonado ?? 0]),
      );

      const rows = miembros.map((m) => {
        const mine = stats.filter((s) => s.responsableId === m.id);
        const pagados = mine
          .filter((s) => s.estado === "pagado")
          .reduce((a, s) => a + s.cantidad, 0);
        const abonado = abonadoPorResp.get(m.id) ?? 0;
        // Recaudado = fully paid cobros + confirmed abonos on open/parcial cobros.
        const montoRecaudado =
          mine
            .filter((s) => s.estado === "pagado")
            .reduce((a, s) => a + (s.monto ?? 0), 0) + abonado;
        const pendientes = mine
          .filter((s) => s.estado === "pendiente" || s.estado === "parcial")
          .reduce((a, s) => a + s.cantidad, 0);
        // Pendiente = outstanding balance (net amount minus confirmed abonos).
        const montoPendiente = Math.max(
          mine
            .filter((s) => s.estado === "pendiente" || s.estado === "parcial")
            .reduce((a, s) => a + (s.monto ?? 0), 0) - abonado,
          0,
        );
        const asignados = mine.reduce((a, s) => a + s.cantidad, 0);

        return {
          usuarioId: m.id,
          nombre: nombreDe(m),
          email: m.email,
          orgRole: m.orgRole,
          supervisorId: m.supervisorId ?? null,
          supervisorNombre: m.supervisorId
            ? (nombrePorId.get(m.supervisorId) ?? null)
            : null,
          cobrosAsignados: asignados,
          cobrosPagados: pagados,
          cobrosPendientes: pendientes,
          montoRecaudado,
          montoPendiente,
        };
      });

      res.json(rows);
    } catch (err) {
      req.log.error({ err }, "Error getting rendimiento");
      res.status(500).json({ error: "Error interno del servidor" });
    }
  },
);

// --- Public invitation lookup (used by the signup landing) ---
organizationRouter.get("/invitaciones/:token", async (req, res) => {
  const token = req.params.token;
  try {
    const [inv] = await db
      .select()
      .from(invitacionesTable)
      .where(eq(invitacionesTable.token, token));

    const expirada =
      inv?.expiraEn != null && inv.expiraEn.getTime() < Date.now();
    if (!inv || inv.estado !== "pendiente" || expirada) {
      res.status(404).json({ error: "Invitación no válida o expirada" });
      return;
    }

    const [org] = await db
      .select({ nombre: organizacionesTable.nombre })
      .from(organizacionesTable)
      .where(eq(organizacionesTable.id, inv.organizationId));

    // Whether an account already exists for the invited email, so the frontend
    // can steer to "log in" vs "create account". The email itself already comes
    // from the invitation, so this does not enable account enumeration beyond
    // what the invitee (holder of the token) legitimately needs.
    const [cuenta] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, inv.email));

    res.json({
      valida: true,
      email: inv.email,
      orgRole: inv.orgRole,
      organizacionNombre: org?.nombre ?? "",
      emailRegistrado: Boolean(cuenta),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting invitacion publica");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- Accept an invitation (authenticated; the invitee already has an account) ---
// Public path prefix (/invitaciones) so it is NOT behind the /organization
// blanket auth/subscription guards, but it still requires a session: the
// invitee logs in first and then accepts. New accounts instead auto-accept
// during registration (assignOrganization in routes/auth.ts).
organizationRouter.post("/invitaciones/:token/aceptar", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: "Debes iniciar sesión para aceptar la invitación.",
      code: "no_autenticado",
    });
    return;
  }
  const token = req.params.token;
  const userId = req.user.id;
  try {
    type Resultado =
      | {
          ok: true;
          invitacionId: number;
          invitadoPorId: string | null;
          organizationId: number;
          aceptadaEn: Date;
        }
      | { fail: { status: number; error: string; code?: string } };
    const resultado = await db.transaction(async (tx): Promise<Resultado> => {
      // Lock the invitation row: prevents double-accept races.
      const [inv] = await tx
        .select()
        .from(invitacionesTable)
        .where(eq(invitacionesTable.token, token))
        .for("update");
      const expirada =
        inv?.expiraEn != null && inv.expiraEn.getTime() < Date.now();
      if (!inv || inv.estado !== "pendiente" || expirada) {
        return {
          fail: { status: 404, error: "Invitación no válida o expirada" },
        };
      }

      const [me] = await tx
        .select({
          email: usersTable.email,
          organizationId: usersTable.organizationId,
          activo: usersTable.activo,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      if (!me) {
        return { fail: { status: 404, error: "Usuario no encontrado" } };
      }
      const myEmail = me.email?.trim().toLowerCase() ?? "";
      if (myEmail !== inv.email.trim().toLowerCase()) {
        return {
          fail: {
            status: 403,
            error:
              "Esta invitación fue enviada a otro correo. Inicia sesión con la cuenta invitada.",
            code: "email_distinto",
          },
        };
      }
      // Already a member of the inviting org: mark accepted, nothing to move.
      if (me.organizationId === inv.organizationId) {
        const aceptadaEn = new Date();
        await tx
          .update(invitacionesTable)
          .set({ estado: "aceptada", aceptadaEn })
          .where(eq(invitacionesTable.id, inv.id));
        return {
          ok: true,
          invitacionId: inv.id,
          invitadoPorId: inv.invitadoPorId,
          organizationId: inv.organizationId,
          aceptadaEn,
        };
      }
      // Only users alone in their own solo org (or without org) can move.
      if (
        me.organizationId != null &&
        !(await usuarioPuedeCambiarDeOrgTx(tx, userId, me.organizationId))
      ) {
        return {
          fail: {
            status: 409,
            error:
              "Tu cuenta ya pertenece a una organización con equipo, por lo que no puede unirse a otra.",
            code: "ya_en_org",
          },
        };
      }
      // Seat quota at ACCEPT time (owner row locked FOR UPDATE inside).
      if (!(await orgPuedeActivarMiembroTx(tx, inv.organizationId))) {
        return {
          fail: {
            status: 403,
            error:
              "La organización no tiene cupo de usuarios disponible. Pide al administrador que agregue un pack de usuarios.",
            code: "sin_cupo",
          },
        };
      }
      // Revalidate the supervisor: may have been demoted/deactivated since.
      let supervisorId: string | null = null;
      if (inv.orgRole === "ejecutivo" && inv.supervisorId) {
        const [sup] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.id, inv.supervisorId),
              eq(usersTable.organizationId, inv.organizationId),
              eq(usersTable.orgRole, "supervisor"),
              eq(usersTable.activo, true),
            ),
          );
        supervisorId = sup ? inv.supervisorId : null;
      }
      await tx
        .update(usersTable)
        .set({
          organizationId: inv.organizationId,
          orgRole: inv.orgRole,
          supervisorId,
          activo: true,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, userId));
      const aceptadaEn = new Date();
      await tx
        .update(invitacionesTable)
        .set({ estado: "aceptada", aceptadaEn })
        .where(eq(invitacionesTable.id, inv.id));
      return {
        ok: true,
        invitacionId: inv.id,
        invitadoPorId: inv.invitadoPorId,
        organizationId: inv.organizationId,
        aceptadaEn,
      };
    });

    if ("fail" in resultado) {
      const { status, error, code } = resultado.fail;
      res.status(status).json(code ? { error, code } : { error });
      return;
    }
    await notificarInvitacionAceptada({
      invitacionId: resultado.invitacionId,
      invitadoPorId: resultado.invitadoPorId,
      organizationId: resultado.organizationId,
      aceptadaEn: resultado.aceptadaEn,
      nombreAceptante: [req.user!.firstName, req.user!.lastName].filter(Boolean).join(" ")
        || req.user!.email
        || "Un integrante",
    });
    req.log.info({ userId }, "Invitación aceptada");
    res.json({ ok: true, mensaje: "Te uniste a la organización." });
  } catch (err) {
    req.log.error({ err }, "Error accepting invitacion");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export { organizationRouter };
