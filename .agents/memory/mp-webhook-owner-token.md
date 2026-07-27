---
name: MP webhook owner-token verification
description: Why MercadoPago webhook payments must be re-verified with the cobro owner's token.
---

# MP webhook owner-token verification

**Rule:** The MP webhook first fetches the payment with any available token (global `MP_ACCESS_TOKEN` or any merchant's stored token) ONLY to read `external_reference`. Before applying any estado change, it re-verifies the payment with the cobro owner's (`responsableId`) token (fallback: global token) and checks the `external_reference` matches (`verificarConTokenPropietario` in webhooks.ts).

**Why:** Without owner binding, a malicious merchant could create an approved MP payment carrying another org's `cobro-{id}` in external_reference and tamper with cross-tenant payment states.

**How to apply:** never apply cobro/abono state changes from an MP payment verified only with a non-owner token.
