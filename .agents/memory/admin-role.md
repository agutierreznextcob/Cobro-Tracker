---
name: Admin role & access bypass
description: How the admin role is modeled, detected on the frontend, and how it bypasses subscription gating in the Cobro Simple app.
---

# Admin role

`users.role` enum (`user` | `admin`, default `user`) is the source of truth, assigned **manually in the DB** (no UI to promote users).

## Frontend role detection
The session (`SessionData.user`) does NOT store `role`. The `GET /api/auth/user` endpoint enriches its response with the current DB role each call.

**Why:** keeps role out of long-lived session cookies, so promoting/demoting a user takes effect on the next `/auth/user` fetch without forcing re-login.

**How to apply:** frontend gates on `useAuth().user?.role === "admin"`. Never trust this for security — it's UI-only.

## Access bypass
Admin bypass lives in ONE place: `computeSubscriptionState` (api-server `lib/subscription.ts`) forces `hasAccess = true` and `isAdmin = true` when `row.role === "admin"`. Because `requireSubscription` → `userHasAccess` reads this, admins automatically skip all subscription-gated routes — do not add per-route admin checks for gating.

**How to apply:** any new subscription-gated feature inherits admin bypass for free. Admin-ONLY routes use the separate `requireAdmin` middleware, which re-reads role from DB per request (real security boundary).
