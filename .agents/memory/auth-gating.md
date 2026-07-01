---
name: Frontend auth gating in cobros-app
description: How route guards must consume useAuth to avoid leaking protected content, and how onboarding gating works.
---

# Frontend auth gating (cobros-app)

`useAuth()` (lib/replit-auth-web) is a **shared React context** (`AuthProvider`) that does ONE `fetch('/api/auth/user')` on app mount and caches `user`/`isLoading` in memory; every consumer reads the same state. `App` must be wrapped in `<AuthProvider>` (inside `QueryClientProvider`) or `useAuth()` throws. It is NOT TanStack Query.

**Why the change:** the old per-mount `fetch` re-hit `/auth/user` on EVERY route change → FullScreenLoader flash + DB round-trip on each navigation (nav felt slow). Shared context fetches once. QueryClient also has global defaults (`staleTime: 60_000`, `refetchOnWindowFocus: false`, `retry: 1`) so other queries don't refetch on every nav either.

## Rule: guards read auth inline; keep gate order deliberate
Keep auth + profile-completion + role checks inline in ONE guard (`AuthGate`, `AdminGate`) that blocks on `isLoading` before rendering children. (Historic bug: a ProfileGate-inside-AuthGate with a *separate* useAuth leaked content while the inner call was still loading — now that useAuth is shared context this specific race is gone, but still prefer one inline guard.)

**Subscription gate:** `AuthGate` wraps children in `<SubscriptionGate>` by default. `/perfil` uses `AuthGate skipProfile skipSubscription` so the profile stays reachable for accounts with NO active subscription (to subscribe / manage / delete). Without `skipSubscription`, an expired-trial user is bounced to `SubscriptionRequired` and can never open their profile.

## Refreshing auth state after a mutation
After changing server-side user state (e.g. completing the profile) do a **full page reload** (`window.location.href = base + '/dashboard'`) — this re-inits `AuthProvider` and refetches. `AuthProvider` also exposes `refresh()` for an in-place refetch, but existing flows use reload. Invalidating a query key does nothing (useAuth is not TanStack).

## Mandatory profile completion
`users.profileCompleted` (DB) gates everything. `/auth/user` returns it plus the profile fields. Server `/profile/datos` must trim required fields and reject blank-after-trim before setting `profileCompleted=true`, and validate RUT via módulo-11 (`lib/rut.ts` exists on both server and client). Frontend gating is UX only — the real boundary is server-side per-route auth.
