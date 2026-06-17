---
name: Webhook estado precedence (money state always wins)
description: How payment webhooks must resolve cobro estado vs manual/stale states.
---

# Webhook estado precedence

Payment webhooks (Flow, MercadoPago, generic `/webhooks/cobro`) must never let the cobro `estado` drift away from the real money state.

**Rule (implemented via `aplicarEstadoCobro` in `webhooks.ts`):**
- A real payment confirmation (`pagado`/`parcial`) ALWAYS applies — it overrides any prior manual `fallido`/`cancelado`/`pendiente`.
- A non-money state (`pendiente`/`fallido`/`cancelado`) must NOT downgrade a cobro already at `pagado`/`parcial`, EXCEPT a genuine MercadoPago refund (`payment.status === "refunded"`, passed as `esReembolso`).

**Why:** A payment link (Flow token / MP preference) stays active even after a cobro is manually marked cancelado/fallido, so a customer can still pay — and conversely, late/duplicate/out-of-order provider notifications can arrive after a payment is confirmed. Without precedence, the last webhook wins and can hide that money actually arrived.

**How to apply:**
- Precedence MUST be atomic in SQL, not select-then-check-then-update (that has a TOCTOU race under concurrent webhooks). For non-money proposed states, add `WHERE estado NOT IN ('pagado','parcial')`; for money states / refunds, update unconditionally. Use the returned affected-row count to detect "ignored by precedence".
- Manual estado edits (`PATCH /cobros/:id`) intentionally do NOT clear `flowToken` / `mpPreferenceId`, so the webhook can still locate and correct the cobro after a manual change. Keep it that way.
- Abono (partial-payment) recalculation paths derive estado from the confirmed-abonos sum (authoritative money state) and are left unguarded on purpose.
