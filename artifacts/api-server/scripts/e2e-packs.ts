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
  const NEXTCOB_TOTAL = 29_738;
  const PACK10_TOTAL = 83_288;
  const TOTAL_WITH_PACK10 = NEXTCOB_TOTAL + PACK10_TOTAL; // 113_026
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
