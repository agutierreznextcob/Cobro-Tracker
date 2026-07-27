---
name: E2E money-flow test script
description: How to re-run the end-to-end payment/reports verification and its gotchas
---
Repeatable e2e check lives at `artifacts/api-server/scripts/e2e-money-flow.ts` (run: `cd artifacts/api-server && pnpm dlx tsx scripts/e2e-money-flow.ts` with the API Server workflow running). It logs in as the demo account, exercises cobro → descuento → abonos → estado → informes aggregation → /organization/rendimiento deltas, then deletes its rows directly in the DB.

**Gotchas:**
- Descuento API enum is `tipo: "porcentaje" | "fijo"` (NOT `monto_fijo`).
- `/organization/rendimiento` rows key on `usuarioId` (not `userId`/`id`).
- The demo account in dev DB can have `passwordHash = null` (seed only inserts when missing); reset it with `hashPassword` from `src/lib/password` to the seed password before logging in.

**Why:** verified July 2026 that pagadoEn, abonos parciales, descuentos (incl. discount-closes-cobro path), IVA 19%, saldo, informes totals, and rendimiento deltas all reconcile; rerun after touching money paths.
