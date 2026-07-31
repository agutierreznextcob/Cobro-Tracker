import { db, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { PLAN_AMOUNT, PLAN_NETO, PLAN_IVA } from "./flow-subscriptions";

export interface SubscriptionState {
  status: "prueba" | "activa" | "vencida";
  hasAccess: boolean;
  isAdmin: boolean;
  trialEndsAt: string | null;
  diasRestantes: number | null;
  periodEnd: string | null;
  tieneSuscripcion: boolean;
  precioMensual: number;
  precioNeto: number;
  precioIva: number;
  // Real-time seat breakdown: base plan + extra active members of the org.
  // Recomputed on every request, so deactivating a member updates it at once.
  usuariosAdicionales: number;
  costoUsuarioAdicionalNeto: number;
  costoUsuarioAdicionalIva: number;
  costoUsuarioAdicional: number;
  totalNetoMensual: number;
  totalIvaMensual: number;
  totalMensual: number;
}

export interface UserSubscriptionRow {
  subscriptionStatus: "prueba" | "activa" | "vencida";
  trialEndsAt: Date | null;
  subscriptionPeriodEnd: Date | null;
  flowSubscriptionId: string | null;
  role: "user" | "admin";
  activo: boolean;
  esDemo?: boolean;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Computes whether a user currently has access and the user-facing state,
// from a subscription row. Pure function (no DB) so it's easy to reason about.
export function computeSubscriptionState(
  row: UserSubscriptionRow,
  usuariosAdicionales = 0,
): SubscriptionState {
  const now = Date.now();
  const trialEndsAt = row.trialEndsAt ?? null;
  const periodEnd = row.subscriptionPeriodEnd ?? null;

  const isAdmin = row.role === "admin";
  let hasAccess = false;
  let diasRestantes: number | null = null;

  if (isAdmin || row.esDemo) {
    // Admins and the demo account have permanent access — no trial/subscription
    // gating.
    hasAccess = true;
  } else if (row.subscriptionStatus === "activa") {
    // Active subscription: trust it. Webhook flips to "vencida" on failed charge.
    hasAccess = true;
  } else if (row.subscriptionStatus === "prueba") {
    const trialMs = trialEndsAt ? trialEndsAt.getTime() : 0;
    hasAccess = trialMs > now;
    diasRestantes = trialEndsAt ? Math.max(0, Math.ceil((trialMs - now) / MS_PER_DAY)) : 0;
  } else {
    // vencida
    hasAccess = false;
  }

  // A deactivated member loses access immediately, regardless of subscription
  // or platform-admin status. Org owners cannot be deactivated (guarded in the
  // org routes), so this only ever applies to removed team members.
  if (!row.activo) {
    hasAccess = false;
  }

  return {
    status: row.subscriptionStatus,
    hasAccess,
    isAdmin,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    diasRestantes,
    periodEnd: periodEnd ? periodEnd.toISOString() : null,
    tieneSuscripcion: Boolean(row.flowSubscriptionId),
    precioMensual: PLAN_AMOUNT,
    precioNeto: PLAN_NETO,
    precioIva: PLAN_IVA,
    usuariosAdicionales,
    costoUsuarioAdicionalNeto: COSTO_ADICIONAL_NETO,
    costoUsuarioAdicionalIva: COSTO_ADICIONAL_IVA,
    costoUsuarioAdicional: COSTO_ADICIONAL_NETO + COSTO_ADICIONAL_IVA,
    totalNetoMensual: PLAN_NETO + usuariosAdicionales * COSTO_ADICIONAL_NETO,
    totalIvaMensual: PLAN_IVA + usuariosAdicionales * COSTO_ADICIONAL_IVA,
    totalMensual:
      PLAN_AMOUNT + usuariosAdicionales * (COSTO_ADICIONAL_NETO + COSTO_ADICIONAL_IVA),
  };
}

// Per-seat pricing constants duplicated from lib/org.ts values to avoid a
// circular import (org.ts ← subscription.ts). Keep in sync with
// COSTO_USUARIO_ADICIONAL_* in lib/org.ts.
const COSTO_ADICIONAL_NETO = 9990;
const COSTO_ADICIONAL_IVA = Math.round(COSTO_ADICIONAL_NETO * 0.19);

// Counts extra active seats (active org members beyond the first) for a user.
// Returns 0 for users without an organization.
export async function contarUsuariosAdicionales(organizationId: number | null): Promise<number> {
  if (organizationId == null) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(eq(usersTable.organizationId, organizationId), eq(usersTable.activo, true)));
  return Math.max(0, (row?.count ?? 1) - 1);
}

export async function getSubscriptionState(userId: string): Promise<SubscriptionState | null> {
  const [row] = await db
    .select({
      subscriptionStatus: usersTable.subscriptionStatus,
      trialEndsAt: usersTable.trialEndsAt,
      subscriptionPeriodEnd: usersTable.subscriptionPeriodEnd,
      flowSubscriptionId: usersTable.flowSubscriptionId,
      role: usersTable.role,
      activo: usersTable.activo,
      esDemo: usersTable.esDemo,
      organizationId: usersTable.organizationId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!row) return null;
  const usuariosAdicionales = await contarUsuariosAdicionales(row.organizationId);
  return computeSubscriptionState(row, usuariosAdicionales);
}

export async function userHasAccess(userId: string): Promise<boolean> {
  const state = await getSubscriptionState(userId);
  return state?.hasAccess ?? false;
}
