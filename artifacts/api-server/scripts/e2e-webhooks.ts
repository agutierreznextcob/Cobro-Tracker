/**
 * E2E webhook test: Flow & MercadoPago payment webhooks WITHOUT real payments.
 *
 * Mounts the real webhooksRouter in a local express app and points the Flow/MP
 * API clients at a local stub server (FLOW_API_BASE_URL / MP_API_BASE_URL), so
 * the verification calls the router makes ("call back to the provider to get
 * the REAL status") hit programmable fake responses instead of the real APIs.
 *
 * Covers:
 *  - Flow webhook: cobro completo pagado (status 2) → estado pagado + pagadoEn
 *  - Flow webhook tardío "fallido" (status 3) NO degrada un cobro pagado
 *  - Flow webhook de abono: confirma el abono y recalcula el estado del cobro
 *  - MP webhook: cobro completo approved → pagado (verificado con token del dueño)
 *  - MP webhook tardío rejected NO degrada un pagado
 *  - MP approved SÍ gana sobre un estado manual "cancelado" (dinero manda)
 *  - MP abono approved → abono confirmado + cobro parcial
 *  - MP owner-token mismatch (external_reference distinto con el token del dueño)
 *    → no se aplica ningún cambio de estado
 *
 * No real credentials needed. Run (from repo root; tsx lives in scripts/):
 *   ./scripts/node_modules/.bin/tsx artifacts/api-server/scripts/e2e-webhooks.ts
 */
import http from "http";
import type { AddressInfo } from "net";

// ── Stub provider server (Flow + MP fake APIs) ──────────────────────────────
// Programmable responses, keyed by flow token / mp payment id (+ MP auth token).
type FlowStubStatus = { status: number; flowOrder: number; amount: number };
const flowResponses = new Map<string, FlowStubStatus>();
// key: `${paymentId}` → default; `${paymentId}:${bearer}` → per-token override
const mpResponses = new Map<string, { status: string; external_reference: string }>();

const stub = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://stub");
  if (url.pathname === "/payment/getStatus") {
    const token = url.searchParams.get("token") ?? "";
    const r = flowResponses.get(token);
    if (!r) { res.writeHead(404).end(JSON.stringify({ code: 404, message: "token not found" })); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      flowOrder: r.flowOrder, commerceOrder: `stub-${token}`, requestDate: "2026-01-01 00:00:00",
      status: r.status, subject: "stub", currency: "CLP", amount: r.amount, payer: "payer@test.cl",
    }));
    return;
  }
  const mpMatch = url.pathname.match(/^\/v1\/payments\/(.+)$/);
  if (mpMatch) {
    const paymentId = mpMatch[1];
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const r = mpResponses.get(`${paymentId}:${bearer}`) ?? mpResponses.get(paymentId);
    if (!r) { res.writeHead(404).end(JSON.stringify({ message: "payment not found" })); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: Number(paymentId.replace(/\D/g, "")) || 1,
      status: r.status, status_detail: "stub",
      external_reference: r.external_reference, transaction_amount: 1000,
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
  // 1. Start the stub and point the API clients at it BEFORE importing the router.
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.FLOW_API_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.MP_API_BASE_URL = `http://127.0.0.1:${stubPort}`;
  // Global platform MP token (used as candidate + fallback trusted token).
  process.env.MP_ACCESS_TOKEN = "stub-global-token";

  const { db, cobrosTable, pagosParciales, usersTable, flowCredencialesTable, mpCredencialesTable, comprobantesTable, encuestasTable, webhookEventosTable } =
    await import("@workspace/db");
  const { eq, inArray, desc } = await import("drizzle-orm");
  const { encrypt, decrypt } = await import("../src/lib/encrypt");
  const express = (await import("express")).default;
  const webhooksRouter = (await import("../src/routes/webhooks")).default;

  // 2. Mount the REAL webhooks router in a local app (form-urlencoded like Flow).
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const log = { info: () => {}, warn: () => {}, error: () => {} };
  app.use((req, _res, next) => { (req as any).log = log; (req as any).isAuthenticated = () => false; next(); });
  app.use(webhooksRouter);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const apiPort = (server.address() as AddressInfo).port;

  const postFlow = async (token: string) => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/webhooks/flow`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return { status: res.status, json: await res.json() };
  };
  const postMp = async (paymentId: string) => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/webhooks/mercadopago?topic=payment&id=${paymentId}`, { method: "POST" });
    return { status: res.status, json: await res.json() };
  };

  // 3. Test fixtures: demo user + Flow credentials (fake, encrypted like real ones).
  const DEMO_EMAIL = "anibal.gutierrezbasoalto@gmail.com";
  const [demo] = await db.select().from(usersTable).where(eq(usersTable.email, DEMO_EMAIL));
  if (!demo) throw new Error(`Demo user ${DEMO_EMAIL} not found`);
  const ownerId = demo.id;

  const [hadFlowCreds] = await db.select({ userId: flowCredencialesTable.userId }).from(flowCredencialesTable).where(eq(flowCredencialesTable.userId, ownerId));
  if (!hadFlowCreds) {
    const a = encrypt("stub-flow-api-key"); const s = encrypt("stub-flow-secret");
    await db.insert(flowCredencialesTable).values({
      userId: ownerId,
      apiKeyEncrypted: a.encrypted, apiKeyIv: a.iv, apiKeyAuthTag: a.authTag,
      secretKeyEncrypted: s.encrypted, secretKeyIv: s.iv, secretKeyAuthTag: s.authTag,
      actualizadoEn: new Date(),
    });
  }
  const [hadMpCreds] = await db.select().from(mpCredencialesTable).where(eq(mpCredencialesTable.userId, ownerId));
  let OWNER_MP_TOKEN = "stub-owner-mp-token";
  if (!hadMpCreds) {
    const t = encrypt(OWNER_MP_TOKEN);
    await db.insert(mpCredencialesTable).values({
      userId: ownerId,
      accessTokenEncrypted: t.encrypted, accessTokenIv: t.iv, accessTokenAuthTag: t.authTag,
      actualizadoEn: new Date(),
    });
  } else {
    // The demo user already has MP creds — the webhook will verify with THAT
    // token, so the stub's per-token overrides must be keyed by its real value.
    OWNER_MP_TOKEN = decrypt(hadMpCreds.accessTokenEncrypted, hadMpCreds.accessTokenIv, hadMpCreds.accessTokenAuthTag);
  }

  const createdCobroIds: number[] = [];
  const run = Date.now();
  async function crearCobro(fields: Partial<typeof cobrosTable.$inferInsert> & { descripcion: string; monto: string }) {
    const [row] = await db.insert(cobrosTable).values({
      responsableId: ownerId, responsableNombre: "E2E Webhooks",
      organizationId: demo.organizationId ?? null,
      ...fields,
    }).returning();
    createdCobroIds.push(row.id);
    return row;
  }
  const getCobro = async (id: number) => (await db.select().from(cobrosTable).where(eq(cobrosTable.id, id)))[0];
  const ultimoEvento = async (cobroId: number) =>
    (await db.select().from(webhookEventosTable).where(eq(webhookEventosTable.cobroId, cobroId)).orderBy(desc(webhookEventosTable.creadoEn)).limit(1))[0];

  // ══════════════════════════════════════════════════════════════════════════
  console.log("== Flow: cobro completo pagado + webhook tardío fallido ==");
  const tokenA = `e2e-flow-A-${run}`;
  const cobroA = await crearCobro({ monto: "50000", descripcion: "E2E webhook Flow A", flowToken: tokenA });

  flowResponses.set(tokenA, { status: 1, flowOrder: 111, amount: 50000 });
  let r = await postFlow(tokenA);
  check("Flow pendiente → 200 ok", r.status === 200 && r.json.ok === true, r);
  check("Flow pendiente no cambia estado", (await getCobro(cobroA.id)).estado === "pendiente");

  flowResponses.set(tokenA, { status: 2, flowOrder: 111, amount: 50000 });
  r = await postFlow(tokenA);
  check("Flow pagado → 200 ok", r.status === 200 && r.json.ok === true, r);
  let a = await getCobro(cobroA.id);
  check("Flow status 2 → estado pagado", a.estado === "pagado", a.estado);
  check("Flow pagado setea pagadoEn", !!a.pagadoEn, a.pagadoEn);
  const pagadoEnA = a.pagadoEn;

  // Late/out-of-order "rejected" webhook must NOT downgrade the paid cobro.
  flowResponses.set(tokenA, { status: 3, flowOrder: 111, amount: 50000 });
  r = await postFlow(tokenA);
  check("Flow fallido tardío → 200 ok", r.status === 200 && r.json.ok === true, r);
  a = await getCobro(cobroA.id);
  check("fallido tardío NO degrada pagado", a.estado === "pagado", a.estado);
  check("pagadoEn se conserva", String(a.pagadoEn) === String(pagadoEnA), { antes: pagadoEnA, ahora: a.pagadoEn });
  const evA = await ultimoEvento(cobroA.id);
  check("evento flow.pago.ignorado registrado", evA?.evento === "flow.pago.ignorado", evA?.evento);

  // ══════════════════════════════════════════════════════════════════════════
  console.log("== Flow: abonos por webhook (parcial → pagado) ==");
  const cobroB = await crearCobro({ monto: "100000", descripcion: "E2E webhook Flow B (abonos)" });
  const tokAb1 = `e2e-flow-B1-${run}`; const tokAb2 = `e2e-flow-B2-${run}`;
  const [ab1] = await db.insert(pagosParciales).values({ cobroId: cobroB.id, monto: "40000", metodo: "flow", estado: "pendiente", flowToken: tokAb1 }).returning();
  const [ab2] = await db.insert(pagosParciales).values({ cobroId: cobroB.id, monto: "60000", metodo: "flow", estado: "pendiente", flowToken: tokAb2 }).returning();

  flowResponses.set(tokAb1, { status: 2, flowOrder: 222, amount: 40000 });
  r = await postFlow(tokAb1);
  check("Flow abono1 webhook → 200 ok", r.status === 200 && r.json.ok === true, r);
  let b = await getCobro(cobroB.id);
  const ab1Row = (await db.select().from(pagosParciales).where(eq(pagosParciales.id, ab1.id)))[0];
  check("abono1 confirmado", ab1Row.estado === "confirmado", ab1Row.estado);
  check("cobro B parcial tras abono1", b.estado === "parcial", b.estado);
  check("cobro B pagadoEn sigue null en parcial", !b.pagadoEn, b.pagadoEn);

  // Failed abono webhook must not touch the cobro estado.
  flowResponses.set(tokAb2, { status: 3, flowOrder: 223, amount: 60000 });
  r = await postFlow(tokAb2);
  const ab2Fallido = (await db.select().from(pagosParciales).where(eq(pagosParciales.id, ab2.id)))[0];
  check("abono2 fallido marcado", ab2Fallido.estado === "fallido", ab2Fallido.estado);
  check("cobro B sigue parcial tras abono fallido", (await getCobro(cobroB.id)).estado === "parcial");

  // Retry succeeds → cobro fully paid.
  flowResponses.set(tokAb2, { status: 2, flowOrder: 223, amount: 60000 });
  r = await postFlow(tokAb2);
  b = await getCobro(cobroB.id);
  check("cobro B pagado tras abono2 confirmado", b.estado === "pagado", b.estado);
  check("cobro B pagadoEn seteado al completar", !!b.pagadoEn, b.pagadoEn);

  // ══════════════════════════════════════════════════════════════════════════
  console.log("== MP: cobro completo approved + rejected tardío + dinero gana a manual ==");
  // Start from a manually-cancelled cobro: an approved payment must still win.
  const cobroC = await crearCobro({ monto: "75000", descripcion: "E2E webhook MP C", estado: "cancelado", mpPreferenceId: `e2e-pref-${run}` });
  const payC = `91${run}`;
  mpResponses.set(payC, { status: "approved", external_reference: `cobro-${cobroC.id}` });
  r = await postMp(payC);
  check("MP approved → 200 ok", r.status === 200 && r.json.ok === true, r);
  let c = await getCobro(cobroC.id);
  check("MP approved gana sobre manual cancelado", c.estado === "pagado", c.estado);
  check("MP pagado setea pagadoEn", !!c.pagadoEn, c.pagadoEn);

  mpResponses.set(payC, { status: "rejected", external_reference: `cobro-${cobroC.id}` });
  r = await postMp(payC);
  c = await getCobro(cobroC.id);
  check("MP rejected tardío NO degrada pagado", c.estado === "pagado", c.estado);
  const evC = await ultimoEvento(cobroC.id);
  check("evento mp.pago.ignorado registrado", evC?.evento === "mp.pago.ignorado", evC?.evento);

  // A REAL refund confirmed by the provider is the one exception: it may
  // downgrade a paid cobro (esReembolso bypasses the money-state protection).
  mpResponses.set(payC, { status: "refunded", external_reference: `cobro-${cobroC.id}` });
  r = await postMp(payC);
  c = await getCobro(cobroC.id);
  check("MP refunded SÍ degrada pagado → cancelado", c.estado === "cancelado", c.estado);
  check("refund limpia pagadoEn", !c.pagadoEn, c.pagadoEn);

  // ══════════════════════════════════════════════════════════════════════════
  console.log("== MP: abono approved → confirmado + parcial ==");
  const cobroD = await crearCobro({ monto: "80000", descripcion: "E2E webhook MP D (abono)" });
  const [abD] = await db.insert(pagosParciales).values({ cobroId: cobroD.id, monto: "30000", metodo: "mp", estado: "pendiente", mpPreferenceId: `e2e-pref-abD-${run}` }).returning();
  const payD = `92${run}`;
  mpResponses.set(payD, { status: "approved", external_reference: `abono-${abD.id}` });
  r = await postMp(payD);
  check("MP abono webhook → 200 ok", r.status === 200 && r.json.ok === true, r);
  const abDRow = (await db.select().from(pagosParciales).where(eq(pagosParciales.id, abD.id)))[0];
  check("MP abono confirmado", abDRow.estado === "confirmado", abDRow.estado);
  check("MP abono guarda mpPaymentId", abDRow.mpPaymentId === payD, abDRow.mpPaymentId);
  const d = await getCobro(cobroD.id);
  check("cobro D parcial tras abono MP", d.estado === "parcial", d.estado);

  // ══════════════════════════════════════════════════════════════════════════
  console.log("== MP: verificación con token del dueño (mismatch bloquea) ==");
  // The global token claims the payment belongs to cobro E, but the OWNER's
  // token sees a different external_reference → the change must be rejected.
  const cobroE = await crearCobro({ monto: "60000", descripcion: "E2E webhook MP E (owner mismatch)", mpPreferenceId: `e2e-pref-E-${run}` });
  const payE = `93${run}`;
  mpResponses.set(payE, { status: "approved", external_reference: `cobro-${cobroE.id}` });
  mpResponses.set(`${payE}:${OWNER_MP_TOKEN}`, { status: "approved", external_reference: `cobro-999999999` });
  r = await postMp(payE);
  check("MP owner mismatch → ok:false", r.status === 200 && r.json.ok === false, r);
  const e = await getCobro(cobroE.id);
  check("MP owner mismatch NO cambia estado", e.estado === "pendiente", e.estado);
  const evE = await ultimoEvento(cobroE.id);
  check("evento mp.webhook.error de verificación", evE?.evento === "mp.webhook.error", evE?.evento);

  // Same payment, owner token now agrees → applies.
  mpResponses.set(`${payE}:${OWNER_MP_TOKEN}`, { status: "approved", external_reference: `cobro-${cobroE.id}` });
  r = await postMp(payE);
  check("MP owner OK aplica pagado", (await getCobro(cobroE.id)).estado === "pagado");

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  if (createdCobroIds.length) {
    await db.delete(encuestasTable).where(inArray(encuestasTable.cobroId, createdCobroIds));
    await db.delete(comprobantesTable).where(inArray(comprobantesTable.cobroId, createdCobroIds));
    await db.delete(pagosParciales).where(inArray(pagosParciales.cobroId, createdCobroIds));
    await db.delete(webhookEventosTable).where(inArray(webhookEventosTable.cobroId, createdCobroIds));
    await db.delete(cobrosTable).where(inArray(cobrosTable.id, createdCobroIds));
  }
  if (!hadFlowCreds) await db.delete(flowCredencialesTable).where(eq(flowCredencialesTable.userId, ownerId));
  if (!hadMpCreds) await db.delete(mpCredencialesTable).where(eq(mpCredencialesTable.userId, ownerId));
  console.log(`Cleanup: removed cobros ${createdCobroIds.join(", ")}${hadFlowCreds ? "" : ", stub Flow creds"}${hadMpCreds ? "" : ", stub MP creds"}`);

  server.close(); stub.close();
}

main()
  .catch((err) => { failures++; console.error("FATAL:", err); })
  .finally(() => setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300).unref?.());
