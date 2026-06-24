---
name: Leads capture (landing → dashboard)
description: How public landing leads are captured, gated, and notified; why platform-admin-only.
---

# Leads capture

Public landing form → lead row → sales-inbox email + platform-admin dashboard page.

## Access model
Leads are gated behind the PLATFORM admin role (`role === "admin"`) via `requireAdmin`, NOT per-org.
**Why:** leads are global landing-page prospects with no org owner; exposing them per-org would leak prospect data across tenants. Per-record org helpers (lib/org.ts) deliberately do not apply here.

## Route mounting
The public `POST /public/leads` lives in the same router as the admin `/leads*` endpoints. That router MUST be mounted before `cobrosRouter` in routes/index.ts.
**Why:** cobrosRouter has a blanket `Router.use` auth middleware (no path) that would otherwise intercept the unauthenticated public submission. Same pattern as webhooksRouter.

## Email safety
Lead fields come from an unauthenticated public form, so they are HTML-escaped (`escapeHtml` in lib/email.ts) before interpolation into the notification email body, and the mailto CTA is `encodeURIComponent`-wrapped.
**Why:** prevents HTML/content injection into the internal sales inbox. Any new email that interpolates untrusted public input must escape it too.

## Notification delivery
`sendLeadNotificationEmail` is fire-and-forget (`.catch` logged, never `await`ed in the request path) so Resend failures never break the visitor's 201. Recipient defaults to contacto@nextcob.com, overridable via `LEADS_NOTIFICATION_EMAIL`.
