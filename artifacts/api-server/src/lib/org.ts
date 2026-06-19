import { db, usersTable, organizacionesTable } from "@workspace/db";
import { eq, and, type SQL } from "drizzle-orm";
import { cobrosTable } from "@workspace/db";
import { PLAN_AMOUNT } from "./flow-subscriptions";

// Per-seat pricing (structure only — no real billing yet). The base plan covers
// the first seat; each additional active member adds COSTO_USUARIO_ADICIONAL.
export const PLAN_BASE = PLAN_AMOUNT; // CLP, first seat
export const COSTO_USUARIO_ADICIONAL = 9990; // CLP, per extra seat

export interface OrgContext {
  organizationId: number | null;
  orgRole: "admin_org" | "ejecutivo" | null;
  isOrgAdmin: boolean;
}

// Loads the organization context for a user from the DB. admin_org users can see
// and manage everything in their organization; ejecutivo users only their own.
export async function getOrgContext(userId: string): Promise<OrgContext> {
  const [row] = await db
    .select({
      organizationId: usersTable.organizationId,
      orgRole: usersTable.orgRole,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const organizationId = row?.organizationId ?? null;
  const orgRole = row?.orgRole ?? null;
  return {
    organizationId,
    orgRole,
    isOrgAdmin: orgRole === "admin_org",
  };
}

// Builds the WHERE condition that scopes cobros to what the user may see:
// - admin_org: every cobro in their organization
// - ejecutivo (or no org yet): only cobros assigned to them (responsableId)
// An optional responsableId narrows an admin's view to a single ejecutivo.
export function cobroScopeCondition(
  ctx: OrgContext,
  userId: string,
  responsableId?: string,
): SQL | undefined {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    const orgCond = eq(cobrosTable.organizationId, ctx.organizationId);
    if (responsableId) {
      return and(orgCond, eq(cobrosTable.responsableId, responsableId));
    }
    return orgCond;
  }
  return eq(cobrosTable.responsableId, userId);
}

// Authorizes access to a single cobro (detail/mutation routes):
// - admin_org: any cobro in their organization
// - ejecutivo (or no org yet): only cobros assigned to them (responsableId)
export function userCanAccessCobro(
  ctx: OrgContext,
  userId: string,
  cobro: { organizationId: number | null; responsableId: string | null },
): boolean {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return cobro.organizationId === ctx.organizationId;
  }
  return cobro.responsableId === userId;
}

// Authorizes access to a single cliente (detail/update routes):
// - admin_org: any cliente in their organization
// - ejecutivo (or no org yet): only clientes they own (userId)
export function userCanAccessCliente(
  ctx: OrgContext,
  userId: string,
  cliente: { organizationId: number | null; userId: string | null },
): boolean {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return cliente.organizationId === ctx.organizationId;
  }
  return cliente.userId === userId;
}

export function computePricing(miembrosActivos: number) {
  const usuariosAdicionales = Math.max(0, miembrosActivos - 1);
  return {
    planBase: PLAN_BASE,
    costoUsuarioAdicional: COSTO_USUARIO_ADICIONAL,
    usuariosAdicionales,
    totalMensual: PLAN_BASE + usuariosAdicionales * COSTO_USUARIO_ADICIONAL,
  };
}

// Creates a solo organization for a user and makes them its admin_org owner.
// Used on first login for users that arrive without a pending invitation.
export async function createSoloOrganization(user: {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
}): Promise<number> {
  const nombre =
    user.companyName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email ||
    "Mi organización";

  const [org] = await db
    .insert(organizacionesTable)
    .values({ nombre, ownerId: user.id })
    .returning();

  await db
    .update(usersTable)
    .set({ organizationId: org.id, orgRole: "admin_org", activo: true })
    .where(eq(usersTable.id, user.id));

  return org.id;
}
