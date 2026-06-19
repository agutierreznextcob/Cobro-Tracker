---
name: Cobro & cliente authorization model
description: How per-record access is enforced on cobros/clientes detail and mutation endpoints (org-aware).
---

Access to a single cobro or cliente is org-aware, not owner-only:
- **admin_org** may access any record in their own organization.
- **ejecutivo** (or a user with no org yet) may access only records assigned to them
  (cobro `responsableId` / cliente `userId`).

The shared predicates live in `lib/org.ts` (`getOrgContext`, `userCanAccessCobro`,
`userCanAccessCliente`, `cobroScopeCondition`). Every `/cobros/:id/*` detail/mutation route
must call the access guard after id validation and return **404** (not 403) on
missing-or-forbidden so existence is not leaked. List/stats/dashboard queries scope with
`cobroScopeCondition`. `POST /cobros` must validate any incoming `clienteId` and assigned
`responsableId` against the caller's org before persisting, to prevent cross-tenant association.

**Why:** A multi-tenant org model was added; the earlier "no ownership check" convention was a
real cross-tenant IDOR hole and is no longer acceptable. Two architect rounds caught missed
spots (`/cobros/stats/summary`, `POST /cobros` clienteId) — easy to forget the aggregate and
create paths.

**How to apply:** When adding ANY new endpoint that touches a cobro/cliente by id or aggregates
them, wire in the org-scope guard/condition from `lib/org.ts`. Never fetch by bare id and
proceed. Audit non-`:id` aggregate routes too — they leak just as easily.
