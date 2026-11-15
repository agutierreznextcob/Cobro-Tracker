import { db, usersTable, organizacionesTable, areasOrgTable } from "@workspace/db";
import { eq, and, isNull, inArray, type SQL } from "drizzle-orm";
import { cobrosTable, clientesTable, cotizacionesTable, pedidosTable, localesTable, guiasDespachoTable } from "@workspace/db";
import { PLAN_AMOUNT, PLAN_NETO, PLAN_IVA, IVA_RATE } from "./flow-subscriptions";
import { PLANES, costoDePacks, cupoDePacks, type PacksUsuarios, type PlanId } from "./plans";

// Per-seat pricing (structure only — no real billing yet). Amounts are
// IVA-inclusive (Chilean VAT 19%): *Neto + *Iva = the charged total. The base
// plan covers the first seat; each additional active member adds the per-seat total.
export const PLAN_BASE_NETO = PLAN_NETO; // CLP, 24990
export const PLAN_BASE_IVA = PLAN_IVA; // CLP, 4748
export const PLAN_BASE = PLAN_AMOUNT; // CLP, 29738 total (IVA incl.)
export const COSTO_USUARIO_ADICIONAL_NETO = 9990; // CLP neto, per extra seat
export const COSTO_USUARIO_ADICIONAL_IVA = Math.round(
  COSTO_USUARIO_ADICIONAL_NETO * IVA_RATE,
); // CLP, 1898
export const COSTO_USUARIO_ADICIONAL =
  COSTO_USUARIO_ADICIONAL_NETO + COSTO_USUARIO_ADICIONAL_IVA; // CLP, 11888 total

export interface OrgContext {
  organizationId: number | null;
  orgRole: "admin_org" | "gerente" | "subgerente" | "supervisor" | "ejecutivo" | null;
  isOrgAdmin: boolean;
  isGerente: boolean;
  isSupervisor: boolean;
  // For supervisors/gerentes: the user ids of their subtree (all reports + themselves).
  // admin_org: empty (uses org-wide scope instead).
  teamMemberIds: string[];
}

// Recursively collects all descendant user IDs for a given manager/supervisor.
// Traverses the supervisorId hierarchy: a gerente's subtree includes their
// supervisors, and each supervisor's ejecutivos; a supervisor's subtree is
// just their ejecutivos. Returns the given userId plus all descendants.
async function collectSubtreeIds(
  userId: string,
  organizationId: number,
): Promise<string[]> {
  const result: string[] = [userId];
  const queue: string[] = [userId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.organizationId, organizationId),
          eq(usersTable.supervisorId, parentId),
          eq(usersTable.activo, true),
        ),
      );
    for (const child of children) {
      if (!result.includes(child.id)) {
        result.push(child.id);
        queue.push(child.id);
      }
    }
  }
  return result;
}

// Loads the organization context for a user from the DB.
// - admin_org: sees and manages everything in their organization.
// - gerente: sees and manages their supervisors and all those supervisors' ejecutivos.
// - supervisor: sees and manages only their team (their ejecutivos + own records).
// - ejecutivo: only their own.
// The hierarchy is modeled via supervisorId: ejecutivo.supervisorId → supervisor,
// supervisor.supervisorId → gerente (or null/admin). Multi-level traversal is
// handled by collectSubtreeIds.
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

  let teamMemberIds: string[] = [];
  if ((orgRole === "supervisor" || orgRole === "gerente" || orgRole === "subgerente") && organizationId != null) {
    teamMemberIds = await collectSubtreeIds(userId, organizationId);
  }

  return {
    organizationId,
    orgRole,
    isOrgAdmin: orgRole === "admin_org",
    isGerente: orgRole === "gerente" || orgRole === "subgerente",
    isSupervisor: orgRole === "supervisor",
    teamMemberIds,
  };
}

// Looks up the display name and email of a user, used as the "remitente" (sender)
// of outbound emails so the "De:" header reads "<Nombre> via NextCob" and
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
// - gerente: cobros assigned to their subtree (their supervisors + those supervisors' ejecutivos)
// - supervisor: cobros assigned to their team (their ejecutivos + themselves)
// - ejecutivo (or no org yet): only cobros assigned to them (responsableId)
// An optional responsableId narrows the view to a single member.
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
  if ((ctx.isSupervisor || ctx.isGerente) && ctx.organizationId != null) {
    const team = ctx.teamMemberIds.length > 0 ? ctx.teamMemberIds : [userId];
    if (responsableId) {
      if (!team.includes(responsableId)) {
        return sqlFalse();
      }
      return eq(cobrosTable.responsableId, responsableId);
    }
    return inArray(cobrosTable.responsableId, team);
  }
  return eq(cobrosTable.responsableId, userId);
}

// A condition that matches nothing (used when a filter is out of scope).
function sqlFalse(): SQL {
  return eq(cobrosTable.id, -1);
}

// Authorizes access to a single cobro (detail/mutation routes):
// - admin_org: any cobro in their organization
// - gerente/supervisor: cobros assigned to their subtree
// - ejecutivo (or no org yet): only cobros assigned to them (responsableId)
export function userCanAccessCobro(
  ctx: OrgContext,
  userId: string,
  cobro: { organizationId: number | null; responsableId: string | null },
): boolean {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return cobro.organizationId === ctx.organizationId;
  }
  if ((ctx.isSupervisor || ctx.isGerente) && ctx.organizationId != null) {
    return (
      cobro.organizationId === ctx.organizationId &&
      cobro.responsableId != null &&
      (ctx.teamMemberIds.includes(cobro.responsableId) ||
        cobro.responsableId === userId)
    );
  }
  return cobro.responsableId === userId;
}

// Builds the WHERE condition that scopes clientes to what the user may see:
// - admin_org: every cliente in their organization
// - gerente/supervisor: clientes owned by their subtree
// - ejecutivo (or no org yet): only clientes they own (userId)
export function clienteScopeCondition(ctx: OrgContext, userId: string): SQL {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return eq(clientesTable.organizationId, ctx.organizationId);
  }
  if ((ctx.isSupervisor || ctx.isGerente) && ctx.organizationId != null) {
    const team = ctx.teamMemberIds.length > 0 ? ctx.teamMemberIds : [userId];
    return inArray(clientesTable.userId, team);
  }
  return eq(clientesTable.userId, userId);
}

// Authorizes access to a single cliente (detail/update routes):
// - admin_org: any cliente in their organization
// - gerente/supervisor: clientes owned by their subtree
// - ejecutivo (or no org yet): only clientes they own (userId)
export function userCanAccessCliente(
  ctx: OrgContext,
  userId: string,
  cliente: { organizationId: number | null; userId: string | null },
): boolean {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return cliente.organizationId === ctx.organizationId;
  }
  if ((ctx.isSupervisor || ctx.isGerente) && ctx.organizationId != null) {
    return (
      cliente.organizationId === ctx.organizationId &&
      cliente.userId != null &&
      (ctx.teamMemberIds.includes(cliente.userId) || cliente.userId === userId)
    );
  }
  return cliente.userId === userId;
}

// True when `ctx` (a gerente/supervisor/admin) may assign records to `targetId`.
// - admin_org: any member of the organization (validated by caller against org)
// - gerente/supervisor: only members of their subtree
export function canAssignTo(ctx: OrgContext, userId: string, targetId: string): boolean {
  if (ctx.isOrgAdmin) return true;
  if (ctx.isGerente || ctx.isSupervisor) {
    return ctx.teamMemberIds.includes(targetId) || targetId === userId;
  }
  return targetId === userId;
}

// Plan-aware pricing. El plan base cubre PLANES[plan].usuariosIncluidos; los
// asientos extra se contratan por PACKS con descuento (ya no per-seat
// automático). totalMensual = plan base + costo de los packs contratados.
export function computePricing(planId: PlanId = "nextcob", packs: PacksUsuarios = {}) {
  const plan = PLANES[planId];
  const costoPacks = costoDePacks(packs);
  return {
    plan: plan.id,
    planNombre: plan.nombre,
    usuariosIncluidos: plan.usuariosIncluidos,
    planBaseNeto: plan.neto,
    planBaseIva: plan.iva,
    planBase: plan.total,
    packs,
    cupoPacks: cupoDePacks(packs),
    packsNeto: costoPacks.neto,
    packsIva: costoPacks.iva,
    packsTotal: costoPacks.total,
    totalMensual: plan.total + costoPacks.total,
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
): Promise<{ cobros: number; clientes: number; cotizaciones: number; pedidos: number; locales: number; guias: number }> {
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

  const cotizaciones = await db
    .update(cotizacionesTable)
    .set({ organizationId })
    .where(
      and(eq(cotizacionesTable.responsableId, userId), isNull(cotizacionesTable.organizationId)),
    )
    .returning({ id: cotizacionesTable.id });

  const pedidos = await db
    .update(pedidosTable)
    .set({ organizationId })
    .where(
      and(eq(pedidosTable.responsableId, userId), isNull(pedidosTable.organizationId)),
    )
    .returning({ id: pedidosTable.id });

  const locales = await db
    .update(localesTable)
    .set({ organizationId })
    .where(
      and(eq(localesTable.usuarioId, userId), isNull(localesTable.organizationId)),
    )
    .returning({ id: localesTable.id });

  const guias = await db
    .update(guiasDespachoTable)
    .set({ organizationId })
    .where(
      and(eq(guiasDespachoTable.responsableId, userId), isNull(guiasDespachoTable.organizationId)),
    )
    .returning({ id: guiasDespachoTable.id });

  return { cobros: cobros.length, clientes: clientes.length, cotizaciones: cotizaciones.length, pedidos: pedidos.length, locales: locales.length, guias: guias.length };
}
