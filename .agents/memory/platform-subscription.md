---
name: platform subscription
description: How Cobro Simple gates the app behind a paid platform subscription
---

Cobro Simple charges its OWN users a monthly platform fee via Flow Subscriptions/Planes,
using PLATFORM admin credentials (`FLOW_ADMIN_API_KEY` / `FLOW_ADMIN_SECRET_KEY`) — NOT
the per-user Flow credentials that users connect to collect their own cobros. Two distinct
Flow credential sets coexist; do not confuse them.

**Access rule:** a user has access if `subscriptionStatus === "activa"` OR
(`subscriptionStatus === "prueba"` AND `trialEndsAt > now`). `vencida` is always blocked.
Source of truth is always read fresh from DB (session stores no subscription fields).

**Gating:** `requireSubscription` middleware returns 402 `SUBSCRIPTION_REQUIRED`. It must be
applied to EVERY authenticated feature endpoint, not just the main routers — this includes
the inline-auth webhook-log endpoints (`/webhooks/eventos`, `/webhooks/eventos/export`).
Subscription + auth + public webhook-ingest endpoints stay exempt so blocked users can recover.

**Subscribe flow:** subscribe → ensurePlan → ensure Flow customer → registerCard (hosted page)
→ store `flowRegisterToken` → redirect user to Flow. Flow returns to public
`/api/subscription/register-return?token=...` → getRegisterStatus → createSubscription → set
status → redirect to `/perfil?suscripcion=exito|error` (cobros-app base path is `/`).

**Webhook:** `/webhooks/flow-subscription` does NOT trust the posted body — it re-queries Flow
with admin creds (getSubscription + mapSubscription) by `flowSubscriptionId` and writes the
authoritative status. Recurring-charge failures map to `vencida`.

**Why:** product requirement = block ALL features after a 14-day trial unless subscribed
($18.990 CLP/mes). Existing users at migration got `trialEndsAt` = now()+14d via DB default
(not created_at+14d) to avoid instantly locking out current users.
