# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env (reminders): `RESEND_API_KEY` (email); `RESEND_FROM_EMAIL` — platform address used in the email "De:" header (e.g. `cobros@cobrosimple.com`; must be a verified domain in Resend). Emails send as `"<sender> via Cobro Simple" <RESEND_FROM_EMAIL>` with Reply-To set to the sending user. WhatsApp auto-send via Meta Cloud API: `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` (both required to enable); `WHATSAPP_API_VERSION` (default `v21.0`), `WHATSAPP_TEMPLATE_NAME` + `WHATSAPP_TEMPLATE_LANG` (default `es`) for business-initiated template messages. If unset, WhatsApp reminders fall back to in-app notifications.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Chilean cobros/payments app. Auth is 100% custom email+password (no OIDC):
  registro (nombre, RUT único+validado, email, contraseña), login (recordarme,
  olvidé contraseña), recuperación por enlace 1h (Resend), verificación de email.
- Seguridad: bcrypt, sesiones por cookie, bloqueo tras 5 intentos fallidos (15min).
- Anti-abuso: 1 RUT = 1 trial de 14 días para siempre (`trialRutsTable`).
- Cuenta demo permanente (`esDemo`) y panel superadmin (cuentas, revenue, total
  recaudado, extender/activar/desactivar).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Ley 21.719 (data protection)

- Consent: register requires `aceptaPolitica===true` (non-prechecked checkbox);
  stored as `usersTable.politicaAceptadaEn`. Public legal pages at `/privacidad`
  and `/terminos` (third parties disclosed: Resend, Groq, Flow, MercadoPago).
- ARCO in Profile "Mis datos y privacidad": `GET /profile/exportar-datos` (JSON
  export of perfil+cobros+clientes, scoped by org role, never leaks
  passwordHash/credenciales) + `DELETE /profile/cuenta` (permanent, confirm
  "ELIMINAR"). Delete runs in a transaction; comprobantes deleted manually
  (no cascade), cobros children cascade by cobroId; `trial_ruts` preserved
  (anti-abuse); demo/admin blocked; org owner with other members → 409
  (re-checked inside the txn to close the race).

## Gotchas

- Auth token consume (`lib/tokens.ts`) and login lockout increment
  (`routes/auth.ts`) MUST stay as single atomic SQL `UPDATE`s. Splitting either
  into SELECT-then-UPDATE reintroduces a single-use-token bypass / lockout race.
- Demo (anibal) and superadmin (agutierrez@nextcob.com) accounts are seeded with
  `passwordHash=null` + `emailVerified=true`; they set passwords via forgot-password.
- Email deliverability: `RESEND_FROM_EMAIL` is unset → emails send from Resend's
  sandbox sender, which only reaches the Resend account-owner inbox. Until
  nextcob.com is verified in Resend and `RESEND_FROM_EMAIL` is set, mail to other
  recipients (customer cobro links, @nextcob.com inboxes) silently fails. The
  superadmin password-reset is temporarily routed to a backup inbox
  (`SUPERADMIN_RECOVERY_EMAIL`) — see `lib`/`routes/auth.ts` `getSuperadminRecoveryEmail`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
