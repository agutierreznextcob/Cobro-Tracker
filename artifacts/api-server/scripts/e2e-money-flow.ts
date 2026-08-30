/**
 * E2E money-flow test: crear cobro → descuento → abonos → estado → informes/rendimiento.
 *
 * Runs against the local dev API server using the demo account, verifies that
 * the numbers coming back from /cobros and /organization/rendimiento match the
 * expected accounting (montoACobrar, saldo, pagadoEn, informes aggregation),
 * then cleans up the created rows directly in the DB.
 *
 * Also verifies the salud-cartera daily sweep is resilient: it must not skip
 * users on error, and it must handle users with 0 active cobros cleanly.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/e2e-money-flow.ts
 */
import { db, cobrosTable, pagosParciales, cobroDescuentosTable, saludCarteraSnapshotsTable, usersTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { generarSnapshotsSaludCartera, calcularBloquesUsuario, hoySantiagoStr } from "../src/lib/salud-cartera";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:80/api";
const DEMO_EMAIL = "anibal.gutierrezbasoalto@gmail.com";
const DEMO_PASSWORD = "Demo2024NextCob!";

let cookie = "";
let failures = 0;
const createdCobroIds: number[] = [];

// Salud-cartera historial test state — used by cleanup() for safe restoration.
let snapshotToRestore: (typeof saludCarteraSnapshotsTable.$inferInsert) | null = null;
let fixtureSnapshotInserted = false;

// Sweep resilience test state — used by cleanup() to remove test artifacts.
// sweepDemoSnapshotId: ID of the snapshot the demo-only sweep created; must be
// explicitly deleted before restoring snapshotToRestore (else onConflictDoNothing
// would silently leave the sweep-generated row with test-cobro numbers).
let sweepDemoSnapshotId: number | null = null;
let sweepFaultyUserId: string | null = null;
let sweepFaultyUserCreated = false; // only delete in cleanup if we inserted it
let sweepGoodUserId: string | null = null;
let sweepGoodUserCreated = false;   // only delete in cleanup if we inserted it

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

async function main() {
  console.log("== Login demo ==");
  const login = await api("POST", "/auth/login", { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  check("login 200", login.status === 200, login);
  if (login.status !== 200) throw new Error("cannot continue without login");
  const me = await api("GET", "/auth/user");
  const myId: string = me.json?.user?.id;
  check("auth/user returns user", !!myId);
  const dashboardBefore = await api("GET", "/dashboard/metrics?periodo=total");
  check("dashboard metrics baseline 200", dashboardBefore.status === 200, dashboardBefore);

  // ---- Baseline rendimiento (may be 403 if demo is not admin/supervisor) ----
  const rendBefore = await api("GET", "/organization/rendimiento");
  const rendAvailable = rendBefore.status === 200;
  console.log(`rendimiento available: ${rendAvailable} (status ${rendBefore.status})`);
  const myRendBefore = rendAvailable
    ? (rendBefore.json as any[]).find((r) => r.usuarioId === myId)
    : null;

  // =========================================================================
  console.log("== Cobro A: descuento + abonos parciales hasta pagado ==");
  const a = await api("POST", "/cobros", {
    monto: 100000,
    descripcion: "E2E test cobro A (descuento + abonos)",
    referencia: "E2E-A",
  });
  check("crear cobro A 201", a.status === 201, a);
  const aId = a.json.id as number;
  createdCobroIds.push(aId);
  check("A estado inicial pendiente", a.json.estado === "pendiente", a.json.estado);

  const desc = await api("POST", `/cobros/${aId}/descuentos`, {
    tipo: "fijo", valor: 10000, motivo: "E2E prueba descuento",
  });
  check("descuento aplicado", desc.status === 200 || desc.status === 201, desc);

  let aGet = (await api("GET", `/cobros/${aId}`)).json;
  check("A montoDescuento=10000", aGet.montoDescuento === 10000, aGet.montoDescuento);
  check("A montoACobrar=90000", aGet.montoACobrar === 90000, aGet.montoACobrar);
  check("A saldo=90000", aGet.saldo === 90000, aGet.saldo);

  const ab1 = await api("POST", `/cobros/${aId}/abonos`, { monto: 40000, metodo: "manual", notas: "E2E abono 1" });
  check("abono1 40000 creado", ab1.status === 201, ab1);
  aGet = (await api("GET", `/cobros/${aId}`)).json;
  check("A estado parcial tras abono1", aGet.estado === "parcial", aGet.estado);
  check("A saldo=50000 tras abono1", aGet.saldo === 50000, aGet.saldo);
  check("A pagadoEn aún null", !aGet.pagadoEn, aGet.pagadoEn);

  // Money-safety: cannot reset a cobro with abonos back to pendiente.
  const patchPend = await api("PATCH", `/cobros/${aId}`, { estado: "pendiente" });
  check("PATCH estado→pendiente bloqueado (400)", patchPend.status === 400, patchPend);

  const ab2 = await api("POST", `/cobros/${aId}/abonos`, { monto: 50000, metodo: "manual", notas: "E2E abono 2" });
  check("abono2 50000 creado", ab2.status === 201, ab2);
  aGet = (await api("GET", `/cobros/${aId}`)).json;
  check("A estado pagado tras abono2", aGet.estado === "pagado", aGet.estado);
  check("A saldo=0", aGet.saldo === 0, aGet.saldo);
  check("A pagadoEn seteado", !!aGet.pagadoEn, aGet.pagadoEn);

  // =========================================================================
  console.log("== Cobro B: IVA 19% (factura_afecta) ==");
  const b = await api("POST", "/cobros", {
    monto: 100000,
    descripcion: "E2E test cobro B (IVA)",
    referencia: "E2E-B",
    tipoDocumento: "factura_afecta",
    incluyeIva: true,
  });
  check("crear cobro B 201", b.status === 201, b);
  const bId = b.json.id as number;
  createdCobroIds.push(bId);
  check("B monto cobrado 119000 (neto+IVA)", b.json.monto === 119000, b.json.monto);

  // =========================================================================
  console.log("== Cobro C: parcial que queda parcial (para informes) ==");
  const c = await api("POST", "/cobros", {
    monto: 60000, descripcion: "E2E test cobro C (parcial)", referencia: "E2E-C",
  });
  check("crear cobro C 201", c.status === 201, c);
  const cId = c.json.id as number;
  createdCobroIds.push(cId);
  const abC = await api("POST", `/cobros/${cId}/abonos`, { monto: 25000, metodo: "manual", notas: "E2E abono C" });
  check("abono C 25000 creado", abC.status === 201, abC);
  const cGet = (await api("GET", `/cobros/${cId}`)).json;
  check("C estado parcial", cGet.estado === "parcial", cGet.estado);
  check("C saldo=35000", cGet.saldo === 35000, cGet.saldo);

  // =========================================================================
  console.log("== Cobro D: descuento que hace que abonos cubran el total ==");
  const d = await api("POST", "/cobros", {
    monto: 50000, descripcion: "E2E test cobro D (descuento cierra)", referencia: "E2E-D",
  });
  const dId = d.json.id as number;
  createdCobroIds.push(dId);
  await api("POST", `/cobros/${dId}/abonos`, { monto: 40000, metodo: "manual", notas: "E2E abono D" });
  const descD = await api("POST", `/cobros/${dId}/descuentos`, {
    tipo: "fijo", valor: 10000, motivo: "E2E descuento cierra cobro",
  });
  check("descuento D aplicado", descD.status === 200 || descD.status === 201, descD);
  const dGet = (await api("GET", `/cobros/${dId}`)).json;
  check("D estado pagado (descuento cubre saldo)", dGet.estado === "pagado", dGet.estado);
  check("D pagadoEn seteado", !!dGet.pagadoEn, dGet.pagadoEn);
  check("D montoACobrar=40000", dGet.montoACobrar === 40000, dGet.montoACobrar);

  // =========================================================================
  console.log("== Cobro E: fallido no cuenta como pendiente ==");
  const e = await api("POST", "/cobros", {
    monto: 77000,
    descripcion: "E2E test cobro E (fallido terminal)",
    referencia: "E2E-E",
  });
  check("crear cobro E 201", e.status === 201, e);
  const eId = e.json.id as number;
  createdCobroIds.push(eId);
  const eFailed = await api("PATCH", `/cobros/${eId}`, { estado: "fallido" });
  check("E estado fallido", eFailed.status === 200 && eFailed.json?.estado === "fallido", eFailed);

  // =========================================================================
  console.log("== Informes-style aggregation (cliente) sobre los cobros E2E ==");
  const list = (await api("GET", "/cobros")).json as any[];
  const mine = list.filter((x) => createdCobroIds.includes(x.id));
  check("los 5 cobros E2E aparecen en la lista", mine.length === 5, mine.length);
  const montoCobrar = (x: any) => x.montoACobrar ?? x.monto - (x.montoDescuento ?? 0);
  const pagados = mine.filter((x) => x.estado === "pagado");
  const abonadoParcial = mine
    .filter((x) => x.estado === "parcial")
    .reduce((s, x) => s + Math.max(montoCobrar(x) - (x.saldo ?? 0), 0), 0);
  const totalRecaudado = pagados.reduce((s, x) => s + montoCobrar(x), 0) + abonadoParcial;
  // Expected: A pagado 90000 + D pagado 40000 + C parcial abonado 25000 = 155000
  check("totalRecaudado E2E = 155000", totalRecaudado === 155000, totalRecaudado);
  const totalDescuento = mine.reduce((s, x) => s + (x.montoDescuento ?? 0), 0);
  check("totalDescuento E2E = 20000", totalDescuento === 20000, totalDescuento);
  check("todos los pagados tienen pagadoEn", pagados.every((x) => !!x.pagadoEn));

  console.log("== Dashboard operativo basado en eventos de pago ==");
  const dashboardAfter = await api("GET", "/dashboard/metrics?periodo=total");
  check("dashboard metrics 200", dashboardAfter.status === 200, dashboardAfter);
  check(
    "montoRecaudado dashboard delta = 155000",
    Number(dashboardAfter.json?.montoRecaudado ?? 0) - Number(dashboardBefore.json?.montoRecaudado ?? 0) === 155000,
    { before: dashboardBefore.json, after: dashboardAfter.json },
  );
  check(
    "transaccionesPagadas dashboard delta = 4",
    Number(dashboardAfter.json?.transaccionesPagadas ?? 0) - Number(dashboardBefore.json?.transaccionesPagadas ?? 0) === 4,
    { before: dashboardBefore.json, after: dashboardAfter.json },
  );
  check(
    "pendientesMonto dashboard delta = 154000 (excluye fallido)",
    Number(dashboardAfter.json?.pendientesMonto ?? 0) - Number(dashboardBefore.json?.pendientesMonto ?? 0) === 154000,
    { before: dashboardBefore.json, after: dashboardAfter.json },
  );
  check(
    "pendientesCantidad dashboard delta = 2 (excluye fallido)",
    Number(dashboardAfter.json?.pendientesCantidad ?? 0) - Number(dashboardBefore.json?.pendientesCantidad ?? 0) === 2,
    { before: dashboardBefore.json, after: dashboardAfter.json },
  );

  // =========================================================================
  if (rendAvailable) {
    console.log("== Rendimiento (servidor) delta ==");
    const rendAfter = await api("GET", "/organization/rendimiento");
    const myRendAfter = (rendAfter.json as any[]).find((r) => r.usuarioId === myId);
    const recBefore = Number(myRendBefore?.montoRecaudado ?? 0);
    const recAfter = Number(myRendAfter?.montoRecaudado ?? 0);
    // A(90000) + D(40000) + C abono(25000) = 155000
    check("rendimiento montoRecaudado delta = 155000", recAfter - recBefore === 155000, { recBefore, recAfter });
    const penBefore = Number(myRendBefore?.montoPendiente ?? 0);
    const penAfter = Number(myRendAfter?.montoPendiente ?? 0);
    // Pending delta: B(119000) + C saldo(35000) = 154000
    check("rendimiento montoPendiente delta = 154000", penAfter - penBefore === 154000, { penBefore, penAfter });
  } else {
    console.log("(rendimiento no disponible para demo — omitido)");
  }

  // =========================================================================
  // Salud-cartera historial: last point must always be today (America/Santiago)
  // =========================================================================
  console.log("== Salud-cartera historial: último punto = hoy ==");
  const hoyStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

  // --- Ensure a snapshot for today exists (deterministic fixture) ---
  const existingSnap = await db
    .select()
    .from(saludCarteraSnapshotsTable)
    .where(
      and(
        eq(saludCarteraSnapshotsTable.usuarioId, myId),
        eq(saludCarteraSnapshotsTable.fecha, hoyStr),
      ),
    )
    .limit(1);

  if (existingSnap.length === 0) {
    // Insert a zero-value fixture so the "with snapshot" case is deterministic.
    await db.insert(saludCarteraSnapshotsTable).values({
      usuarioId: myId,
      fecha: hoyStr,
      sanaMonto: "0",
      sanaCantidad: 0,
      riesgoMonto: "0",
      riesgoCantidad: 0,
      criticaMonto: "0",
      criticaCantidad: 0,
      criticaSumaMora: 0,
    }).onConflictDoNothing();
    fixtureSnapshotInserted = true;
    console.log("  (fixture snapshot insertado para test)");
  } else {
    console.log(`  (snapshot real encontrado: id=${existingSnap[0].id})`);
  }

  // --- Case 1: snapshot exists → historial must end on today ---
  const hist1 = await api("GET", "/dashboard/salud-cartera/historial");
  check("historial 200", hist1.status === 200, hist1.status);
  const puntos1: any[] = hist1.json?.puntos ?? [];
  check("historial tiene al menos un punto", puntos1.length > 0, puntos1.length);
  const ultimo1 = puntos1[puntos1.length - 1];
  check(
    `historial[con-snapshot]: último punto fecha = hoy (${hoyStr})`,
    ultimo1?.fecha === hoyStr,
    { ultimo: ultimo1?.fecha, hoy: hoyStr },
  );

  // --- Case 2: delete today's snapshot, live-fallback must still return today ---
  // Save the full row so cleanup() can restore it regardless of subsequent failures.
  const [deletedSnap] = await db
    .delete(saludCarteraSnapshotsTable)
    .where(
      and(
        eq(saludCarteraSnapshotsTable.usuarioId, myId),
        eq(saludCarteraSnapshotsTable.fecha, hoyStr),
      ),
    )
    .returning();
  if (deletedSnap) {
    // Keep for restoration in cleanup(); omit auto-generated fields.
    snapshotToRestore = {
      usuarioId: deletedSnap.usuarioId,
      fecha: deletedSnap.fecha,
      sanaMonto: deletedSnap.sanaMonto,
      sanaCantidad: deletedSnap.sanaCantidad,
      riesgoMonto: deletedSnap.riesgoMonto,
      riesgoCantidad: deletedSnap.riesgoCantidad,
      criticaMonto: deletedSnap.criticaMonto,
      criticaCantidad: deletedSnap.criticaCantidad,
      criticaSumaMora: deletedSnap.criticaSumaMora,
    };
  }
  console.log(`  (snapshot del día borrado para test: ${deletedSnap ? `sí (id=${deletedSnap.id})` : "no había"})`);

  const hist2 = await api("GET", "/dashboard/salud-cartera/historial");
  check("historial 200 (sin snapshot)", hist2.status === 200, hist2.status);
  const puntos2: any[] = hist2.json?.puntos ?? [];
  check("historial tiene al menos un punto (sin snapshot)", puntos2.length > 0, puntos2.length);
  const ultimo2 = puntos2[puntos2.length - 1];
  check(
    `historial[sin-snapshot]: último punto fecha = hoy (${hoyStr})`,
    ultimo2?.fecha === hoyStr,
    { ultimo: ultimo2?.fecha, hoy: hoyStr },
  );

  // =========================================================================
  // Sweep resilience: invokes generarSnapshotsSaludCartera directly to verify:
  //   (a) the sweep creates a snapshot for the demo user today,
  //   (b) the sweep survives a simulated per-user failure (fault injection),
  //   (c) a user after the failing one still receives its snapshot,
  //   (d) a user with 0 active cobros produces a zero-value snapshot cleanly.
  //
  // All tests use isolated fixture users and scoped userIds so no E2E cobros
  // contaminate snapshots, and no demo production data is touched.
  // =========================================================================
  console.log("== Sweep resilience: barrido salud-cartera ==");
  const sweepHoy = hoySantiagoStr();
  const silentLog = { info: (_o: object, _m: string) => {}, error: (_o: object, _m: string) => {} };

  // --- Step 1: Verify the sweep creates a snapshot for demo user ---
  // Demo's today snapshot was already deleted in the historial test above, so
  // the sweep will create a fresh one.  We pass users:[{id:myId}] (not userIds)
  // so the sweep iterates exactly the one user without issuing a full-table query.
  let demoSweepThrew = false;
  try {
    await generarSnapshotsSaludCartera(silentLog, { users: [{ id: myId }] });
  } catch {
    demoSweepThrew = true;
  }
  check("sweep no lanzó excepción fatal (demo)", !demoSweepThrew);

  const demoSnap = await db
    .select()
    .from(saludCarteraSnapshotsTable)
    .where(and(
      eq(saludCarteraSnapshotsTable.usuarioId, myId),
      eq(saludCarteraSnapshotsTable.fecha, sweepHoy),
    ))
    .limit(1);
  check(`sweep crea snapshot para demo user (fecha=${sweepHoy})`, demoSnap.length === 1, demoSnap.length);
  // Track so cleanup can explicitly delete it before restoring snapshotToRestore.
  if (demoSnap.length > 0) sweepDemoSnapshotId = demoSnap[0].id;

  // --- Step 2: Create two isolated test users ---
  // sweepFaultyUser: will have calcularFn throw deterministically.
  // sweepGoodUser:   zero cobros; should succeed cleanly and come after the fault.
  // Only delete users in cleanup if we created them here (idempotent re-runs).
  const FAULTY_EMAIL = "e2e-sweep-faulty@test.invalid";
  const GOOD_EMAIL   = "e2e-sweep-zero-cobros@test.invalid";

  async function upsertTestUser(email: string): Promise<{ id: string; created: boolean }> {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing.length > 0) return { id: existing[0].id, created: false };
    const [row] = await db
      .insert(usersTable)
      .values({ email, activo: true })
      .returning({ id: usersTable.id });
    return { id: row.id, created: true };
  }

  const faultyResult = await upsertTestUser(FAULTY_EMAIL);
  sweepFaultyUserId      = faultyResult.id;
  sweepFaultyUserCreated = faultyResult.created;

  const goodResult = await upsertTestUser(GOOD_EMAIL);
  sweepGoodUserId      = goodResult.id;
  sweepGoodUserCreated = goodResult.created;

  console.log(`  (faulty user: ${sweepFaultyUserId} created=${sweepFaultyUserCreated}, good user: ${sweepGoodUserId} created=${sweepGoodUserCreated})`);

  // Ensure clean slate for today's snapshots for both test users.
  await db.delete(saludCarteraSnapshotsTable).where(
    and(
      eq(saludCarteraSnapshotsTable.usuarioId, sweepFaultyUserId),
      eq(saludCarteraSnapshotsTable.fecha, sweepHoy),
    ),
  );
  await db.delete(saludCarteraSnapshotsTable).where(
    and(
      eq(saludCarteraSnapshotsTable.usuarioId, sweepGoodUserId),
      eq(saludCarteraSnapshotsTable.fecha, sweepHoy),
    ),
  );

  // --- Step 3: Fault injection sweep ---
  // calcularFn throws deterministically for faultyUser; returns zeros for goodUser.
  // The per-user try/catch in the production sweep must catch the error, log it,
  // and continue to process goodUser — which must receive its snapshot.
  const faultErrors: Array<{ userId: string }> = [];
  const faultLog = {
    info: (_o: object, _m: string) => {},
    error: (obj: { userId?: string }, _m: string) => {
      faultErrors.push({ userId: obj.userId ?? "unknown" });
    },
  };

  // `users` is provided as an explicit ordered array — no DB query is issued —
  // so faultyUser is guaranteed to be processed BEFORE goodUser regardless of
  // how Postgres would order an IN(...) query.  This makes it contractually
  // provable that the sweep continued past the failure, not that it happened to
  // process goodUser first by chance.
  //
  // calcularFn only overrides the faulty user; for goodUser it delegates to the
  // real calcularBloquesUsuario so the zero-cobros path exercises the actual
  // production code (not an injected zero stub).
  const capturedFaultyId = sweepFaultyUserId;
  let faultSweepThrew = false;
  try {
    await generarSnapshotsSaludCartera(faultLog, {
      users: [{ id: sweepFaultyUserId }, { id: sweepGoodUserId }],
      calcularFn: async (userId, fecha) => {
        if (userId === capturedFaultyId) {
          throw new Error("E2E simulated calcular failure");
        }
        // Real calculation for the zero-cobros user — exercises the production
        // code path for a user with no open cobros.
        return calcularBloquesUsuario(userId, fecha);
      },
    });
  } catch {
    faultSweepThrew = true;
  }
  check("sweep no lanzó excepción fatal (fault injection)", !faultSweepThrew);
  check(
    "sweep registró error para usuario con falla simulada",
    faultErrors.some((e) => e.userId === sweepFaultyUserId),
    faultErrors,
  );

  // goodUser comes after faultyUser in the loop; its snapshot proves the sweep
  // did not abort when faultyUser threw.
  const goodSnap = await db
    .select()
    .from(saludCarteraSnapshotsTable)
    .where(and(
      eq(saludCarteraSnapshotsTable.usuarioId, sweepGoodUserId),
      eq(saludCarteraSnapshotsTable.fecha, sweepHoy),
    ))
    .limit(1);
  check("sweep continuó tras la falla (goodUser tiene snapshot)", goodSnap.length === 1, goodSnap.length);

  const faultySnap = await db
    .select()
    .from(saludCarteraSnapshotsTable)
    .where(and(
      eq(saludCarteraSnapshotsTable.usuarioId, sweepFaultyUserId),
      eq(saludCarteraSnapshotsTable.fecha, sweepHoy),
    ))
    .limit(1);
  check("usuario con falla NO tiene snapshot (error fue capturado, no ignorado)", faultySnap.length === 0, faultySnap.length);

  // Verify the zero-cobros snapshot values are all zeros (edge case handled cleanly).
  if (goodSnap.length === 1) {
    const s = goodSnap[0];
    check(
      "snapshot de usuario con 0 cobros tiene valores cero",
      Number(s.sanaMonto) === 0 &&
        s.sanaCantidad === 0 &&
        Number(s.riesgoMonto) === 0 &&
        s.riesgoCantidad === 0 &&
        Number(s.criticaMonto) === 0 &&
        s.criticaCantidad === 0,
      { sanaMonto: s.sanaMonto, riesgoMonto: s.riesgoMonto, criticaMonto: s.criticaMonto },
    );
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
}

async function cleanup() {
  if (createdCobroIds.length) {
    await db.delete(pagosParciales).where(inArray(pagosParciales.cobroId, createdCobroIds));
    await db.delete(cobroDescuentosTable).where(inArray(cobroDescuentosTable.cobroId, createdCobroIds));
    await db.delete(cobrosTable).where(inArray(cobrosTable.id, createdCobroIds));
    console.log(`Cleanup: removed cobros ${createdCobroIds.join(", ")}`);
  }

  // The sweep resilience test runs a scoped sweep for the demo user while the
  // E2E cobros still exist, creating a snapshot with test-inflated numbers.
  // Delete that sweep-generated snapshot first so the onConflictDoNothing
  // restore below can write the original row back without a conflict.
  if (sweepDemoSnapshotId !== null) {
    await db
      .delete(saludCarteraSnapshotsTable)
      .where(eq(saludCarteraSnapshotsTable.id, sweepDemoSnapshotId));
    console.log(`Cleanup: deleted sweep-generated demo snapshot id=${sweepDemoSnapshotId}`);
  }

  // Restore the snapshot we deleted during the historial test so we leave the
  // DB in its original state regardless of how the test ended (pass or fail).
  // If we only inserted a fixture (no pre-existing snapshot), nothing to restore
  // because the delete already removed it; the sweep will recreate it normally.
  if (snapshotToRestore && !fixtureSnapshotInserted) {
    await db
      .insert(saludCarteraSnapshotsTable)
      .values(snapshotToRestore)
      .onConflictDoNothing();
    console.log(`Cleanup: restored snapshot for ${snapshotToRestore.fecha}`);
  }

  // Remove isolated test users and their snapshots — but only if we inserted
  // them in this run.  If the user row pre-existed (a leftover from a previous
  // interrupted run), we still delete their today-snapshots (safe: they're test
  // artifacts) but leave the user row itself alone to avoid clobbering data from
  // whatever created it.
  for (const [uid, created] of [
    [sweepFaultyUserId, sweepFaultyUserCreated] as const,
    [sweepGoodUserId,   sweepGoodUserCreated]   as const,
  ]) {
    if (!uid) continue;
    await db
      .delete(saludCarteraSnapshotsTable)
      .where(eq(saludCarteraSnapshotsTable.usuarioId, uid));
    if (created) {
      await db.delete(usersTable).where(eq(usersTable.id, uid));
      console.log(`Cleanup: removed sweep test user ${uid}`);
    } else {
      console.log(`Cleanup: cleared snapshots for pre-existing test user ${uid} (user row preserved)`);
    }
  }
}

main()
  .catch((err) => { failures++; console.error("FATAL:", err); })
  .finally(async () => {
    try { await cleanup(); } catch (e) { console.error("Cleanup failed:", e); }
    process.exit(failures === 0 ? 0 : 1);
  });
