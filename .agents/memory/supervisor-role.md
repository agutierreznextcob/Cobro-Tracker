---
name: Supervisor role scoping
description: How the supervisor org role scopes data and where the security boundaries live
---

Hierarchy: admin_org → supervisor → ejecutivo. Each ejecutivo optionally has ONE supervisor (`usersTable.supervisorId`, nullable, ejecutivos only). Supervisor's team = self + his ejecutivos (`ctx.teamMemberIds`, loaded in `getOrgContext`).

Rules:
- ALL scoping is backend-enforced via `lib/org.ts` (`cobroScopeCondition`, `clienteScopeCondition`, `userCanAccessCobro/Cliente`, `canAssignTo`). Frontend filtering (e.g. member dropdowns) is UX only, never the boundary.
- `GET /organization/usuarios` is role-scoped: admin=whole org, supervisor=team, ejecutivo=self. Do NOT revert it to org-wide without requireOrgAdmin — that reintroduces a roster leak.
- Invitation acceptance revalidates the invited supervisorId (still active supervisor in same org) — supervisor may be demoted between invite and accept; invalid → null.
- Role transitions: promote ejecutivo→ clears own supervisorId; demote supervisor→ his ejecutivos orphaned to supervisorId=null (report to admin).
- **Why:** architect review flagged UI-only filtering of /organization/usuarios as broken access control; keep the boundary server-side for any new team-scoped endpoint.
- **How to apply:** any new list/aggregate endpoint must use the org.ts scope helpers, never raw organizationId equality when supervisors exist.
