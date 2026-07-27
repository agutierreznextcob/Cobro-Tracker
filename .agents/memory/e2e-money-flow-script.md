---
name: E2E money-flow test script
description: How to re-run the end-to-end payment/reports verification and its gotchas
---
Repeatable e2e check lives at `artifacts/api-server/scripts/e2e-money-flow.ts`, registered (with typecheck) as a project validation command run before every publish (tsx is a devDependency of api-server; API Server workflow must be running). It logs in as the demo account, exercises cobro → descuento → abonos → estado → informes aggregation → /organization/rendimiento deltas, then deletes its rows directly in the DB.

**Gotchas:**
- Descuento API enum is `tipo: "porcentaje" | "fijo"` (NOT `monto_fijo`).
- `/organization/rendimiento` rows key on `usuarioId` (not `userId`/`id`).
- Demo login self-heals: `ensureDemoUser` now backfills a null `passwordHash` on boot with the seed password, so a restart of the API Server fixes a 401 from the script.

**Why:** verified July 2026 that pagadoEn, abonos parciales, descuentos (incl. discount-closes-cobro path), IVA 19%, saldo, informes totals, and rendimiento deltas all reconcile; rerun after touching money paths.
