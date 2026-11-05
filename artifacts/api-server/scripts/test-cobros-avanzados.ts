/**
 * DB + router regression for advanced cobros.
 *
 * This starts the real cobrosRouter on an in-process Express server, but points
 * its Pool at an empty, temporary PostgreSQL schema. It never authenticates a
 * real account, creates provider credentials, or asks the delivery worker to
 * process an outbox row. All contacts are .invalid and all requests specify
 * canalesIniciales: [].
 *
 * Run: pnpm --filter @workspace/api-server run test-cobros-avanzados
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// pg is deliberately resolved from @workspace/db, which owns that dependency.
// The API package itself does not need pg at runtime outside this test harness.
const requireFromDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = requireFromDb("pg");

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function isolatedDatabaseUrl(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);
  // libpq applies this to every Pool connection, including connections opened
  // inside db.transaction(). Keeping public second makes enum types resolvable.
  url.searchParams.set("options", `-c search_path=${schema},public`);
  return url.toString();
}

async function main() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL is required for this DB integration regression.");

  const schema = `e2e_cobros_avanzados_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const adminClient = new pg.Client({ connectionString: originalDatabaseUrl });
  let pool: { end: () => Promise<void> } | null = null;
  let server: http.Server | null = null;

  try {
    await adminClient.connect();
    await adminClient.query(`create schema "${schema}"`);
    // Only the tables reached by this no-send path are cloned. Local sequences
    // prevent fixtures from advancing any sequence in the application schema.
    for (const table of [
      "users",
      "organizaciones",
      "clientes",
      "cobros",
      "cobros_recurrentes",
      "cobro_entregas_iniciales",
      "app_config",
      "flow_credenciales",
      "mp_credenciales",
      "preferencias",
    ]) {
      await adminClient.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
    }
    for (const table of ["organizaciones", "clientes", "cobros", "cobros_recurrentes", "cobro_entregas_iniciales"]) {
      const sequence = `${table}_e2e_id_seq`;
      await adminClient.query(`create sequence "${schema}"."${sequence}"`);
      await adminClient.query(`alter table "${schema}"."${table}" alter column id set default nextval('"${schema}"."${sequence}"')`);
      await adminClient.query(`alter sequence "${schema}"."${sequence}" owned by "${schema}"."${table}".id`);
    }

    // Must be set before importing @workspace/db; that module creates its Pool
    // at import time. No query in this script can resolve to public afterward.
    process.env.DATABASE_URL = isolatedDatabaseUrl(originalDatabaseUrl, schema);

    const {
      appConfigTable,
      clientesTable,
      cobroEntregasInicialesTable,
      cobrosRecurrentesTable,
      cobrosTable,
      db,
      organizacionesTable,
      pool: appPool,
      usersTable,
    } = await import("@workspace/db");
    pool = appPool;
    const { and, count, eq, inArray } = await import("drizzle-orm");
    const cobrosRouter = (await import("../src/routes/cobros")).default;
    const { fechaCicloAnclada, procesarCobrosRecurrentes } = await import("../src/lib/cobros-recurrentes");
    const { fechaHoySantiago } = await import("../src/lib/recordatorios");
    const express = (await import("express")).default;

    const silentLog = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => silentLog,
    };
    type Actor = { id: string; firstName: string | null; lastName: string | null; email: string | null };
    let currentUser: Actor | null = null;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = currentUser;
      (req as any).isAuthenticated = () => currentUser !== null;
      (req as any).log = silentLog;
      next();
    });
    app.use("/api", cobrosRouter);
    // Preserve the production ordering: feature routers must not intercept
    // unrelated subscription endpoints for Starter users.
    app.use("/api", (await import("../src/routes/workflows")).default);
    app.use("/api", (await import("../src/routes/ai")).default);
    app.use("/api", (await import("../src/routes/subscription")).subscriptionRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    async function api(actor: Actor, method: string, path: string, body?: unknown) {
      currentUser = actor;
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: any = null;
      try { json = await response.json(); } catch { /* empty response */ }
      return { status: response.status, json };
    }

    const stamp = Date.now();
    const activeUser = (email: string, plan: "nextcob" | "starter" = "nextcob") => ({
      email,
      firstName: "E2E",
      lastName: "Cobros",
      activo: true,
      esDemo: false,
      profileCompleted: true,
      subscriptionStatus: "activa" as const,
      plan,
    });

    console.log("== Isolated fixtures ==");
    const [ownerA] = await db.insert(usersTable).values(activeUser(`owner-a-${stamp}@test.invalid`)).returning();
    const [executiveA] = await db.insert(usersTable).values({
      ...activeUser(`executive-a-${stamp}@test.invalid`),
      orgRole: "ejecutivo",
    }).returning();
    const [ownerB] = await db.insert(usersTable).values(activeUser(`owner-b-${stamp}@test.invalid`)).returning();
    const [starter] = await db.insert(usersTable).values(activeUser(`starter-${stamp}@test.invalid`, "starter")).returning();
    const [orgA] = await db.insert(organizacionesTable).values({ nombre: `E2E Cobros A ${stamp}`, ownerId: ownerA.id }).returning();
    const [orgB] = await db.insert(organizacionesTable).values({ nombre: `E2E Cobros B ${stamp}`, ownerId: ownerB.id }).returning();
    await db.update(usersTable).set({ organizationId: orgA.id, orgRole: "admin_org" }).where(eq(usersTable.id, ownerA.id));
    await db.update(usersTable).set({ organizationId: orgA.id, orgRole: "ejecutivo" }).where(eq(usersTable.id, executiveA.id));
    await db.update(usersTable).set({ organizationId: orgB.id, orgRole: "admin_org" }).where(eq(usersTable.id, ownerB.id));

    const [clientA] = await db.insert(clientesTable).values({
      nombre: "Cliente aislado A",
      userId: ownerA.id,
      organizationId: orgA.id,
      email: `client-a-${stamp}@test.invalid`,
      telefono: "not-a-phone",
    }).returning();
    const [clientB] = await db.insert(clientesTable).values({
      nombre: "Cliente aislado B",
      userId: ownerB.id,
      organizationId: orgB.id,
      email: `client-b-${stamp}@test.invalid`,
      telefono: "not-a-phone",
    }).returning();
    const [starterClient] = await db.insert(clientesTable).values({
      nombre: "Cliente Starter aislado",
      userId: starter.id,
      email: `client-starter-${stamp}@test.invalid`,
      telefono: "not-a-phone",
    }).returning();

    const actorA: Actor = ownerA;
    const actorB: Actor = ownerB;
    const actorExecutive: Actor = executiveA;
    const actorStarter: Actor = starter;
    const today = fechaHoySantiago();
    const futureStart = addDays(today, 1);
    const baseSchedule = {
      monto: 12000,
      descripcion: "E2E recurrente semanal aislado",
      tipoDocumento: "sin_documento",
      clienteId: clientA.id,
      emailPagador: `invoice-a-${stamp}@test.invalid`,
      automatizacion: "ninguna",
      canalesIniciales: [] as Array<"email" | "whatsapp">,
      frecuencia: "semanal",
      fechaInicio: futureStart,
    };
    console.log("== Global decimal precision ==");
    await adminClient.query(`insert into "${schema}".preferencias (scope, decimales) values ($1, 2)`, [`org:${orgA.id}`]);
    const individualDecimal = await api(actorA, "POST", "/cobros", { monto: 1500.75, descripcion: "Precision test", decimales: 0 });
    check("new individual ignores client decimals", individualDecimal.status === 201 && individualDecimal.json.decimales === 2 && individualDecimal.json.monto === 1500.75, individualDecimal);
    const recurringDecimal = await api(actorA, "POST", "/cobros/recurrentes", {
      ...baseSchedule, monto: 1500.75, fechaInicio: today, idempotencyKey: randomUUID(),
    });
    check("recurring template and first cobro preserve precision", recurringDecimal.status === 201 && recurringDecimal.json.schedule.decimales === 2 && recurringDecimal.json.cobro.decimales === 2 && recurringDecimal.json.cobro.monto === 1500.75, recurringDecimal);
    await adminClient.query(`update "${schema}".preferencias set decimales = 0 where scope=$1`, [`org:${orgA.id}`]);
    const individualWhole = await api(actorA, "POST", "/cobros", { monto: 1500.75, descripcion: "Integer test", decimales: 2 });
    check("OFF overrides client decimals and rounds new amount", individualWhole.status === 201 && individualWhole.json.decimales === 0 && individualWhole.json.monto === 1501, individualWhole);
    const oldIndividual = await api(actorA, "GET", `/cobros/${individualDecimal.json.id}`);
    check("existing individual is unchanged after OFF", oldIndividual.status === 200 && oldIndividual.json.decimales === 2 && oldIndividual.json.monto === 1500.75, oldIndividual);

    console.log("== Plan and tenant guards ==");
    const starterStatus = await api(actorStarter, "GET", "/subscription/status");
    check("active Starter subscription status is reachable past feature routers", starterStatus.status === 200 && starterStatus.json?.hasAccess === true, starterStatus);
    const starterAttempt = await api(actorStarter, "POST", "/cobros/recurrentes", {
      ...baseSchedule, clienteId: starterClient.id, idempotencyKey: randomUUID(),
    });
    check("Starter cannot schedule recurring cobros (403)", starterAttempt.status === 403 && starterAttempt.json?.code === "plan_upgrade", starterAttempt);

    const outOfScope = await api(actorExecutive, "POST", "/cobros/recurrentes", {
      ...baseSchedule, clienteId: clientB.id, idempotencyKey: randomUUID(),
    });
    check("executive gets 404 for another org's client", outOfScope.status === 404, outOfScope);

    console.log("== Actor-scoped idempotency through real router ==");
    const sharedKey = randomUUID();
    const first = await api(actorA, "POST", "/cobros/recurrentes", { ...baseSchedule, idempotencyKey: sharedKey });
    check("first future recurring schedule is created", first.status === 201 && first.json?.schedule?.id, first);
    const scheduleAId = first.json?.schedule?.id as number;
    const replay = await api(actorA, "POST", "/cobros/recurrentes", { ...baseSchedule, idempotencyKey: sharedKey });
    const [actorASchedules] = await db.select({ value: count() }).from(cobrosRecurrentesTable)
      .where(eq(cobrosRecurrentesTable.idempotencyKey, `${ownerA.id}:${sharedKey}`));
    check(
      "same actor + same key/payload replays without a duplicate",
      replay.status === 201 && replay.json?.schedule?.id === scheduleAId && Number(actorASchedules.value) === 1,
      { first, replay, schedules: actorASchedules },
    );
    const changed = await api(actorA, "POST", "/cobros/recurrentes", {
      ...baseSchedule, descripcion: "E2E body changed", idempotencyKey: sharedKey,
    });
    check("same actor + changed payload returns 409", changed.status === 409, changed);

    const otherActor = await api(actorB, "POST", "/cobros/recurrentes", {
      ...baseSchedule,
      clienteId: clientB.id,
      emailPagador: `invoice-b-${stamp}@test.invalid`,
      descripcion: "E2E schedule owned by actor B",
      idempotencyKey: sharedKey,
    });
    check(
      "same UUID from another actor creates and returns only that actor's schedule",
      otherActor.status === 201 &&
        otherActor.json?.schedule?.id !== scheduleAId &&
        otherActor.json?.schedule?.creadorId === ownerB.id &&
        otherActor.json?.schedule?.clienteId === clientB.id,
      otherActor,
    );

    console.log("== Calendar anchoring and weekly projection ==");
    const projection = await api(actorA, "GET", "/cobros/recurrentes");
    const weeklyOccurrences = (projection.json?.ocurrencias30Dias ?? []).filter(
      (item: any) => item.programacionId === scheduleAId,
    );
    const expectedWeeklyDates = [1, 2, 3, 4].map((cycle) => fechaCicloAnclada(futureStart, "semanal", cycle));
    check(
      "30-day projection includes multiple weekly occurrences",
      projection.status === 200 &&
        weeklyOccurrences.length === expectedWeeklyDates.length &&
        weeklyOccurrences.every((item: any, index: number) => item.fecha === expectedWeeklyDates[index]),
      { weeklyOccurrences, expectedWeeklyDates },
    );

    const jan31Monthly = await api(actorA, "POST", "/cobros/recurrentes", {
      ...baseSchedule,
      descripcion: "E2E Jan 31 mensual",
      frecuencia: "mensual",
      fechaInicio: "2025-01-31",
      // Keep historical calendar fixtures out of the later sweep's due work.
      // Their immediate creation still exercises the first anchored cycle.
      fechaTermino: "2025-01-31",
      idempotencyKey: randomUUID(),
    });
    check(
      "Jan-31 monthly schedule clamps its first cycle to Feb-28",
      jan31Monthly.status === 201 &&
        jan31Monthly.json?.schedule?.ciclo === 1 &&
        jan31Monthly.json?.schedule?.proximaGeneracion === "2025-02-28" &&
        jan31Monthly.json?.cobro?.fechaVencimiento === "2025-02-28",
      jan31Monthly,
    );
    const jan31Quincenal = await api(actorA, "POST", "/cobros/recurrentes", {
      ...baseSchedule,
      descripcion: "E2E Jan 31 quincenal",
      frecuencia: "quincenal",
      fechaInicio: "2025-01-31",
      fechaTermino: "2025-01-31",
      idempotencyKey: randomUUID(),
    });
    check(
      "Jan-31 quincenal advances exactly 15 days",
      jan31Quincenal.status === 201 &&
        jan31Quincenal.json?.schedule?.ciclo === 1 &&
        jan31Quincenal.json?.schedule?.proximaGeneracion === "2025-02-15" &&
        jan31Quincenal.json?.cobro?.fechaVencimiento === "2025-02-15",
      jan31Quincenal,
    );
    const [portalClient] = await db.select({ portalToken: clientesTable.portalToken })
      .from(clientesTable).where(eq(clientesTable.id, clientA.id));
    check(
      "immediate schedules provision only a safe portal fallback",
      !!portalClient?.portalToken &&
        jan31Monthly.json?.cobro?.linkPago?.includes(`/portal/${portalClient.portalToken}`) &&
        jan31Monthly.json?.deliveryResults?.length === 0,
      jan31Monthly,
    );

    console.log("== Concurrent real recurring sweeps in isolated schema ==");
    const [sweepSchedule] = await db.insert(cobrosRecurrentesTable).values({
      organizationId: orgA.id,
      responsableId: ownerA.id,
      responsableNombre: "E2E Cobros",
      clienteId: clientA.id,
      clienteNombre: clientA.nombre,
      emailPagador: `sweep-${stamp}@test.invalid`,
      monto: "31000",
      incluyeIva: false,
      tipoDocumento: "sin_documento",
      descripcion: "E2E concurrent sweep",
      automatizacion: "ninguna",
      canalesIniciales: [],
      creadorId: ownerA.id,
      idempotencyKey: `${ownerA.id}:${randomUUID()}`,
      idempotencyPayloadHash: "e2e-direct-sweep",
      frecuencia: "semanal",
      fechaInicio: today,
      proximaGeneracion: today,
      ciclo: 0,
      activo: true,
    }).returning();
    const sweepLog = { info: () => {}, warn: () => {} };
    const [sweepOne, sweepTwo] = await Promise.all([
      procesarCobrosRecurrentes(sweepLog, today),
      procesarCobrosRecurrentes(sweepLog, today),
    ]);
    const generated = await db.select().from(cobrosTable)
      .where(eq(cobrosTable.recurrenteProgramacionId, sweepSchedule.id));
    const [outboxCount] = await db.select({ value: count() }).from(cobroEntregasInicialesTable)
      .where(inArray(cobroEntregasInicialesTable.cobroId, generated.map((c) => c.id)));
    const [advancedSweep] = await db.select().from(cobrosRecurrentesTable)
      .where(eq(cobrosRecurrentesTable.id, sweepSchedule.id));
    check(
      "two concurrent sweeps generate one cycle, one child, and no delivery work",
      generated.length === 1 &&
        generated[0]?.recurrenteFechaCiclo === today &&
        generated[0]?.fechaVencimiento === addDays(today, 7) &&
        Number(outboxCount.value) === 0 &&
        advancedSweep?.ciclo === 1 &&
        advancedSweep?.proximaGeneracion === addDays(today, 7) &&
        sweepOne.generados + sweepTwo.generados === 1,
      { sweepOne, sweepTwo, generated, outboxCount, advancedSweep },
    );

    console.log(failures === 0 ? "\nALL ADVANCED COBROS DB CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (pool) await pool.end();
    // The schema contains all users, orgs, contacts, portal tokens, schedules,
    // charges, and cursor writes made by this regression.
    if (adminClient) {
      await adminClient.query(`drop schema if exists "${schema}" cascade`);
      await adminClient.end();
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error("FATAL:", error);
  })
  .finally(() => process.exit(failures === 0 ? 0 : 1));