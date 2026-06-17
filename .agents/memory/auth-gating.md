---
name: Frontend auth gating in cobros-app
description: How route guards must consume useAuth to avoid leaking protected content, and how onboarding gating works.
---

# Frontend auth gating (cobros-app)

`useAuth()` (lib/replit-auth-web) is a **plain mount-time `fetch('/api/auth/user')`**, NOT TanStack Query and NOT a shared context. Each call has its own independent `user`/`isLoading` state.

## Rule: one useAuth per guard chain
A route guard must read `user`, `isLoading`, and `isAuthenticated` from a **single** `useAuth()` call and block on `isLoading` before rendering children. Do NOT chain two guard components that each call `useAuth()` separately — the inner one starts with `user=null` and can render protected children before the outer redirect resolves (race → content leak).

**Why:** an earlier ProfileGate-inside-AuthGate design leaked Dashboard/admin content because the second useAuth was still loading.

**How to apply:** keep auth + profile-completion + role checks inline in ONE guard (`AuthGate`, `AdminGate`). `/perfil` uses `AuthGate skipProfile` so the onboarding form is reachable while still requiring auth.

## Refreshing auth state after a mutation
Because useAuth only fetches on mount, after changing server-side user state (e.g. completing the profile) do a **full page reload** to the destination (`window.location.href = base + '/dashboard'`) — invalidating a query key does nothing here.

## Mandatory profile completion
`users.profileCompleted` (DB) gates everything. `/auth/user` returns it plus the profile fields. Server `/profile/datos` must trim required fields and reject blank-after-trim before setting `profileCompleted=true`, and validate RUT via módulo-11 (`lib/rut.ts` exists on both server and client). Frontend gating is UX only — the real boundary is server-side per-route auth.
