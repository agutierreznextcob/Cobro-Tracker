---
name: Cobro endpoint ownership gap
description: Cobro mutation/read-by-id endpoints don't verify per-user ownership; new endpoints follow this same pattern.
---

Cobro endpoints in `artifacts/api-server/src/routes/cobros.ts` (e.g. flow-link, mp-link,
descuentos, and other `/cobros/:id/*` handlers) fetch the cobro by id and proceed WITHOUT
checking `cobro.responsableId === req.user.id`. They only require an authenticated, subscribed
user. So any authenticated subscriber who guesses/knows an id can read or mutate another user's
cobro.

**Why:** This is an established, codebase-wide convention — not specific to one feature. When
adding a new `/cobros/:id/*` endpoint, match it (no ownership check) for consistency; do NOT add
ownership checks to only one endpoint, which creates an inconsistent and misleading surface.

**How to apply:** Closing this gap properly is a broad, dedicated security task: add
`responsableId === req.user.id` (or 404/403) to ALL cobro read-by-id and mutation endpoints at
once. Treat it as its own task, not a drive-by change inside a feature.
