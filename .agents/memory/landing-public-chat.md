---
name: Landing public AI chat
description: The unauthenticated landing-page sales chatbot endpoint and why it lives outside aiRouter + must stay rate-limited.
---

# Landing public AI chat (sales widget)

The landing page has a self-hosted live-chat sales widget that answers prospect questions via Groq (same model as the dashboard assistant) with a **commercial** system prompt, to convert visitors into 14-day trial signups.

## Why it is a separate router
`aiRouter` applies `requireAuth` + `requireSubscription` to *every* one of its routes (via `Router.use` with no path). The landing chat must serve **unauthenticated** visitors, so it cannot live in `aiRouter`. It is its own router mounted in `routes/index.ts` **before** `aiRouter`.

**How to apply:** any future public/anonymous AI surface must be a separate router mounted ahead of the auth-gated ones — do not relax the gate on `aiRouter`.

## Rate limiting is mandatory here
The endpoint is an unauthenticated LLM call, so it is a cost-exhaustion / DoS target. It has an in-memory fixed-window limiter (per-IP + a global cap as defense against X-Forwarded-For spoofing). Returns `429` before any Groq call.

**Why:** code review flagged the unauthenticated AI endpoint without abuse controls as a blocking security gap.
**How to apply:** never ship a public LLM endpoint without a rate limit. The current limiter is in-memory (fine for single-instance) — if the API scales to multiple instances, move it to a shared store (e.g. Postgres/Redis) or it under-counts.

## Other notes
- Streaming uses raw SSE + `fetch` (no generated hook), matching the existing `/ai/chat` convention — these streaming endpoints are intentionally NOT in the OpenAPI spec.
- Contact fallback email in the prompt is `hola@cobrosimple.cl` (matches the landing footer); change both together.
