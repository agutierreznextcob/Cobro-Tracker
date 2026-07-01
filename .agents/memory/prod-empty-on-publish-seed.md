---
name: Production starts data-empty; seed essential accounts on startup
description: Why demo/superadmin accounts vanish in production and how they are (re)created
---

# Production DB is schema-only on publish → seed essential accounts at startup

Replit's Publish flow copies the database **schema** to production, never the
**data**. So any account/data that exists only because it was created manually in
the dev DB (e.g. the demo `anibal.gutierrezbasoalto@gmail.com` and superadmin
`agutierrez@nextcob.com`) is simply **absent in production** after publishing —
the prod `users` table is empty (0 rows).

**Symptom this explains:** "password recovery email never arrives" in production.
`forgot-password` only sends `if (user)` exists and always returns 200 (anti-
enumeration), so a missing account = silent no-op = no email. It is NOT a Resend
domain/delivery problem (nextcob.com is verified; Resend sends to any external
inbox).

**Fix chosen:** `artifacts/api-server/src/lib/seed.ts` `seedEssentialAccounts()`,
called fire-and-forget (with `.catch`) from `index.ts` after `listen`. It is
idempotent: matches accounts by email, inserts only when missing
(`onConflictDoNothing`), and seeds sample demo cobros only when the demo has zero
(resumable, and a no-op in dev where the demo already has cobros).

**Why:** the agent CANNOT write to the production DB (executeSql `production` is
read-only). The only ways to get data into prod are the app itself or a startup
seed that runs on the next publish. Startup seed is the robust, repeatable path.

**How to apply:** any account/row that must always exist in every environment
belongs in this seed, not in a one-off dev insert. Keep every seed insert
idempotent. Hardcoding a password is acceptable ONLY for the shared demo account;
the superadmin is seeded with `passwordHash=null` (sets it via forgot-password —
which now works because the account exists). Env-var changes (RESEND_*) only take
effect in prod on the next publish/redeploy.
