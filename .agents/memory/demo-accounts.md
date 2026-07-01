---
name: Demo / internal accounts (esDemo)
description: How permanent demo/showcase accounts are represented and must be excluded from trial logic.
---

# Demo / internal accounts (`esDemo`)

`usersTable.esDemo` (DB `es_demo`) marks permanent showcase/internal accounts used
for product demos to prospects. It is the **source of truth** for permanent access
— `computeSubscriptionState` grants `hasAccess=true` for `isAdmin || esDemo`
regardless of `subscription_status` / `trial_ends_at`.

Rules any new trial/expiration/reporting code MUST follow:

- **Never gate or expire a demo account.** Access checks already bypass via
  `computeSubscriptionState`. Any new "trial ending / vencida" notification or
  block must also short-circuit on `esDemo` (see `requiereRecordatorio`'s
  `!u.esDemo` in `admin.ts`).
- **Exclude demo accounts from trial-conversion metrics entirely.** In
  `/admin/metricas` demo accounts increment ONLY the `demo` bucket and `continue`
  — they must not count toward `totalCuentas`, `activas`, `enPrueba`, or
  `vencidas`, or conversion rates get contaminated.

**Gotcha:** `trial_ends_at` is `NOT NULL`, so a demo account's trial date cannot
be nulled. Convention: set it to a far-future date (e.g. `2099-12-31`) so it never
displays as an expired/expiring trial. `esDemo` (not the date) is what actually
grants access.

**Why:** these accounts are internal, not prospects/customers; counting them as
trials or letting them expire breaks demos and skews conversion reporting.

**Setting demo in PRODUCTION:** the agent's SQL tooling against production is
READ-ONLY, so you cannot flip `es_demo` on the prod row directly. The supported
path is the superadmin panel action ("Marcar como demo") which hits an admin-only
toggle endpoint; the operator runs it in the deployed app after publishing. Do not
attempt prod data writes from the agent or via publish (publish migrates schema,
not data).
