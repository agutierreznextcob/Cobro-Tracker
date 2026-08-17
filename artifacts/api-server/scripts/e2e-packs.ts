/**
 * E2E pack test: verifica el flujo de compra y cobro de packs de punta a punta.
 *
 * Monta subscriptionRouter y organizationRouter en un servidor Express local y
 * apunta el cliente Reveniu a un stub HTTP local, de modo que no se hacen
 * llamadas reales a ningún proveedor de facturación.
 *
 * Cubre:
 *  - Agregar pack10 con suscripción activa: setReveniuAmount llamado con 113026
 *  - reveniuMontoSync actualizado en DB tras agregar y quitar
 *  - cupoUsuarios y totalMensual correctos en /subscription/status y /organization
 *  - Quitar pack10 bloqueado cuando asientos ocupados exceederían el nuevo cupo (400)
 *  - Invitar bloqueado cuando la org está al límite de capacidad (403, code: sin_cupo)
 *  - sincronizarMontosReveniu (sweep) no pisa reveniuMontoSync ≠ modelo (grandfathering)
 *  - Acumulación: 2× pack5 → totalMensual = nextcob + 2×pack5, cupoUsuarios = 12, cantidad=2 en packs[]
 *  - Quitar uno de dos pack5 → delta correcto, cupo restante cubre miembros activos
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/e2e-packs.ts
 */
import http from "http";
import type { AddressInfo } from "net";

// ── Stub Reveniu ─────────────────────────────────────────────────────────────
// Records every amount-update call so tests can assert on what was sent.
type AmountCall = { subscriptionId: number; amount: number };
const amountCalls: AmountCall[] = [];

const stub = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://stub");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const amountMatch = url.pathname.match(/^\/api\/v1\/subscriptions\/(\d+)\/amount\/$/);
    if (amountMatch && req.method === "POST") {
      const subscriptionId = Number(amountMatch[1]);
      const parsed = body ? JSON.parse(body) : {};
      amountCalls.push({ subscriptionId, amount: parsed.amount });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: subscriptionId }));
      return;
    }
    // Any other Reveniu endpoint: accept silently (checkout, plan creation, etc.)
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
});

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  // ── 1. Start stub; set env vars BEFORE dynamic imports ───────────────────
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.REVENIU_BASE_URL = `http://127.0.0.1:${stubPort}`;
  // Ensure reveniuConfigured() returns true so the sweep and amount-push paths run.
  if (!process.env.REVENIU_SECRET_KEY) process.env.REVENIU_SECRET_KEY = "stub-secret-e2e";

  // ── 2. Dynamic imports (modules read process.env at load time) ────────────
  const { db, usersTable, organizacionesTable, invitacionesTable } =
    await import("@workspace/db");
  const { eq, inArray, and } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const { subscriptionRouter } = await import("../src/routes/subscription");
  const { organizationRouter } = await import("../src/routes/organization");
  const { sincronizarMontosReveniu } = await import("../src/lib/reveniu");
  const { computePricing } = await import("../src/lib/org");
  const { normalizarPacks } = await import("../src/lib/plans");

  // ── 3. Local Express server with mocked auth ──────────────────────────────
  // The real subscription and organization routes run in this process, so
  // REVENIU_BASE_URL is already pointing at the stub. Auth is mocked by
  // setting req.user before each request via a shared variable.
  const silentLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => silentLog,
  };
  let currentUser: any = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => !!currentUser;
    (req as any).log = silentLog;
    next();
  });
  app.use(subscriptionRouter);
  app.use(organizationRouter);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const apiPort = (server.address() as AddressInfo).port;

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  }

  // ── 4. Fixtures ──────────────────────────────────────────────────────────
  // Isolated: owner with active Reveniu subscription + an org.
  // No real Reveniu calls are needed: the stub handles amount updates.
  // Expected pricing constants (from plans.ts):
  //   NextCob: neto 24_990 + IVA 4_748 = total 29_738; 2 seats included
  //   pack10:  neto 69_990 + IVA 13_298 = total 83_288; 10 extra seats
  //   Total with pack10: 29_738 + 83_288 = 113_026
  //   pack5:   neto 39_990 + IVA 7_598  = total 47_588;  5 extra seats
  //   Total with 1× pack5: 29_738 + 47_588 = 77_326
  //   Total with 2× pack5: 29_738 + 95_176 = 124_914; cupo = 2 + 10 = 12
  const NEXTCOB_TOTAL = 29_738;
  const PACK10_TOTAL = 83_288;
  const TOTAL_WITH_PACK10 = NEXTCOB_TOTAL + PACK10_TOTAL; // 113_026
  const PACK5_TOTAL = 47_588;
  const TOTAL_WITH_1x_PACK5 = NEXTCOB_TOTAL + PACK5_TOTAL;       // 77_326
  const TOTAL_WITH_2x_PACK5 = NEXTCOB_TOTAL + 2 * PACK5_TOTAL;  // 124_914
  const FAKE_SUB_ID = 88_888;

  const ts = Date.now();
  const createdUserIds: string[] = [];
  const createdOrgIds: number[] = [];

  try {
    const [owner] = await db
      .insert(usersTable)
      .values({
        email: `e2e-packs-owner-${ts}@test.invalid`,
        activo: true,
        orgRole: "admin_org",
        subscriptionStatus: "activa",
        plan: "nextcob",
        reveniuSubscriptionId: FAKE_SUB_ID,
        reveniuMontoSync: null,
      } as any)
      .returning();
    createdUserIds.push(owner.id);

    const [org] = await db
      .insert(organizacionesTable)
      .values({ nombre: `TestPacks-${ts}`, ownerId: owner.id })
      .returning();
    createdOrgIds.push(org.id);

    await db
      .update(usersTable)
      .set({ organizationId: org.id })
      .where(eq(usersTable.id, owner.id));

    // Fixture member to test occupied-seats restriction.
    const [member] = await db
      .insert(usersTable)
      .values({
        email: `e2e-packs-member-${ts}@test.invalid`,
        activo: false, // starts deactivated; activated when needed
        organizationId: org.id,
        orgRole: "ejecutivo",
      } as any)
      .returning();
    createdUserIds.push(member.id);

    // Reload owner with organizationId set.
    const reloadOwner = async () => {
      const [row] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, owner.id));
      currentUser = row;
      return row;
    };
    await reloadOwner();
    console.log(`  (fixture: owner=${owner.id}, org=${org.id}, reveniuSubId=${FAKE_SUB_ID})`);

    // ── Baseline /subscription/status ──────────────────────────────────────
    console.log("== Baseline /subscription/status (activa, sin packs) ==");
    const statusBase = await call("GET", "/subscription/status");
    check("status 200", statusBase.status === 200, statusBase.json);
    const cupoBase: number = statusBase.json?.cupoUsuarios ?? 0;
    const totalBase: number = statusBase.json?.totalMensual ?? 0;
    check(`cupoBase = 2 (nextcob incluye 2 usuarios)`, cupoBase === 2, cupoBase);
    check(`totalBase = ${NEXTCOB_TOTAL} (nextcob)`, totalBase === NEXTCOB_TOTAL, totalBase);

    // ── Agregar pack10 ─────────────────────────────────────────────────────
    console.log("== Agregar pack10 → setReveniuAmount llamado con 113026 ==");
    const callsBefore = amountCalls.length;
    const addPack = await call("POST", "/subscription/packs", { pack: "pack10", accion: "agregar" });
    check("agregar pack10 → 200", addPack.status === 200, addPack.json);
    check(`totalMensual = ${TOTAL_WITH_PACK10} en respuesta`, addPack.json?.totalMensual === TOTAL_WITH_PACK10, addPack.json?.totalMensual);

    // Stub must have received exactly one amount call with the right values.
    const newCalls = amountCalls.slice(callsBefore);
    check("setReveniuAmount llamado exactamente 1 vez", newCalls.length === 1, newCalls);
    check(
      `setReveniuAmount recibió subscriptionId=${FAKE_SUB_ID}`,
      newCalls.some((c) => c.subscriptionId === FAKE_SUB_ID),
      newCalls,
    );
    check(
      `setReveniuAmount recibió amount=${TOTAL_WITH_PACK10}`,
      newCalls.some((c) => c.subscriptionId === FAKE_SUB_ID && c.amount === TOTAL_WITH_PACK10),
      newCalls,
    );

    // DB: reveniuMontoSync y packsUsuarios actualizados.
    const [afterAdd] = await db
      .select({ reveniuMontoSync: usersTable.reveniuMontoSync, packsUsuarios: usersTable.packsUsuarios })
      .from(usersTable)
      .where(eq(usersTable.id, owner.id));
    check(`reveniuMontoSync = ${TOTAL_WITH_PACK10} en DB`, afterAdd?.reveniuMontoSync === TOTAL_WITH_PACK10, afterAdd?.reveniuMontoSync);
    check("packsUsuarios tiene pack10:1 en DB", (afterAdd?.packsUsuarios as any)?.pack10 === 1, afterAdd?.packsUsuarios);

    // ── /subscription/status con pack10 ───────────────────────────────────
    console.log("== /subscription/status con pack10 ==");
    await reloadOwner();
    const statusWithPack = await call("GET", "/subscription/status");
    check("status 200", statusWithPack.status === 200, statusWithPack.status);
    check("cupoUsuarios = 12 (2 + 10)", statusWithPack.json?.cupoUsuarios === 12, statusWithPack.json?.cupoUsuarios);
    check(`totalMensual = ${TOTAL_WITH_PACK10}`, statusWithPack.json?.totalMensual === TOTAL_WITH_PACK10, statusWithPack.json?.totalMensual);
    const packsArr: any[] = statusWithPack.json?.packs ?? [];
    check(
      "packs array incluye pack10 con cantidad=1",
      packsArr.some((p: any) => (p.id ?? p.pack) === "pack10" && p.cantidad === 1),
      packsArr,
    );

    // ── /organization cupoUsuarios ─────────────────────────────────────────
    console.log("== /organization cupoUsuarios = 12 ==");
    const orgResp = await call("GET", "/organization");
    check("/organization 200", orgResp.status === 200, orgResp.json);
    check("/organization cupoUsuarios = 12", orgResp.json?.cupoUsuarios === 12, orgResp.json?.cupoUsuarios);

    // ── Quitar pack10 con asientos ocupados → 400 ─────────────────────────
    // Activate the member so org has 2 activos (= base cupo); removing pack10
    // would leave cupo=2 but activos=2 — which is exactly at the limit, so it
    // should succeed... We need activos > cupoBase to trigger the 400.
    // Insert one more member to get activos=3 > cupoBase=2.
    console.log("== Quitar pack10 con asientos ocupados (activos > cupoBase) → 400 ==");
    await db.update(usersTable).set({ activo: true }).where(eq(usersTable.id, member.id));

    const [member2] = await db
      .insert(usersTable)
      .values({
        email: `e2e-packs-member2-${ts}@test.invalid`,
        activo: true,
        organizationId: org.id,
        orgRole: "ejecutivo",
      } as any)
      .returning();
    createdUserIds.push(member2.id);
    console.log(`  (3 activos: owner + member + member2; cupoBase=${cupoBase})`);

    await reloadOwner();
    const quitarOcupado = await call("POST", "/subscription/packs", { pack: "pack10", accion: "quitar" });
    check("quitar pack10 con asientos ocupados → 400", quitarOcupado.status === 400, quitarOcupado.json);
    check(
      "error menciona miembros activos",
      typeof quitarOcupado.json?.error === "string" &&
        quitarOcupado.json.error.toLowerCase().includes("miembro"),
      quitarOcupado.json?.error,
    );

    // Deactivate both fixture members before removing the pack cleanly.
    await db.update(usersTable).set({ activo: false }).where(eq(usersTable.id, member.id));
    await db.update(usersTable).set({ activo: false }).where(eq(usersTable.id, member2.id));

    // ── Quitar pack10 limpiamente ──────────────────────────────────────────
    console.log(`== Quitar pack10 limpiamente → setReveniuAmount con ${NEXTCOB_TOTAL} ==`);
    const callsBeforeRemove = amountCalls.length;
    await reloadOwner();
    const removePack = await call("POST", "/subscription/packs", { pack: "pack10", accion: "quitar" });
    check("quitar pack10 → 200", removePack.status === 200, removePack.json);
    check(`totalMensual = ${NEXTCOB_TOTAL} tras quitar`, removePack.json?.totalMensual === NEXTCOB_TOTAL, removePack.json?.totalMensual);

    const removeCalls = amountCalls.slice(callsBeforeRemove);
    check("setReveniuAmount llamado exactamente 1 vez al quitar", removeCalls.length === 1, removeCalls);
    check(
      `setReveniuAmount recibió amount=${NEXTCOB_TOTAL} al quitar`,
      removeCalls.some((c) => c.subscriptionId === FAKE_SUB_ID && c.amount === NEXTCOB_TOTAL),
      removeCalls,
    );

    const [afterRemove] = await db
      .select({ reveniuMontoSync: usersTable.reveniuMontoSync, packsUsuarios: usersTable.packsUsuarios })
      .from(usersTable)
      .where(eq(usersTable.id, owner.id));
    check(`reveniuMontoSync = ${NEXTCOB_TOTAL} en DB tras quitar`, afterRemove?.reveniuMontoSync === NEXTCOB_TOTAL, afterRemove?.reveniuMontoSync);
    check(
      "packsUsuarios vacío en DB tras quitar",
      Object.keys(normalizarPacks(afterRemove?.packsUsuarios)).length === 0,
      afterRemove?.packsUsuarios,
    );

    // ── Acumulación: 2× pack5 ─────────────────────────────────────────────
    // Verifica que agregar el mismo tipo de pack dos veces acumula cantidades
    // correctamente (totalMensual y cupoUsuarios son proporcionales a 2×).
    console.log("== Acumulación: agregar 1er pack5 ==");
    await reloadOwner();
    const callsBefore1stPack5 = amountCalls.length;
    const add1stPack5 = await call("POST", "/subscription/packs", { pack: "pack5", accion: "agregar" });
    check("agregar 1er pack5 → 200", add1stPack5.status === 200, add1stPack5.json);
    check(
      `totalMensual = ${TOTAL_WITH_1x_PACK5} tras 1er pack5`,
      add1stPack5.json?.totalMensual === TOTAL_WITH_1x_PACK5,
      add1stPack5.json?.totalMensual,
    );
    const calls1stPack5 = amountCalls.slice(callsBefore1stPack5);
    check("setReveniuAmount llamado 1 vez al agregar 1er pack5", calls1stPack5.length === 1, calls1stPack5);
    check(
      `setReveniuAmount recibió amount=${TOTAL_WITH_1x_PACK5}`,
      calls1stPack5.some((c) => c.amount === TOTAL_WITH_1x_PACK5),
      calls1stPack5,
    );

    console.log("== Acumulación: agregar 2do pack5 ==");
    await reloadOwner();
    const callsBefore2ndPack5 = amountCalls.length;
    const add2ndPack5 = await call("POST", "/subscription/packs", { pack: "pack5", accion: "agregar" });
    check("agregar 2do pack5 → 200", add2ndPack5.status === 200, add2ndPack5.json);
    check(
      `totalMensual = ${TOTAL_WITH_2x_PACK5} tras 2× pack5`,
      add2ndPack5.json?.totalMensual === TOTAL_WITH_2x_PACK5,
      add2ndPack5.json?.totalMensual,
    );
    const calls2ndPack5 = amountCalls.slice(callsBefore2ndPack5);
    check("setReveniuAmount llamado 1 vez al agregar 2do pack5", calls2ndPack5.length === 1, calls2ndPack5);
    check(
      `setReveniuAmount recibió amount=${TOTAL_WITH_2x_PACK5}`,
      calls2ndPack5.some((c) => c.amount === TOTAL_WITH_2x_PACK5),
      calls2ndPack5,
    );

    // DB: packsUsuarios debe tener pack5:2.
    const [after2xPack5] = await db
      .select({ reveniuMontoSync: usersTable.reveniuMontoSync, packsUsuarios: usersTable.packsUsuarios })
      .from(usersTable)
      .where(eq(usersTable.id, owner.id));
    check(`reveniuMontoSync = ${TOTAL_WITH_2x_PACK5} en DB`, after2xPack5?.reveniuMontoSync === TOTAL_WITH_2x_PACK5, after2xPack5?.reveniuMontoSync);
    check("packsUsuarios tiene pack5:2 en DB", (after2xPack5?.packsUsuarios as any)?.pack5 === 2, after2xPack5?.packsUsuarios);

    // /subscription/status: packs[] debe exponer cantidad=2 para pack5.
    console.log("== /subscription/status: packs[] cantidad=2 para pack5 ==");
    await reloadOwner();
    const statusWith2xPack5 = await call("GET", "/subscription/status");
    check("status 200", statusWith2xPack5.status === 200, statusWith2xPack5.status);
    check(
      "cupoUsuarios = 12 en /subscription/status con 2× pack5",
      statusWith2xPack5.json?.cupoUsuarios === 12,
      statusWith2xPack5.json?.cupoUsuarios,
    );
    check(
      `totalMensual = ${TOTAL_WITH_2x_PACK5} en /subscription/status`,
      statusWith2xPack5.json?.totalMensual === TOTAL_WITH_2x_PACK5,
      statusWith2xPack5.json?.totalMensual,
    );
    const packsArr2x: any[] = statusWith2xPack5.json?.packs ?? [];
    check(
      "packs[] incluye pack5 con cantidad=2",
      packsArr2x.some((p: any) => (p.id ?? p.pack) === "pack5" && p.cantidad === 2),
      packsArr2x,
    );

    // ── Quitar uno de los dos pack5 ────────────────────────────────────────
    // Owner es el único activo en este momento (member y member2 desactivados
    // antes del quitar-pack10). Quitar un pack5 deja cupo=7, que cubre al
    // owner solo → debe ser permitido.
    console.log(`== Quitar 1 de 2 pack5 → totalMensual=${TOTAL_WITH_1x_PACK5}, cupo=7 ==`);
    await reloadOwner();
    const callsBeforeRemovePack5 = amountCalls.length;
    const remove1Pack5 = await call("POST", "/subscription/packs", { pack: "pack5", accion: "quitar" });
    check("quitar 1 pack5 → 200", remove1Pack5.status === 200, remove1Pack5.json);
    check(
      `totalMensual = ${TOTAL_WITH_1x_PACK5} tras quitar 1 pack5`,
      remove1Pack5.json?.totalMensual === TOTAL_WITH_1x_PACK5,
      remove1Pack5.json?.totalMensual,
    );
    const callsRemovePack5 = amountCalls.slice(callsBeforeRemovePack5);
    check("setReveniuAmount llamado 1 vez al quitar 1 pack5", callsRemovePack5.length === 1, callsRemovePack5);
    check(
      `setReveniuAmount recibió amount=${TOTAL_WITH_1x_PACK5}`,
      callsRemovePack5.some((c) => c.amount === TOTAL_WITH_1x_PACK5),
      callsRemovePack5,
    );

    // DB: packsUsuarios debe tener pack5:1.
    const [afterRemove1Pack5] = await db
      .select({ reveniuMontoSync: usersTable.reveniuMontoSync, packsUsuarios: usersTable.packsUsuarios })
      .from(usersTable)
      .where(eq(usersTable.id, owner.id));
    check(`reveniuMontoSync = ${TOTAL_WITH_1x_PACK5} en DB`, afterRemove1Pack5?.reveniuMontoSync === TOTAL_WITH_1x_PACK5, afterRemove1Pack5?.reveniuMontoSync);
    check("packsUsuarios tiene pack5:1 en DB tras quitar uno", (afterRemove1Pack5?.packsUsuarios as any)?.pack5 === 1, afterRemove1Pack5?.packsUsuarios);

    // /subscription/status: cupo reducido a 7 y cupo cubre miembros activos actuales (1).
    await reloadOwner();
    const statusAfterRemove1Pack5 = await call("GET", "/subscription/status");
    check(
      "cupoUsuarios = 7 (2 + 5×1) en /subscription/status tras quitar 1 pack5",
      statusAfterRemove1Pack5.json?.cupoUsuarios === 7,
      statusAfterRemove1Pack5.json?.cupoUsuarios,
    );
    check(
      `totalMensual = ${TOTAL_WITH_1x_PACK5} en /subscription/status tras quitar 1 pack5`,
      statusAfterRemove1Pack5.json?.totalMensual === TOTAL_WITH_1x_PACK5,
      statusAfterRemove1Pack5.json?.totalMensual,
    );
    const packsArrAfterRemove: any[] = statusAfterRemove1Pack5.json?.packs ?? [];
    check(
      "packs[] muestra pack5 con cantidad=1 tras quitar uno",
      packsArrAfterRemove.some((p: any) => (p.id ?? p.pack) === "pack5" && p.cantidad === 1),
      packsArrAfterRemove,
    );

    // Quitar el último pack5 para limpiar el estado antes del resto de tests.
    await reloadOwner();
    const removeLastPack5 = await call("POST", "/subscription/packs", { pack: "pack5", accion: "quitar" });
    check(`quitar último pack5 → 200`, removeLastPack5.status === 200, removeLastPack5.json);
    check(`totalMensual vuelve a ${NEXTCOB_TOTAL}`, removeLastPack5.json?.totalMensual === NEXTCOB_TOTAL, removeLastPack5.json?.totalMensual);

    // ── Packs heterogéneos: individual + pack5 + pack10 simultáneos ───────
    // Verifica que normalizarPacks / costoDePacks / cupoDePacks manejan
    // correctamente una mezcla de tipos distintos de pack sin overcharge.
    //
    // Precio unitario de cada pack (IVA incluido):
    //   individual: neto=9990 + IVA=1898 = total 11888; 1 asiento extra
    //   pack5:      neto=39990 + IVA=7598 = total 47588; 5 asientos extra
    //   pack10:     neto=69990 + IVA=13298 = total 83288; 10 asientos extra
    //
    // Expectativas acumuladas paso a paso:
    //   paso 1 (+ individual):        total = 29738 + 11888 = 41626  cupo = 2+1 = 3
    //   paso 2 (+ individual + pack5): total = 41626 + 47588 = 89214  cupo = 3+5 = 8
    //   paso 3 (+ todo):              total = 89214 + 83288 = 172502 cupo = 8+10 = 18
    const INDIVIDUAL_TOTAL = 11_888;
    const TOTAL_WITH_INDIVIDUAL              = NEXTCOB_TOTAL + INDIVIDUAL_TOTAL;               // 41_626
    const TOTAL_WITH_INDIVIDUAL_PACK5        = TOTAL_WITH_INDIVIDUAL + PACK5_TOTAL;            // 89_214
    const TOTAL_WITH_INDIVIDUAL_PACK5_PACK10 = TOTAL_WITH_INDIVIDUAL_PACK5 + PACK10_TOTAL;    // 172_502

    console.log("== Packs mixtos: agregar pack individual ==");
    await reloadOwner();
    const callsBeforeIndividual = amountCalls.length;
    const addIndividual = await call("POST", "/subscription/packs", { pack: "individual", accion: "agregar" });
    check("agregar individual → 200", addIndividual.status === 200, addIndividual.json);
    check(
      `totalMensual = ${TOTAL_WITH_INDIVIDUAL} tras individual`,
      addIndividual.json?.totalMensual === TOTAL_WITH_INDIVIDUAL,
      addIndividual.json?.totalMensual,
    );
    const callsIndividual = amountCalls.slice(callsBeforeIndividual);
    check("setReveniuAmount llamado 1 vez al agregar individual", callsIndividual.length === 1, callsIndividual);
    check(
      `setReveniuAmount recibió amount=${TOTAL_WITH_INDIVIDUAL}`,
      callsIndividual.some((c) => c.amount === TOTAL_WITH_INDIVIDUAL),
      callsIndividual,
    );

    // /subscription/status tras individual: cupo=3, packs[individual].cantidad=1
    await reloadOwner();
    const statusWithIndividual = await call("GET", "/subscription/status");
    check("status 200", statusWithIndividual.status === 200, statusWithIndividual.status);
    check(
      "cupoUsuarios = 3 (2+1) tras agregar individual",
      statusWithIndividual.json?.cupoUsuarios === 3,
      statusWithIndividual.json?.cupoUsuarios,
    );
    check(
      `totalMensual = ${TOTAL_WITH_INDIVIDUAL} en status tras individual`,
      statusWithIndividual.json?.totalMensual === TOTAL_WITH_INDIVIDUAL,
      statusWithIndividual.json?.totalMensual,
    );
    const packsArrInd: any[] = statusWithIndividual.json?.packs ?? [];
    check(
      "packs[] incluye individual con cantidad=1",
      packsArrInd.some((p: any) => (p.id ?? p.pack) === "individual" && p.cantidad === 1),
      packsArrInd,
    );

    console.log("== Packs mixtos: agregar pack5 (individual ya presente) ==");
    await reloadOwner();
    const callsBeforeMixedPack5 = amountCalls.length;
    const addMixedPack5 = await call("POST", "/subscription/packs", { pack: "pack5", accion: "agregar" });
    check("agregar pack5 (junto a individual) → 200", addMixedPack5.status === 200, addMixedPack5.json);
    check(
      `totalMensual = ${TOTAL_WITH_INDIVIDUAL_PACK5} tras individual+pack5`,
      addMixedPack5.json?.totalMensual === TOTAL_WITH_INDIVIDUAL_PACK5,
      addMixedPack5.json?.totalMensual,
    );
    const callsMixedPack5 = amountCalls.slice(callsBeforeMixedPack5);
    check("setReveniuAmount llamado 1 vez al agregar pack5 mixto", callsMixedPack5.length === 1, callsMixedPack5);
    check(
      `setReveniuAmount recibió amount=${TOTAL_WITH_INDIVIDUAL_PACK5}`,
      callsMixedPack5.some((c) => c.amount === TOTAL_WITH_INDIVIDUAL_PACK5),
      callsMixedPack5,
    );

    // /subscription/status: cupo=8, ambos packs con cantidad=1
    await reloadOwner();
    const statusIndPack5 = await call("GET", "/subscription/status");
    check(
      "cupoUsuarios = 8 (2+1+5) tras individual+pack5",
      statusIndPack5.json?.cupoUsuarios === 8,
      statusIndPack5.json?.cupoUsuarios,
    );
    check(
      `totalMensual = ${TOTAL_WITH_INDIVIDUAL_PACK5} en status`,
      statusIndPack5.json?.totalMensual === TOTAL_WITH_INDIVIDUAL_PACK5,
      statusIndPack5.json?.totalMensual,
    );
    const packsArrIndP5: any[] = statusIndPack5.json?.packs ?? [];
    check(
      "packs[] incluye individual con cantidad=1",
      packsArrIndP5.some((p: any) => (p.id ?? p.pack) === "individual" && p.cantidad === 1),
      packsArrIndP5,
    );
    check(
      "packs[] incluye pack5 con cantidad=1",
      packsArrIndP5.some((p: any) => (p.id ?? p.pack) === "pack5" && p.cantidad === 1),
      packsArrIndP5,
    );

    console.log("== Packs mixtos: agregar pack10 (individual+pack5 ya presentes) ==");
    await reloadOwner();
    const callsBeforeMixedPack10 = amountCalls.length;
    const addMixedPack10 = await call("POST", "/subscription/packs", { pack: "pack10", accion: "agregar" });
    check("agregar pack10 (junto a individual+pack5) → 200", addMixedPack10.status === 200, addMixedPack10.json);
    check(
      `totalMensual = ${TOTAL_WITH_INDIVIDUAL_PACK5_PACK10} tras los tres packs`,
      addMixedPack10.json?.totalMensual === TOTAL_WITH_INDIVIDUAL_PACK5_PACK10,
      addMixedPack10.json?.totalMensual,
    );
    const callsMixedPack10 = amountCalls.slice(callsBeforeMixedPack10);
    check("setReveniuAmount llamado 1 vez al agregar pack10 mixto", callsMixedPack10.length === 1, callsMixedPack10);
    check(
      `setReveniuAmount recibió amount=${TOTAL_WITH_INDIVIDUAL_PACK5_PACK10}`,
      callsMixedPack10.some((c) => c.amount === TOTAL_WITH_INDIVIDUAL_PACK5_PACK10),
      callsMixedPack10,
    );

    // DB: packsUsuarios debe tener individual:1, pack5:1, pack10:1
    const [afterMixedAll] = await db
      .select({ reveniuMontoSync: usersTable.reveniuMontoSync, packsUsuarios: usersTable.packsUsuarios })
      .from(usersTable)
      .where(eq(usersTable.id, owner.id));
    check(
      `reveniuMontoSync = ${TOTAL_WITH_INDIVIDUAL_PACK5_PACK10} en DB`,
      afterMixedAll?.reveniuMontoSync === TOTAL_WITH_INDIVIDUAL_PACK5_PACK10,
      afterMixedAll?.reveniuMontoSync,
    );
    check("packsUsuarios DB: individual:1", (afterMixedAll?.packsUsuarios as any)?.individual === 1, afterMixedAll?.packsUsuarios);
    check("packsUsuarios DB: pack5:1", (afterMixedAll?.packsUsuarios as any)?.pack5 === 1, afterMixedAll?.packsUsuarios);
    check("packsUsuarios DB: pack10:1", (afterMixedAll?.packsUsuarios as any)?.pack10 === 1, afterMixedAll?.packsUsuarios);

    // /subscription/status: cupo=18 (2+1+5+10), packs[] todos con cantidad=1
    console.log("== /subscription/status con los tres packs mixtos: cupo=18 ==");
    await reloadOwner();
    const statusMixedAll = await call("GET", "/subscription/status");
    check("status 200", statusMixedAll.status === 200, statusMixedAll.status);
    check(
      "cupoUsuarios = 18 (2+1+5+10) con los tres packs",
      statusMixedAll.json?.cupoUsuarios === 18,
      statusMixedAll.json?.cupoUsuarios,
    );
    check(
      `totalMensual = ${TOTAL_WITH_INDIVIDUAL_PACK5_PACK10} en status con tres packs`,
      statusMixedAll.json?.totalMensual === TOTAL_WITH_INDIVIDUAL_PACK5_PACK10,
      statusMixedAll.json?.totalMensual,
    );
    const packsArrMixedAll: any[] = statusMixedAll.json?.packs ?? [];
    check(
      "packs[] incluye individual con cantidad=1",
      packsArrMixedAll.some((p: any) => (p.id ?? p.pack) === "individual" && p.cantidad === 1),
      packsArrMixedAll,
    );
    check(
      "packs[] incluye pack5 con cantidad=1",
      packsArrMixedAll.some((p: any) => (p.id ?? p.pack) === "pack5" && p.cantidad === 1),
      packsArrMixedAll,
    );
    check(
      "packs[] incluye pack10 con cantidad=1",
      packsArrMixedAll.some((p: any) => (p.id ?? p.pack) === "pack10" && p.cantidad === 1),
      packsArrMixedAll,
    );

    // Limpiar los tres packs mixtos antes de continuar con otros tests.
    for (const pack of ["individual", "pack5", "pack10"] as const) {
      await reloadOwner();
      const r = await call("POST", "/subscription/packs", { pack, accion: "quitar" });
      check(`quitar ${pack} mixto → 200`, r.status === 200, r.json);
    }
    await reloadOwner();
    const statusClean = await call("GET", "/subscription/status");
    check(
      `totalMensual = ${NEXTCOB_TOTAL} tras limpiar packs mixtos`,
      statusClean.json?.totalMensual === NEXTCOB_TOTAL,
      statusClean.json?.totalMensual,
    );

    // ── 403 sin_cupo al invitar con org al límite de capacidad ────────────
    // Reactivate both members → 3 activos > cupoBase=2 → cupo lleno (sin pack).
    console.log("== 403 sin_cupo al invitar con cupo lleno ==");
    await db.update(usersTable).set({ activo: true }).where(eq(usersTable.id, member.id));
    await db.update(usersTable).set({ activo: true }).where(eq(usersTable.id, member2.id));
    await reloadOwner();

    const invite = await call("POST", "/organization/invitaciones", {
      email: "e2e-packs-invite-test@test.invalid",
      orgRole: "ejecutivo",
    });
    check("invitar sin cupo → 403", invite.status === 403, invite.json);
    check('error code = "sin_cupo"', invite.json?.code === "sin_cupo", invite.json?.code);

    // ── Grandfathering: sweep scopeado no pisa reveniuMontoSync ≠ modelo ──
    // Un usuario con reveniuMontoSync != null y != total del modelo (cliente
    // legado / grandfathered) NO debe ser pisado por el sweep. Se usa un
    // fixture aislado con el filtro userIds para no tocar otros usuarios.
    console.log("== Grandfathering: sweep no pisa reveniuMontoSync ≠ modelo ==");
    const SENTINEL = 77_777; // distinto de 29738 y 113026
    const FAKE_GRANDF_SUB_ID = FAKE_SUB_ID + 1;

    const [gUser] = await db
      .insert(usersTable)
      .values({
        email: `e2e-packs-grandf-${ts}@test.invalid`,
        activo: false,
        subscriptionStatus: "activa",
        plan: "nextcob",
        reveniuSubscriptionId: FAKE_GRANDF_SUB_ID,
        reveniuMontoSync: SENTINEL,
      } as any)
      .returning();
    createdUserIds.push(gUser.id);

    const modelTotal = computePricing("nextcob", normalizarPacks(null)).totalMensual;
    check(`pre-condición: SENTINEL (${SENTINEL}) ≠ modelo (${modelTotal})`, SENTINEL !== modelTotal);

    const warnedIds: string[] = [];
    const sweepLog = {
      info: () => {},
      warn: (obj: { userId?: string }) => { if (obj.userId) warnedIds.push(obj.userId); },
      error: () => {},
    };

    const stubCallsBefore = amountCalls.length;
    let sweepThrew = false;
    try {
      // Scope the sweep to just the grandfathering fixture so other real users
      // in the dev DB are not touched (safe and repeatable).
      await sincronizarMontosReveniu(sweepLog, { userIds: [gUser.id] });
    } catch (err) {
      sweepThrew = true;
      console.error("  sweep lanzó excepción:", err);
    }
    check("sweep no lanzó excepción", !sweepThrew);

    // Stub must NOT have received a call for the grandfathered user's sub ID.
    const grandfCalls = amountCalls.slice(stubCallsBefore).filter(
      (c) => c.subscriptionId === FAKE_GRANDF_SUB_ID,
    );
    check("sweep NO llamó setReveniuAmount para usuario grandfathered", grandfCalls.length === 0, grandfCalls);

    // DB: SENTINEL remains unchanged.
    const [gAfter] = await db
      .select({ reveniuMontoSync: usersTable.reveniuMontoSync })
      .from(usersTable)
      .where(eq(usersTable.id, gUser.id));
    check(
      `reveniuMontoSync sigue siendo ${SENTINEL} (no fue pisado por el sweep)`,
      gAfter?.reveniuMontoSync === SENTINEL,
      gAfter?.reveniuMontoSync,
    );

    // Sweep must emit a warn logging the grandfathered user.
    check("sweep emitió warn para el usuario grandfathered", warnedIds.includes(gUser.id), warnedIds);

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);

  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    // Delete any stray invitations created during the sin_cupo test (the
    // endpoint rejects due to sin_cupo, so normally none are created, but
    // clean up defensively in case a retry succeeded).
    try {
      await db
        .delete(invitacionesTable)
        .where(eq(invitacionesTable.email, "e2e-packs-invite-test@test.invalid"));
    } catch { /* ignore */ }

    if (createdUserIds.length) {
      // Must clear organizationId FK before deleting users.
      await db
        .update(usersTable)
        .set({ organizationId: null } as any)
        .where(inArray(usersTable.id, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
      console.log(`Cleanup: removed users [${createdUserIds.join(", ")}]`);
    }
    if (createdOrgIds.length) {
      await db
        .delete(organizacionesTable)
        .where(inArray(organizacionesTable.id, createdOrgIds));
      console.log(`Cleanup: removed orgs [${createdOrgIds.join(", ")}]`);
    }

    server.close();
    stub.close();
  }
}

main()
  .catch((err) => { failures++; console.error("FATAL:", err); })
  .finally(() => setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300).unref?.());
