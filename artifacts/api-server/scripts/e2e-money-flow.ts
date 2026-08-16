/**
 * E2E money-flow test: crear cobro → descuento → abonos → estado → informes/rendimiento.
 *
 * Runs against the local dev API server using the demo account, verifies that
 * the numbers coming back from /cobros and /organization/rendimiento match the
 * expected accounting (montoACobrar, saldo, pagadoEn, informes aggregation),
 * then cleans up the created rows directly in the DB.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/e2e-money-flow.ts
 */
import { db, cobrosTable, pagosParciales, cobroDescuentosTable, saludCarteraSnapshotsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:80/api";
const DEMO_EMAIL = "anibal.gutierrezbasoalto@gmail.com";
const DEMO_PASSWORD = "Demo2024NextCob!";

let cookie = "";
let failures = 0;
const createdCobroIds: number[] = [];

// Salud-cartera historial test state — used by cleanup() for safe restoration.
let snapshotToRestore: (typeof saludCarteraSnapshotsTable.$inferInsert) | null = null;
let fixtureSnapshotInserted = false;

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
  console.log("== Informes-style aggregation (cliente) sobre los cobros E2E ==");
  const list = (await api("GET", "/cobros")).json as any[];
  const mine = list.filter((x) => createdCobroIds.includes(x.id));
  check("los 4 cobros E2E aparecen en la lista", mine.length === 4, mine.length);
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

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
}

async function cleanup() {
  if (createdCobroIds.length) {
    await db.delete(pagosParciales).where(inArray(pagosParciales.cobroId, createdCobroIds));
    await db.delete(cobroDescuentosTable).where(inArray(cobroDescuentosTable.cobroId, createdCobroIds));
    await db.delete(cobrosTable).where(inArray(cobrosTable.id, createdCobroIds));
    console.log(`Cleanup: removed cobros ${createdCobroIds.join(", ")}`);
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
}

main()
  .catch((err) => { failures++; console.error("FATAL:", err); })
  .finally(async () => {
    try { await cleanup(); } catch (e) { console.error("Cleanup failed:", e); }
    process.exit(failures === 0 ? 0 : 1);
  });
