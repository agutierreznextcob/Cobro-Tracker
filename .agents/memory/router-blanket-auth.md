---
name: Router blanket auth breaks public routes
description: Express routers with pathless use(auth) intercept public routes mounted after them
---
Rule: never add a pathless `router.use(authGuard)` to a router mounted in the shared /api chain; scope guards to the router's own path prefixes (e.g. `use("/gestiones", ...)`).

**Why:** gestiones' blanket auth silently 401'd the public debtor portal (`/public/portal/:token`) and everything mounted after it — Express routers run pathless middlewares for every request that reaches them, matched route or not.

**How to apply:** when adding a new router or auth guard, list its route prefixes and attach the guard per-prefix; verify public endpoints (portal, leads, webhooks, encuestas, public chat) still respond unauthenticated after mounting.
