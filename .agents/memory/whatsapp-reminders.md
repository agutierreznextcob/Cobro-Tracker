---
name: WhatsApp reminder auto-send
description: How the WhatsApp reminder channel sends (provider vs in-app fallback) and what recordatorios_enviados.estado means for it.
---

The reminder engine's `whatsapp` channel auto-sends via the Meta WhatsApp Cloud API
when a provider is configured; otherwise it falls back to the original in-app
notification (the `notificaciones` row with a `wa.me` button the user clicks).

**Provider gate:** auto-send only happens when `WHATSAPP_PHONE_NUMBER_ID` AND
`WHATSAPP_ACCESS_TOKEN` are set AND the client has a sanitizable phone. Any of
those missing → in-app notification fallback. Sender lives in
`artifacts/api-server/src/lib/whatsapp.ts` (`isWhatsAppConfigured`,
`sendWhatsAppMensaje`, `sanitizePhone` — `sanitizePhone` moved here from
recordatorios.ts; import it from whatsapp.ts to avoid duplication).

**estado semantics in `recordatorios_enviados` for the whatsapp canal:**
- `enviado` = actually delivered to the provider (auto-send succeeded).
- `pendiente` = in-app fallback created; a human still has to click "Abrir WhatsApp".
- `fallido` = responsable missing, or provider returned an error.

**Why:** business-initiated WhatsApp messages outside the 24h window require an
approved template. `WHATSAPP_TEMPLATE_NAME` (+ `WHATSAPP_TEMPLATE_LANG`, default
`es`) makes the engine send a template with the reminder text as the single
`{{1}}` body param; without it, it sends a plain text message (works only inside
the 24h window).

**How to apply:** if reminders "send" but clients never receive them, suspect the
template requirement, not the code path — check whether a template is configured
and approved. Email path (Resend) is the parallel reference for the channel shape.
