---
name: Deployment healthcheck path
description: Why the api-server deploy failed its healthcheck and the invariant that keeps GET /api returning 200
---

The deploy platform healthchecks the api-server by probing its service **base path `GET /api`**, not a sub-route. A failed/non-2xx probe is reported generically as `healthcheck /api returned status 500` even when the real status is 401/404 or a connection refusal.

**Rule:** `GET /api` (the router root) must return a public 2xx. `healthRouter` is mounted first in `routes/index.ts`, so its `router.get("/")` answers before any blanket-auth router. Keep both `/api` and `/api/healthz` public-200.

**Why:** Originally only `/api/healthz` returned 200; `GET /api` fell through to an auth-gated router and returned 401, so the probe never passed and the deploy never went live. `artifact.toml` declares `health.startup path=/api/healthz`, but the failing deploy probed `/api` regardless — do not rely on that config alone.

**How to apply:** If a deploy hangs unhealthy with `healthcheck /api returned status 500`, curl `http://localhost:80/api` (via proxy) — it must be 200. Never let auth middleware intercept the service base path.
