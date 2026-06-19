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
