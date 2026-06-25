---
name: Profile edit, avatar upload & member deactivation access
description: How profile photo storage, RUT read-only, and "loses access immediately" deactivation work in the cobros app
---

## Avatar upload = base64 data URL in users.profileImageUrl (NOT object storage)
Profile photos are client-resized (canvas, ≤256px JPEG ~0.85) to a `data:image/` URL and
stored directly in the existing `users.profileImageUrl` column. PUT /profile/datos accepts
optional `profileImageUrl` (data:image/ or http(s); data URLs capped ~1.5MB).
**Why:** object storage was disproportionate for an avatar (new GCS dep, Uppy/React18 peer
conflicts, new composite lib, lockfile churn). A data URL needs zero new infra.
**How to apply:** keep avatars small; if many large images are ever needed, revisit object storage.

## OIDC picture must NOT clobber custom avatars on re-login
`upsertUser` (auth.ts) deliberately omits `profileImageUrl` from `onConflictDoUpdate` — it is
only seeded on first insert. Otherwise every login would overwrite a user's uploaded photo with
the OIDC `picture` claim. `/auth/user` reads `profileImageUrl` from the DB (not just session).

## RUT is read-only once set, enforced server-side
PUT /profile/datos preserves the stored `rut` and ignores the body value when one already exists;
the body RUT is only validated/applied on the very first profile completion (null stored rut).
**How to apply:** never trust the client to keep RUT immutable — the server decides.

## Deactivated members lose access immediately (two layers)
Removing a team member sets `activo=false` (DELETE /organization/usuarios/:id; owner+self guarded).
Access revocation is enforced in BOTH:
1. `/auth/user` returns `{user:null}` when `activo=false` → frontend AuthGate bounces to landing.
2. `computeSubscriptionState` forces `hasAccess=false` when `!activo` → blocks every
   `requireSubscription`-gated API route (cobros, clientes, organization, ai, recordatorios, liquidaciones).
**Why:** before this there was NO activo enforcement anywhere; guards only checked isAuthenticated.
**How to apply:** any new `UserSubscriptionRow` constructor must pass `activo` (admin.ts does).
A deactivated platform admin also loses access — intended.
