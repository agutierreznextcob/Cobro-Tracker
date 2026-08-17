import { db, usersTable, organizacionesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  PACKS_USUARIOS,
  PACK_IDS,
  PLANES,
  costoDePacks,
  cupoDePacks,
  normalizarPacks,
  planEfectivo,
  type PackId,
  type PacksUsuarios,
  type PlanId,
} from "./plans";

export interface SubscriptionState {
  status: "prueba" | "activa" | "vencida" | "cancelada";
  hasAccess: boolean;
  isAdmin: boolean;
  // Plan elegido por el usuario (null = aún no elige) y plan efectivo con el
  // que opera hoy (trial/admin/demo = nextcob completo).
  plan: PlanId | null;
  planEfectivo: PlanId;
  planNombre: string;
  usuariosIncluidos: number;
  trialEndsAt: string | null;
  diasRestantes: number | null;
  periodEnd: string | null;
  tieneSuscripcion: boolean;
  precioMensual: number;
  precioNeto: number;
  precioIva: number;
  // Packs de usuarios adicionales contratados (del dueño de la org) y cupo
  // total de asientos (incluidos + packs). El desglose mensual = plan base +
  // costo de packs.
  packs: Array<{
    pack: PackId;
    nombre: string;
    cantidad: number;
    usuarios: number;
    total: number;
  }>;
  cupoUsuarios: number;
  usuariosActivos: number;
  packsNeto: number;
  packsIva: number;
  packsTotal: number;
  totalNetoMensual: number;
  totalIvaMensual: number;
  totalMensual: number;
}

export interface UserSubscriptionRow {
  subscriptionStatus: "prueba" | "activa" | "vencida" | "cancelada";
  trialEndsAt: Date | null;
  subscriptionPeriodEnd: Date | null;
  flowSubscriptionId: string | null;
  reveniuSubscriptionId?: number | null;
  role: "user" | "admin";
  activo: boolean;
  esDemo?: boolean;
  plan?: PlanId | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Computes whether a user currently has access and the user-facing state,
// from a subscription row. Pure function (no DB) so it's easy to reason about.
export function computeSubscriptionState(
  row: UserSubscriptionRow,
  usuariosActivos = 1,
  packs: PacksUsuarios = {},
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
  } else if (row.subscriptionStatus === "cancelada") {
    // Renovación cancelada: conserva el acceso hasta el fin del período ya
    // pagado; después queda sin acceso (sin nuevos cobros).
    hasAccess = periodEnd ? periodEnd.getTime() > now : false;
    diasRestantes = periodEnd
      ? Math.max(0, Math.ceil((periodEnd.getTime() - now) / MS_PER_DAY))
      : 0;
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

  const efectivo = planEfectivo({
    subscriptionStatus: row.subscriptionStatus,
    plan: row.plan ?? null,
    role: row.role,
    esDemo: row.esDemo,
  });
  const planDef = PLANES[efectivo];
  const costoPacks = costoDePacks(packs);
  const packsDetalle = PACK_IDS.filter((id) => (packs[id] ?? 0) > 0).map((id) => ({
    pack: id,
    nombre: PACKS_USUARIOS[id].nombre,
    cantidad: packs[id]!,
    usuarios: packs[id]! * PACKS_USUARIOS[id].usuarios,
    total: packs[id]! * PACKS_USUARIOS[id].total,
  }));

  return {
    status: row.subscriptionStatus,
    hasAccess,
    isAdmin,
    plan: row.plan ?? null,
    planEfectivo: efectivo,
    planNombre: planDef.nombre,
    usuariosIncluidos: planDef.usuariosIncluidos,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    diasRestantes,
    periodEnd: periodEnd ? periodEnd.toISOString() : null,
    tieneSuscripcion: Boolean(row.flowSubscriptionId || row.reveniuSubscriptionId),
    precioMensual: planDef.total,
    precioNeto: planDef.neto,
    precioIva: planDef.iva,
    packs: packsDetalle,
    cupoUsuarios: planDef.usuariosIncluidos + cupoDePacks(packs),
    usuariosActivos,
    packsNeto: costoPacks.neto,
    packsIva: costoPacks.iva,
    packsTotal: costoPacks.total,
    totalNetoMensual: planDef.neto + costoPacks.neto,
    totalIvaMensual: planDef.iva + costoPacks.iva,
    totalMensual: planDef.total + costoPacks.total,
  };
}

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
      reveniuSubscriptionId: usersTable.reveniuSubscriptionId,
      role: usersTable.role,
      activo: usersTable.activo,
      esDemo: usersTable.esDemo,
      plan: usersTable.plan,
      packsUsuarios: usersTable.packsUsuarios,
      organizationId: usersTable.organizationId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!row) return null;
  const usuariosActivos = (await contarUsuariosAdicionales(row.organizationId)) + 1;
  // Los packs viven en la fila del DUEÑO de la org (quien paga): un miembro
  // invitado ve el cupo/desglose de su organización, no el suyo propio.
  let packs = normalizarPacks(row.packsUsuarios);
  if (row.organizationId != null) {
    const [org] = await db
      .select({ ownerId: organizacionesTable.ownerId })
      .from(organizacionesTable)
      .where(eq(organizacionesTable.id, row.organizationId));
    if (org && org.ownerId !== userId) {
      const [owner] = await db
        .select({ packsUsuarios: usersTable.packsUsuarios })
        .from(usersTable)
        .where(eq(usersTable.id, org.ownerId));
      packs = normalizarPacks(owner?.packsUsuarios);
    }
  }
  return computeSubscriptionState(row, usuariosActivos, packs);
}

export async function userHasAccess(userId: string): Promise<boolean> {
  const state = await getSubscriptionState(userId);
  return state?.hasAccess ?? false;
}
