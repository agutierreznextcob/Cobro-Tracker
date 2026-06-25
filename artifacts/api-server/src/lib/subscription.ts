import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
export function computeSubscriptionState(row: UserSubscriptionRow): SubscriptionState {
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
  };
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
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!row) return null;
  return computeSubscriptionState(row);
}

export async function userHasAccess(userId: string): Promise<boolean> {
  const state = await getSubscriptionState(userId);
  return state?.hasAccess ?? false;
}
