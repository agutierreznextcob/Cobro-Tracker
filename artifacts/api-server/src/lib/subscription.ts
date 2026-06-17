import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { PLAN_AMOUNT } from "./flow-subscriptions";

export interface SubscriptionState {
  status: "prueba" | "activa" | "vencida";
  hasAccess: boolean;
  isAdmin: boolean;
  trialEndsAt: string | null;
  diasRestantes: number | null;
  periodEnd: string | null;
  tieneSuscripcion: boolean;
  precioMensual: number;
}

export interface UserSubscriptionRow {
  subscriptionStatus: "prueba" | "activa" | "vencida";
  trialEndsAt: Date | null;
  subscriptionPeriodEnd: Date | null;
  flowSubscriptionId: string | null;
  role: "user" | "admin";
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

  if (isAdmin) {
    // Admins have permanent access — no trial/subscription gating.
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

  return {
    status: row.subscriptionStatus,
    hasAccess,
    isAdmin,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    diasRestantes,
    periodEnd: periodEnd ? periodEnd.toISOString() : null,
    tieneSuscripcion: Boolean(row.flowSubscriptionId),
    precioMensual: PLAN_AMOUNT,
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
