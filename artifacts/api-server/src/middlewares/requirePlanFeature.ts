import type { Request, Response, NextFunction } from "express";
import { db, usersTable, organizacionesTable, invitacionesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  PLANES,
  cupoDePacks,
  normalizarPacks,
  planEfectivo,
  planIncluye,
  type PlanFeature,
  type PlanId,
} from "../lib/plans";

// Plan efectivo de un usuario. El plan lo fija el DUEÑO de la organización
// (quien paga la suscripción): un ejecutivo invitado hereda el plan del dueño.
// Admins de plataforma y cuentas demo siempre operan con nivel NextCob.
export async function getPlanEfectivoDeUsuario(userId: string): Promise<PlanId | null> {
  const [row] = await db
    .select({
      subscriptionStatus: usersTable.subscriptionStatus,
      plan: usersTable.plan,
      role: usersTable.role,
      esDemo: usersTable.esDemo,
      organizationId: usersTable.organizationId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!row) return null;
  if (row.role === "admin" || row.esDemo) return "nextcob";

  let base = row;
  if (row.organizationId != null) {
    const [org] = await db
      .select({ ownerId: organizacionesTable.ownerId })
      .from(organizacionesTable)
      .where(eq(organizacionesTable.id, row.organizationId));
    if (org && org.ownerId !== userId) {
      const [owner] = await db
        .select({
          subscriptionStatus: usersTable.subscriptionStatus,
          plan: usersTable.plan,
          role: usersTable.role,
          esDemo: usersTable.esDemo,
        })
        .from(usersTable)
        .where(eq(usersTable.id, org.ownerId));
      if (owner) base = { ...row, ...owner };
    }
  }
  return planEfectivo(base);
}

// Plan efectivo de una organización = plan efectivo de su dueño (quien paga).
export async function getPlanEfectivoDeOrg(
  organizationId: number | null,
): Promise<PlanId | null> {
  if (organizationId == null) return null;
  const [org] = await db
    .select({ ownerId: organizacionesTable.ownerId })
    .from(organizacionesTable)
    .where(eq(organizacionesTable.id, organizationId));
  if (!org) return null;
  return getPlanEfectivoDeUsuario(org.ownerId);
}

// ¿La organización puede tener un miembro activo más? El cupo total es
// usuariosIncluidos del plan + usuarios de los packs contratados por el dueño.
// Se usa al invitar, al aceptar invitaciones y al reactivar miembros.
// `contarPendientes` suma además las invitaciones pendientes no expiradas
// (para no sobrevender el cupo al INVITAR; al aceptar/reactivar no aplica).
export async function orgPuedeActivarMiembro(
  organizationId: number | null,
  opts: { contarPendientes?: boolean } = {},
): Promise<boolean> {
  if (organizationId == null) return true;
  const [org] = await db
    .select({ ownerId: organizacionesTable.ownerId })
    .from(organizacionesTable)
    .where(eq(organizacionesTable.id, organizationId));
  if (!org) return true;
  const [owner] = await db
    .select({
      subscriptionStatus: usersTable.subscriptionStatus,
      plan: usersTable.plan,
      role: usersTable.role,
      esDemo: usersTable.esDemo,
      packsUsuarios: usersTable.packsUsuarios,
    })
    .from(usersTable)
    .where(eq(usersTable.id, org.ownerId));
  if (!owner) return true;
  const plan = planEfectivo(owner);
  const cupo = PLANES[plan].usuariosIncluidos + cupoDePacks(normalizarPacks(owner.packsUsuarios));
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(
      and(eq(usersTable.organizationId, organizationId), eq(usersTable.activo, true)),
    );
  let ocupados = row?.count ?? 0;
  if (opts.contarPendientes) {
    const [pend] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invitacionesTable)
      .where(
        and(
          eq(invitacionesTable.organizationId, organizationId),
          eq(invitacionesTable.estado, "pendiente"),
          sql`(${invitacionesTable.expiraEn} is null or ${invitacionesTable.expiraEn} > now())`,
        ),
      );
    ocupados += pend?.count ?? 0;
  }
  return ocupados + 1 <= cupo;
}

export async function userTieneFeature(
  userId: string,
  feature: PlanFeature,
): Promise<boolean> {
  const plan = await getPlanEfectivoDeUsuario(userId);
  if (!plan) return false;
  return planIncluye(plan, feature);
}

// 403 con code="plan_upgrade" cuando el plan efectivo del usuario no incluye
// la funcionalidad. Usar SIEMPRE después de un guard de autenticación (los
// routers que lo montan ya son blanket-auth) — nunca en rutas públicas.
// Trial, admins y cuentas demo operan con nivel NextCob (planEfectivo).
export function requirePlanFeature(feature: PlanFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "No autorizado" });
        return;
      }
      const ok = await userTieneFeature(userId, feature);
      if (!ok) {
        res.status(403).json({
          error:
            "Esta función está disponible en el plan NextCob. Mejora tu plan para usarla.",
          code: "plan_upgrade",
          feature,
        });
        return;
      }
      next();
    } catch (err) {
      req.log?.error({ err }, "Error verificando plan");
      res.status(500).json({ error: "Error interno" });
    }
  };
}
