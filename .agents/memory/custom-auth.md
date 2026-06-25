---
name: Custom email+password auth
description: How NextCob's custom auth (registro/login/recovery/lockout/anti-abuse/demo/superadmin) is wired, after replacing Replit OIDC.
---

# Custom email+password auth

Replit Auth (OIDC Google/Microsoft) was fully removed; auth is now 100% custom
email+password. `lib/replit-auth-web/use-auth.ts` still hosts the client hook but
`login()` now navigates to `/login` and `logout()` POSTs `/api/auth/logout`.

## Token single-use must be atomic
`consumeAuthToken()` (`lib/tokens.ts`) does check-and-consume in ONE `UPDATE ...
WHERE tokenHash=? AND tipo=? AND usedAt IS NULL AND expiresAt>now() RETURNING
userId`. Do NOT split into SELECT-then-UPDATE — concurrent reset/verify requests
would redeem the same token twice.
**Why:** architect flagged the original two-step version as a single-use bypass.

## Lockout increment must be atomic
`/auth/login` failed-attempt path (`routes/auth.ts`) increments and decides the
lock in ONE SQL `UPDATE` using `CASE WHEN failed_login_attempts + 1 >=
MAX_FAILED_ATTEMPTS THEN ... ` for both `failedLoginAttempts` and `lockedUntil`,
then reads back `lockedUntil` via RETURNING. Never compute attempts in JS from a
stale read.
**Why:** parallel bad logins could otherwise race past the 5-attempt threshold.
**Verified:** 6 rapid bad logins → exactly 5 "incorrectos" then "cuenta_bloqueada".
Lockout = 15min, MAX_FAILED_ATTEMPTS = 5.

## Anti-abuse: 1 RUT = 1 trial ever
`trialRutsTable` (rut PK) records the first trial per RUT on registro. A RUT that
already exists there does NOT get a fresh 14-day trial again.

## Demo & superadmin seed accounts
- anibal.gutierrezbasoalto@gmail.com (id=60793159): `esDemo=true` (permanent
  access like admin, via computeSubscriptionState), owns all migrated data.
- agutierrez@nextcob.com: `role=admin` superadmin.
- Both seeded with `passwordHash=null` + `emailVerified=true`; they set their
  password through the forgot-password flow (no plaintext seeded).

## Email gates
Login blocks unverified email (code `email_no_verificado`) and deactivated
accounts. forgot-password / resend-verification return a generic "si el correo
existe" message to avoid account enumeration. Reset sets `emailVerified=true`.
