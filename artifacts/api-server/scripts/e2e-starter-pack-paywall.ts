/**
 * E2E paywall test: verifica que una cuenta en plan Starter no puede comprar
 * packs de usuarios adicionales.
 *
 * Monta subscriptionRouter en un servidor Express local con auth simulada.
 * No se realizan llamadas reales a Reveniu (el gate se dispara antes de
 * cualquier llamada de facturación).
 *
 * Cubre:
 *  - POST /subscription/packs en cualquier pack → 403 con code "plan_upgrade"
 *  - GET /subscription/status después del intento rechazado → packs[] vacío
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/e2e-starter-pack-paywall.ts
 */
import http from "http";
import type { AddressInfo } from "net";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  // ── 1. Set env vars BEFORE dynamic imports ────────────────────────────────
  // Reveniu is not used in this test (the Starter gate fires first), but the
  // module still checks for the env var when it loads, so provide a stub value.
  if (!process.env.REVENIU_SECRET_KEY) process.env.REVENIU_SECRET_KEY = "stub-secret-e2e";

  // ── 2. Dynamic imports ────────────────────────────────────────────────────
  const { db, usersTable, organizacionesTable } = await import("@workspace/db");
  const { eq, inArray } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const { subscriptionRouter } = await import("../src/routes/subscription");

  // ── 3. Local Express server with mocked auth ──────────────────────────────
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
    try {
      json = await res.json();
    } catch { /* empty */ }
    return { status: res.status, json };
  }

  // ── 4. Fixtures ───────────────────────────────────────────────────────────
  const ts = Date.now();
  const createdUserIds: string[] = [];
  const createdOrgIds: number[] = [];

  try {
    console.log("== Setup: crear usuario Starter con suscripción activa ==");

    // Owner con plan Starter activo (subscriptionStatus=activa, plan=starter).
    // No hay reveniuSubscriptionId porque el gate plan_upgrade se dispara ANTES
    // de cualquier consulta a Reveniu.
    const [owner] = await db
      .insert(usersTable)
      .values({
        email: `e2e-starter-paywall-${ts}@test.invalid`,
        activo: true,
        orgRole: "admin_org",
        subscriptionStatus: "activa",
        plan: "starter",
        packsUsuarios: {},
      } as any)
      .returning();
    createdUserIds.push(owner.id);

    const [org] = await db
      .insert(organizacionesTable)
      .values({ ownerId: owner.id, nombre: `e2e-starter-paywall-org-${ts}` } as any)
      .returning();
    createdOrgIds.push(org.id);

    await db
      .update(usersTable)
      .set({ organizationId: org.id } as any)
      .where(eq(usersTable.id, owner.id));

    // Reload owner with organizationId set.
    const [ownerFull] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, owner.id));
    currentUser = ownerFull;

    console.log(`  (fixture: owner=${owner.id}, org=${org.id}, plan=starter)`);

    // ── Test 1: Intentar agregar cualquier pack → 403 plan_upgrade ──────────
    console.log("== POST /subscription/packs → debe ser 403 plan_upgrade ==");
    for (const pack of ["individual", "pack5", "pack10", "pack20"] as const) {
      const r = await call("POST", "/subscription/packs", { pack, accion: "agregar" });
      check(
        `${pack}: status 403`,
        r.status === 403,
        { status: r.status, json: r.json },
      );
      check(
        `${pack}: code = "plan_upgrade"`,
        r.json?.code === "plan_upgrade",
        r.json,
      );
    }

    // ── Test 2: GET /subscription/status → packs[] vacío ───────────────────
    console.log("== GET /subscription/status → packs[] debe estar vacío ==");
    const statusRes = await call("GET", "/subscription/status");
    check("status 200", statusRes.status === 200, statusRes.json);
    const packs: unknown[] = statusRes.json?.packs ?? null;
    check(
      "packs es un array vacío (ningún pack acumulado tras los intentos rechazados)",
      Array.isArray(packs) && packs.length === 0,
      packs,
    );

    // ── Test 3: Intentar quitar un pack también es 403 (no hay nada que quitar,
    //    pero el gate debe dispararse antes de verificar stock) ───────────────
    console.log("== POST /subscription/packs (quitar) → también 403 plan_upgrade ==");
    const rRemove = await call("POST", "/subscription/packs", {
      pack: "pack5",
      accion: "quitar",
    });
    check(
      "quitar pack5: status 403",
      rRemove.status === 403,
      { status: rRemove.status, json: rRemove.json },
    );
    check(
      "quitar pack5: code = \"plan_upgrade\"",
      rRemove.json?.code === "plan_upgrade",
      rRemove.json,
    );

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    if (createdUserIds.length) {
      await db
        .update(usersTable)
        .set({ organizationId: null } as any)
        .where(inArray(usersTable.id, createdUserIds));
      await db
        .delete(usersTable)
        .where(inArray(usersTable.id, createdUserIds));
      console.log(`Cleanup: removed users [${createdUserIds.join(", ")}]`);
    }
    if (createdOrgIds.length) {
      await db
        .delete(organizacionesTable)
        .where(inArray(organizacionesTable.id, createdOrgIds));
      console.log(`Cleanup: removed orgs [${createdOrgIds.join(", ")}]`);
    }

    server.close();
  }
}

main()
  .catch((err) => {
    failures++;
    console.error("FATAL:", err);
  })
  .finally(() =>
    setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300).unref?.(),
  );
