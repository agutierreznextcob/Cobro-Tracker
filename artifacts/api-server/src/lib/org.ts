import { db, usersTable, organizacionesTable } from "@workspace/db";
import { eq, and, isNull, type SQL } from "drizzle-orm";
import { cobrosTable, clientesTable } from "@workspace/db";
import { PLAN_AMOUNT, PLAN_NETO, PLAN_IVA, IVA_RATE } from "./flow-subscriptions";

// Per-seat pricing (structure only — no real billing yet). Amounts are
// IVA-inclusive (Chilean VAT 19%): *Neto + *Iva = the charged total. The base
// plan covers the first seat; each additional active member adds the per-seat total.
export const PLAN_BASE_NETO = PLAN_NETO; // CLP, 18990
export const PLAN_BASE_IVA = PLAN_IVA; // CLP, 3608
export const PLAN_BASE = PLAN_AMOUNT; // CLP, 22598 total (IVA incl.)
export const COSTO_USUARIO_ADICIONAL_NETO = 9990; // CLP neto, per extra seat
export const COSTO_USUARIO_ADICIONAL_IVA = Math.round(
  COSTO_USUARIO_ADICIONAL_NETO * IVA_RATE,
); // CLP, 1898
export const COSTO_USUARIO_ADICIONAL =
  COSTO_USUARIO_ADICIONAL_NETO + COSTO_USUARIO_ADICIONAL_IVA; // CLP, 11888 total

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

// Looks up the display name and email of a user, used as the "remitente" (sender)
// of outbound emails so the "De:" header reads "<Nombre> via Cobro Simple" and
// replies route back to the user via Reply-To. Returns nulls when unavailable.
export async function getRemitenteContacto(
  userId: string | null | undefined,
): Promise<{ nombre: string | null; email: string | null }> {
  if (!userId) return { nombre: null, email: null };
  const [u] = await db
    .select({
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!u) return { nombre: null, email: null };
  const nombre = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
  return { nombre, email: u.email ?? null };
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
    planBaseNeto: PLAN_BASE_NETO,
    planBaseIva: PLAN_BASE_IVA,
    planBase: PLAN_BASE,
    costoUsuarioAdicionalNeto: COSTO_USUARIO_ADICIONAL_NETO,
    costoUsuarioAdicionalIva: COSTO_USUARIO_ADICIONAL_IVA,
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

// Self-heals records created before the organizations feature shipped: any cobro
// or cliente owned by the user that still has a null organizationId is linked to
// their organization. Idempotent — it only touches rows where organizationId IS
// NULL, so it no-ops once everything is healed. This is what keeps environments
// where the one-time backfill never ran (e.g. production) consistent: on login a
// user's legacy records get attached to their org so org-scoped lists show them.
export async function backfillUserOrgRecords(
  userId: string,
  organizationId: number,
): Promise<{ cobros: number; clientes: number }> {
  const cobros = await db
    .update(cobrosTable)
    .set({ organizationId })
    .where(
      and(eq(cobrosTable.responsableId, userId), isNull(cobrosTable.organizationId)),
    )
    .returning({ id: cobrosTable.id });

  const clientes = await db
    .update(clientesTable)
    .set({ organizationId })
    .where(
      and(eq(clientesTable.userId, userId), isNull(clientesTable.organizationId)),
    )
    .returning({ id: clientesTable.id });

  return { cobros: cobros.length, clientes: clientes.length };
}
