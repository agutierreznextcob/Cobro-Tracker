---
name: Static auth-guard check
description: Static (no-server) guard against pathless auth use() in the shared /api router chain.
---
`artifacts/api-server/scripts/check-auth-guards.ts` (workflow `check-auth-guards`, pnpm script `check:auth-guards`) statically parses routes/index.ts mount order + each mounted router for pathless `.use()`.

Rules enforced:
- Pathless `.use()` in a mounted router fails unless the file is in ALLOWED_BLANKET_GUARD_FILES (whitelist inside the script).
- Whitelisted blanket-guard routers must be mounted AFTER all PUBLIC_ROUTER_FILES (health, auth, public-chat, webhooks, leads, portal, encuestas).
- Whitelist entries with no blanket guard anymore = failure (keeps the list honest).

**Why:** blanket guards mounted before public routes 401 the debtor portal/leads/webhooks; runtime e2e-public-routes only catches it with the server up.
**How to apply:** when adding a router or a blanket guard, run check:auth-guards; update the whitelist/public list in the script deliberately.

Gotcha: lib/db uses TS project references — if typecheck complains a schema column "does not exist" although lib/db/src/schema has it, the dist d.ts is stale; run `pnpm exec tsc -b lib/db/tsconfig.json` from repo root.
