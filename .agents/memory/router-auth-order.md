---
name: Router ordering — auth middleware
description: Why webhooksRouter must come before cobrosRouter in Express route setup
---

`cobrosRouter.use(fn)` without a path prefix intercepts ALL requests passing through cobrosRouter, including paths like `/webhooks/flow` that belong to other routers. Express processes routers in mount order, so an unauthenticated request to `/webhooks/flow` will be blocked by cobrosRouter's auth middleware if cobrosRouter is mounted first.

**Why:** cobrosRouter uses `Router.use(authMiddleware)` globally (no path filter) to protect all its routes. This runs on every request that reaches cobrosRouter, even if no route in cobrosRouter matches the path.

**How to apply:** In `routes/index.ts`, always mount public routers (webhooksRouter) before auth-protected routers (cobrosRouter, clientesRouter). Comment this clearly so future devs don't reorder.
