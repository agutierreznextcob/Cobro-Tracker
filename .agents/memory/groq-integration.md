---
name: Groq AI integration
description: How the AI assistant chat is wired up in this project
---

The AI assistant uses Groq (not Anthropic) with `groq-sdk` npm package installed in `@workspace/api-server`.

**Model:** `llama-3.3-70b-versatile`

**Auth:** Requires `GROQ_API_KEY` env secret set by the user. The backend throws a clear error if missing.

**Context injection:** Before each message, the backend fetches the user's last 150 cobros + all clientes from DB and injects as structured text into the system prompt. No tool calls — pure RAG approach.

**Streaming:** SSE via `fetch` + `ReadableStream` on the client (NOT EventSource, which only supports GET). The backend uses `groq.chat.completions.create({ stream: true })` and iterates the async iterable.

**DB tables:** `conversations` (userId, title) + `messages` (conversationId, role, content). Cascade delete on conversation drop.

**Why Groq over Anthropic:** User explicitly requested Groq (free tier). The Replit Anthropic integration requires phone verification which wasn't available.

**How to apply:** Install `groq-sdk` in api-server. The route is at `artifacts/api-server/src/routes/ai.ts`, mounted as `aiRouter` in routes/index.ts.
