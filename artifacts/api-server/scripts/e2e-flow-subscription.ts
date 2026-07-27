/**
 * E2E test: Flow PLATFORM SUBSCRIPTION webhook WITHOUT a real Flow subscription.
 *
 * Same stub pattern as scripts/e2e-webhooks.ts: mounts the real webhooksRouter
 * locally and points the Flow API client at a local stub via FLOW_API_BASE_URL,
 * so the router's authoritative re-fetch (/subscription/get) hits programmable
 * fake responses instead of the real Flow API.
 *
 * Covers:
 *  - Webhook con suscripción activa (status 1) → subscriptionStatus "activa" + periodEnd
 *  - Webhook con suscripción morosa (morose 1) → "vencida"
 *  - Webhook con suscripción cancelada (status 4) → "vencida"
 *  - Reactivación (activa de nuevo) → vuelve a "activa"
 *  - subscriptionId desconocido → 200 ok, ningún usuario cambia
 *  - Webhook sin subscriptionId → 200 ok (no reintentos de Flow)
 *  - Error del API de Flow (500) → 200 ok y el estado del usuario NO cambia
 *
 * No real credentials needed (FLOW_ADMIN_* solo deben existir; el stub ignora
 * la firma). Run (from repo root):
 *   ./scripts/node_modules/.bin/tsx artifacts/api-server/scripts/e2e-flow-subscription.ts
 */
import http from "http";
import type { AddressInfo } from "net";

// ── Stub Flow API: programmable /subscription/get responses ─────────────────
type SubStub =
  | { kind: "ok"; status: number; morose?: number; period_end?: string }
  | { kind: "error"; httpStatus: number };
const subResponses = new Map<string, SubStub>();

const stub = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://stub");
  if (url.pathname === "/subscription/get") {
    const subscriptionId = url.searchParams.get("subscriptionId") ?? "";
    const r = subResponses.get(subscriptionId);
    if (!r) { res.writeHead(404).end(JSON.stringify({ code: 404, message: "subscription not found" })); return; }
    if (r.kind === "error") { res.writeHead(r.httpStatus).end(JSON.stringify({ code: r.httpStatus, message: "stub error" })); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      subscriptionId, planId: "stub-plan", customerId: "stub-customer",
      status: r.status, morose: r.morose ?? 0,
      period_end: r.period_end ?? null, next_invoice_date: r.period_end ?? null,
    }));
    return;
  }
  res.writeHead(404).end("not found");
});

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  // 1. Start the stub and point the Flow client at it BEFORE importing the router.
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.FLOW_API_BASE_URL = `http://127.0.0.1:${stubPort}`;
  // The webhook only checks that admin creds EXIST; the stub ignores signatures.
  process.env.FLOW_ADMIN_API_KEY = process.env.FLOW_ADMIN_API_KEY || "stub-admin-key";
  process.env.FLOW_ADMIN_SECRET_KEY = process.env.FLOW_ADMIN_SECRET_KEY || "stub-admin-secret";

  const { db, usersTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const webhooksRouter = (await import("../src/routes/webhooks")).default;

  // 2. Mount the REAL webhooks router locally (form-urlencoded like Flow).
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const log = { info: () => {}, warn: () => {}, error: () => {} };
  app.use((req, _res, next) => { (req as any).log = log; (req as any).isAuthenticated = () => false; next(); });
  app.use(webhooksRouter);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const apiPort = (server.address() as AddressInfo).port;

  const postWebhook = async (body: Record<string, string>) => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/webhooks/flow-subscription`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    return { status: res.status, json: await res.json() };
  };

  // 3. Fixture: a throwaway user with a stub flowSubscriptionId.
  const run = Date.now();
  const SUB_ID = `e2e-sub-${run}`;
  const [testUser] = await db.insert(usersTable).values({
    email: `e2e-flow-sub-${run}@test.local`,
    firstName: "E2E", lastName: "FlowSub",
    subscriptionStatus: "vencida",
    flowSubscriptionId: SUB_ID,
  }).returning();

  const getUser = async () =>
    (await db.select().from(usersTable).where(eq(usersTable.id, testUser.id)))[0];

  try {
    // ════════════════════════════════════════════════════════════════════════
    console.log("== Suscripción activa (status 1) ==");
    const periodEnd = "2026-08-27";
    subResponses.set(SUB_ID, { kind: "ok", status: 1, period_end: periodEnd });
    let r = await postWebhook({ subscriptionId: SUB_ID });
    check("webhook activa → 200 ok", r.status === 200 && r.json.ok === true, r);
    let u = await getUser();
    check("subscriptionStatus → activa", u.subscriptionStatus === "activa", u.subscriptionStatus);
    check("subscriptionPeriodEnd seteado", u.subscriptionPeriodEnd != null &&
      new Date(u.subscriptionPeriodEnd).toISOString().startsWith("2026-08-27"), u.subscriptionPeriodEnd);

    // ════════════════════════════════════════════════════════════════════════
    console.log("== Suscripción morosa (cargo recurrente falló) ==");
    subResponses.set(SUB_ID, { kind: "ok", status: 1, morose: 1, period_end: periodEnd });
    r = await postWebhook({ subscriptionId: SUB_ID });
    check("webhook morosa → 200 ok", r.status === 200 && r.json.ok === true, r);
    u = await getUser();
    check("morosa → vencida (acceso bloqueado)", u.subscriptionStatus === "vencida", u.subscriptionStatus);

    // ════════════════════════════════════════════════════════════════════════
    console.log("== Suscripción cancelada (status 4) ==");
    subResponses.set(SUB_ID, { kind: "ok", status: 4 });
    r = await postWebhook({ subscriptionId: SUB_ID });
    check("webhook cancelada → 200 ok", r.status === 200 && r.json.ok === true, r);
    u = await getUser();
    check("cancelada → vencida", u.subscriptionStatus === "vencida", u.subscriptionStatus);

    // ════════════════════════════════════════════════════════════════════════
    console.log("== Reactivación (paga de nuevo) ==");
    subResponses.set(SUB_ID, { kind: "ok", status: 1, period_end: "2026-09-27" });
    r = await postWebhook({ subscriptionId: SUB_ID });
    check("webhook reactivación → 200 ok", r.status === 200 && r.json.ok === true, r);
    u = await getUser();
    check("vuelve a activa", u.subscriptionStatus === "activa", u.subscriptionStatus);
    check("periodEnd actualizado", u.subscriptionPeriodEnd != null &&
      new Date(u.subscriptionPeriodEnd).toISOString().startsWith("2026-09-27"), u.subscriptionPeriodEnd);

    // ════════════════════════════════════════════════════════════════════════
    console.log("== Casos de error: no deben romper ni cambiar estado ==");
    // Unknown subscriptionId: 200 (Flow no reintenta) y nadie cambia.
    r = await postWebhook({ subscriptionId: `desconocida-${run}` });
    check("subscriptionId desconocido → 200 ok", r.status === 200 && r.json.ok === true, r);

    // Missing subscriptionId entirely.
    r = await postWebhook({});
    check("sin subscriptionId → 200 ok", r.status === 200 && r.json.ok === true, r);

    // Flow API down (500): user state must remain untouched.
    subResponses.set(SUB_ID, { kind: "error", httpStatus: 500 });
    r = await postWebhook({ subscriptionId: SUB_ID });
    check("error del API Flow → 200 ok (sin crash)", r.status === 200 && r.json.ok === true, r);
    u = await getUser();
    check("error del API NO cambia el estado", u.subscriptionStatus === "activa", u.subscriptionStatus);

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    await db.delete(usersTable).where(eq(usersTable.id, testUser.id));
    console.log(`Cleanup: removed test user ${testUser.id}`);
    server.close(); stub.close();
  }
}

main()
  .catch((err) => { failures++; console.error("FATAL:", err); })
  .finally(() => setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300).unref?.());
