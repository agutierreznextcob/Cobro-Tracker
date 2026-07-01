---
name: Deploy crash-loop from unhandled process errors
description: Why prod deploys can crash-loop the startup healthcheck while dev/local runs pass; how to keep the API process alive.
---

# Deploy crash-loop: production-only process exits

**Symptom:** publish fails; deploy healthcheck (`/api` / `/api/healthz`) returns 500 in a
loop; previously-published version keeps serving. Local prod bundle and dev pass fine.
Only a lone stderr fragment (e.g. `text: {}`) is captured — the crash-dump tail — no
full stack in deploy logs.

**Root cause class:** the Node process *exits* shortly after binding the port, then the
platform restarts it → crash loop → healthcheck never goes green. This is production-only
because it is triggered by production runtime conditions absent from short local runs.

## The two live traps here

1. **node-postgres `Pool` with no `'error'` listener.** A cloud Postgres backend routinely
   drops idle pooled connections (idle timeout, failover). node-postgres emits `'error'`
   on the idle client; with NO listener attached it becomes an uncaught exception and the
   process exits. Fix: attach `pool.on('error', …)` once (done in the api-server entrypoint
   using the pino `logger`, keeping `lib/db` logger-free). This is the *correct* usage, not
   a band-aid — the error is meant to be handled and the connection discarded.

2. **Fire-and-forget (`void somePromise()`) that can reject.** An unhandled rejection
   crashes the process by default. The startup reminder/workflow scheduler is best-effort
   background work — a send failure must never take down the API.
   **Why:** a deploy that dies on background work fails the healthcheck for everyone.
   **How to apply:** guard the scheduler's own `void tick()` calls with `.catch(log)`
   (scoped), and keep the deep fire-and-forget helpers (`emitirComprobante`,
   `crearYEnviarEncuesta`) internally try/catch-wrapped so they never reject. Do NOT add a
   process-wide `process.on('unhandledRejection')` swallow — it masks real bugs everywhere;
   prefer localized `.catch` on deliberate fire-and-forget paths.

## Debugging note

Production staying healthy on `/api/healthz` (200) during a failed publish means the OLD
version is still live and the NEW build failed its healthcheck — look for a startup/runtime
crash in the new process, not a build error.
