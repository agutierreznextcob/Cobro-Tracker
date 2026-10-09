---
name: Email From / Reply-To convention
description: How outbound emails set the "De:" and Reply-To headers so replies reach the sending user.
---

All outbound emails go through a single `buildRemitente()` helper in the api-server email
module. User-originated emails (payment link, manual aviso, reminder, automated reminder
sequence, team invitation) must read:

- **From:** `"<sender name> via Cobro Simple" <RESEND_FROM_EMAIL>` (platform address; default
  `onboarding@resend.dev`, configure `RESEND_FROM_EMAIL` to the real domain e.g.
  `cobros@cobrosimple.com`).
- **Reply-To:** the sending user's own email, so client replies reach the user, not the platform.

The sender for cobro emails is the cobro **responsable** (look up name+email via the org
helper `getRemitenteContacto(userId)`; prefer the live user name, fall back to the cobro's
cached `responsableNombre`). For invitations the sender is the inviter (`req.user`). Platform
system emails (subscription renovacion) call `buildRemitente()` with NO sender → stays
"Cobro Simple" with no Reply-To.

**Why:** clients should be able to reply directly to the human who billed them; the From must
stay on a verified platform domain (DKIM/SPF) so it doesn't land in spam.

**How to apply:** when adding ANY new email, route it through `buildRemitente()` and pass the
sender's name+email. Never hardcode a bare `from`. The helper strips CR/LF + quotes and
validates the Reply-To address (header-injection safety) — keep that.

## "Responder al cobro" CTA

The debtor-facing "Responder al cobro" button in the reminder-sequence no-pay-link
branch is a `mailto:` link addressed to the **sending executive's own email**, built by
`buildResponderCobroMailto(remitenteEmail, concepto)` (subject `Re: Cobro pendiente -
<concepto>`, empty body, both encodeURIComponent'd).

**Why:** product requirement — replies/clicks must reach the human who issued the cobro,
never the platform inbox. Earlier code hardcoded `mailto:contacto@nextcob.com`, which routed
debtor replies to the platform.

**How to apply:** the helper returns `null` when the sender email is missing/invalid; callers
must then OMIT the button (pass `ctaText`/`ctaUrl` as `undefined`). `buildEmailHtml` renders
the CTA only when both are present. Do NOT reintroduce a NextCob/platform-address fallback for
this button. Comprobante/portal/payment-link emails keep their own purposeful CTAs and already
satisfy the reply requirement via Reply-To.

Initial charge notices (including the manual notice function) are an exception: only show a payment button for a configured processor's real payment link; bank-only notices request the receipt by replying to the email, without a mailto button. With no payment configuration, show the amount and due date without payment options.

**Why:** the user explicitly requested configuration-driven initial notices, replacing the old manual reply-button layout.

**How to apply:** keep the sender's Reply-To, and do not confuse the debtor portal fallback with a Flow/MercadoPago payment link.
