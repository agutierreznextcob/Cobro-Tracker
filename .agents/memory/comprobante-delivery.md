---
name: Comprobante auto-delivery reliability
description: How the payment-receipt (comprobante) email is made idempotent, retryable, and concurrency-safe, plus the accepted tradeoff.
---

# Comprobante auto-delivery (emitirComprobante)

`emitirComprobante(cobroId, ...)` is fire-and-forget, never throws, and is triggered at EVERY
`pagado` transition (flow/mp webhooks — which providers retry — flow/mp abono completion, manual PATCH).
So it must be safe under concurrent + duplicate invocations for the same cobro.

## Rules

- `comprobantes.cobroId` is unique → at most one receipt row per cobro (idempotency anchor; insert uses `onConflictDoNothing`).
- `emailEnviado=true` means ONLY "email actually delivered" (final success). Never use it as a provisional lock.
- Send is gated by an atomic claim on `emailIntentoEn` (timestamp): single `UPDATE SET emailIntentoEn=now() WHERE cobroId=? AND emailEnviado=false AND (emailIntentoEn IS NULL OR emailIntentoEn < now()-TTL) RETURNING ...`. Only the row-returning winner sends; others skip.
- On transient send failure (`{ok:false}`): clear `emailIntentoEn=null` → immediate retry possible.
- On thrown exception / process crash after claim: leave `emailIntentoEn` set, `emailEnviado=false` → a later trigger reclaims after the TTL (`CLAIM_TTL_MS`, 5 min).
- No `emailDestino` → keep row `emailEnviado=false`, do not claim/send → retried once the cliente has an email.

**Why:** earlier versions either (1) hard-returned on insert conflict so a transient Resend failure was never retried, or (2) used `emailEnviado=true` as the lock, which left the row stuck forever if the send crashed after claiming.

## Accepted tradeoff (do NOT keep re-hardening this)

Two residual double-send windows remain by design: a send that hangs past the TTL (not realistic — Resend HTTP timeout ≪ 5 min), and a crash in the sub-second gap between provider-accept and the `emailEnviado=true` update. Worst case is a duplicate PDF receipt (benign — not a double charge). Fully eliminating these needs an outbox / attempt-ownership / provider-message-id dedup architecture, which is disproportionate for a receipt email. An architect review will keep flagging these; they are an intentional stop point, not a bug to fix here.
