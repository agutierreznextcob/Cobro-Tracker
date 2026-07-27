---
name: E2E webhook test (Flow/MP stubs)
description: How payment webhooks are tested without real payments — stub base URLs, seeded creds, gotchas.
---

Script: `artifacts/api-server/scripts/e2e-webhooks.ts` (run from repo root: `./scripts/node_modules/.bin/tsx artifacts/api-server/scripts/e2e-webhooks.ts`).

Design:
- `flow-api.ts` / `mp-api.ts` resolve their base URL at **call time** from `FLOW_API_BASE_URL` / `MP_API_BASE_URL` env vars (default = real APIs). Tests point them at a local programmable stub HTTP server; production never sets them.
- The script mounts the real `webhooksRouter` in its own express app (json + urlencoded parsers, fake `req.log`), so no dev-server restart or env change is needed.
- Set env vars BEFORE dynamically importing the router/db modules.

Gotchas:
- `tsx` is NOT a dep of api-server; it lives in `scripts/node_modules/.bin/tsx`.
- The demo user may already have real encrypted MP/Flow creds. The MP owner-token-verification test must key stub responses by the **decrypted actual owner token** (via lib/encrypt decrypt), not an assumed fake one.
- MP webhook trusted-token fallback is `MP_ACCESS_TOKEN` env; set it to a stub value in tests.
- Cobros with no cliente/emailPagador make comprobante emission a safe no-op (row created, no email). Cleanup must also delete encuestas + comprobantes + webhook_eventos rows for the test cobros.

Covered contract: pagado/parcial never degraded by late fallido/cancelado (Flow & MP, atomic SQL), approved wins over manual estados, MP `refunded` is the only allowed downgrade (clears pagadoEn), abono webhooks recalc estado net-of-descuento, owner-token external_reference mismatch blocks estado change.

Subscription webhook variant: `artifacts/api-server/scripts/e2e-flow-subscription.ts` reuses the same pattern for the platform Flow subscription webhook (`/webhooks/flow-subscription`). `flow-subscriptions.ts` now shares `flowApiUrl()` from flow-api.ts (env-overridable). Stub serves `/subscription/get`; only FLOW_ADMIN_* need to EXIST (signature ignored). Covers activa/morosa/cancelada/reactivación, unknown/missing subscriptionId, and Flow API 500 (state untouched, always 200).
