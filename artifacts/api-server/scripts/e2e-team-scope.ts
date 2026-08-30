/**
 * Cross-role authorization regression for tareas and gestión.
 *
 * Seeds one organization with two supervisor teams, mounts the real routers
 * behind a minimal authenticated-user shim, exercises every role, then removes
 * all fixture rows.
 *
 * Run: pnpm --filter @workspace/api-server run e2e:team-scope
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

async function main() {
  const {
    db,
    usersTable,
    organizacionesTable,
    clientesTable,
    cobrosTable,
    tareasTable,
    gestionesCobranzaTable,
  } = await import("@workspace/db");
  const { eq, inArray } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const tareasRouter = (await import("../src/routes/tareas")).default;
  const gestionesRouter = (await import("../src/routes/gestiones")).default;

  const silentLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => silentLog,
  };
  let currentUser: { id: string } | null = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => currentUser !== null;
    (req as any).log = silentLog;
    next();
  });
  app.use("/api", tareasRouter);
  app.use("/api", gestionesRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  async function api(method: string, path: string, body?: unknown) {
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
  const createdUserIds: string[] = [];
  const createdClienteIds: number[] = [];
  const createdCobroIds: number[] = [];
  const createdTareaIds: number[] = [];
  let organizationId: number | null = null;

  try {
    console.log("== Setup: two isolated supervisor teams ==");
    const roles = [
      { key: "admin", role: "admin_org" as const, supervisor: null },
      { key: "sup-a", role: "supervisor" as const, supervisor: null },
      { key: "sup-b", role: "supervisor" as const, supervisor: null },
    ];
    const users: Record<string, { id: string }> = {};
    for (const fixture of roles) {
      const [user] = await db.insert(usersTable).values({
        email: `e2e-team-${fixture.key}-${stamp}@test.invalid`,
        firstName: `Secret-${fixture.key}`,
        orgRole: fixture.role,
        activo: true,
        esDemo: true,
        profileCompleted: true,
      } as any).returning({ id: usersTable.id });
      users[fixture.key] = user;
      createdUserIds.push(user.id);
    }
    const [organization] = await db.insert(organizacionesTable).values({
      nombre: `e2e-team-scope-${stamp}`,
      ownerId: users.admin.id,
    }).returning();
    organizationId = organization.id;
    await db.update(usersTable).set({ organizationId }).where(inArray(usersTable.id, createdUserIds));

    for (const [key, supervisorId] of [["exec-a", users["sup-a"].id], ["exec-b", users["sup-b"].id]] as const) {
      const [user] = await db.insert(usersTable).values({
        email: `e2e-team-${key}-${stamp}@test.invalid`,
        firstName: `Secret-${key}`,
        orgRole: "ejecutivo",
        organizationId,
        supervisorId,
        activo: true,
        esDemo: true,
        profileCompleted: true,
      } as any).returning({ id: usersTable.id });
      users[key] = user;
      createdUserIds.push(user.id);
    }

    const fixtureByTeam: Record<"a" | "b", { clienteId: number; cobroId: number; tareaId: number; gestionId: number }> = {} as any;
    for (const team of ["a", "b"] as const) {
      const owner = users[`exec-${team}`];
      const [cliente] = await db.insert(clientesTable).values({
        nombre: `Secret Cliente ${team.toUpperCase()} ${stamp}`,
        userId: owner.id,
        organizationId,
      }).returning();
      createdClienteIds.push(cliente.id);
      const [cobro] = await db.insert(cobrosTable).values({
        monto: team === "a" ? "111111" : "999999",
        descripcion: `Secret Cobro ${team.toUpperCase()} ${stamp}`,
        clienteId: cliente.id,
        clienteNombre: cliente.nombre,
        responsableId: owner.id,
        responsableNombre: `Secret-exec-${team}`,
        organizationId,
        estado: "pendiente",
      }).returning();
      createdCobroIds.push(cobro.id);
      const [tarea] = await db.insert(tareasTable).values({
        organizationId,
        userId: owner.id,
        cobroId: cobro.id,
        titulo: `Secret Tarea ${team.toUpperCase()} ${stamp}`,
        estado: "pendiente",
        origen: "manual",
        venceEn: new Date(Date.now() - 60_000),
      }).returning();
      createdTareaIds.push(tarea.id);
      const [gestion] = await db.insert(gestionesCobranzaTable).values({
        cobroId: cobro.id,
        usuarioId: owner.id,
        tipo: "llamada",
        resultado: "no_contesto",
        nota: `Secret Nota ${team.toUpperCase()} ${stamp}`,
        proximaGestionEn: new Date(Date.now() - 60_000),
        proximaGestionTipo: "llamada",
      }).returning();
      fixtureByTeam[team] = { clienteId: cliente.id, cobroId: cobro.id, tareaId: tarea.id, gestionId: gestion.id };
    }

    const secretB = String(stamp);
    currentUser = users["sup-a"];
    console.log("== Supervisor A: list, filters, create, assign, complete ==");
    const listA = await api("GET", "/tareas");
    check("lists only team A tasks", listA.status === 200 && listA.json.length === 1 && listA.json[0].id === fixtureByTeam.a.tareaId, listA);
    check("does not leak team B task fields", !JSON.stringify(listA.json).includes("Secret Tarea B"), listA.json);
    const filterOwn = await api("GET", `/tareas?responsableId=${users["exec-a"].id}`);
    check("can filter own ejecutivo", filterOwn.status === 200 && filterOwn.json.length === 1, filterOwn);
    const filterOther = await api("GET", `/tareas?responsableId=${users["exec-b"].id}`);
    check("out-of-team responsible filter is safely empty", filterOther.status === 200 && filterOther.json.length === 0, filterOther);
    const filterCobro = await api("GET", `/tareas?cobroId=${fixtureByTeam.b.cobroId}`);
    check("out-of-team cobro filter is safely empty", filterCobro.status === 200 && filterCobro.json.length === 0, filterCobro);

    const assigned = await api("POST", "/tareas", {
      titulo: `Supervisor A assigned ${stamp}`,
      responsableId: users["exec-a"].id,
      cobroId: fixtureByTeam.a.cobroId,
      venceEn: "2026-08-30",
    });
    check("can create and assign inside team", assigned.status === 201 && assigned.json.userId === users["exec-a"].id, assigned);
    if (assigned.json?.id) createdTareaIds.push(assigned.json.id);
    const patchOwn = await api("PATCH", `/tareas/${assigned.json.id}/estado`, { estado: "cancelada" });
    check("can patch team task state", patchOwn.status === 200 && patchOwn.json.estado === "cancelada", patchOwn);
    const reopenOwn = await api("PATCH", `/tareas/${assigned.json.id}/estado`, { estado: "pendiente" });
    check("can reopen team task before completing", reopenOwn.status === 200 && reopenOwn.json.estado === "pendiente", reopenOwn);
    const deniedResponsible = await api("POST", "/tareas", {
      titulo: `Forbidden responsible ${stamp}`,
      responsableId: users["exec-b"].id,
    });
    check("out-of-team responsible is safe 404", deniedResponsible.status === 404 && !JSON.stringify(deniedResponsible.json).includes("exec-b"), deniedResponsible);
    const deniedCobro = await api("POST", "/tareas", {
      titulo: `Forbidden cobro ${stamp}`,
      cobroId: fixtureByTeam.b.cobroId,
    });
    check("out-of-team cobro is safe 404 without amount/name", deniedCobro.status === 404 && !JSON.stringify(deniedCobro.json).includes(secretB), deniedCobro);
    const completeOwn = await api("POST", `/tareas/${assigned.json.id}/completar`);
    check("can complete team task", completeOwn.status === 200 && completeOwn.json.estado === "completada", completeOwn);
    const patchOther = await api("PATCH", `/tareas/${fixtureByTeam.b.tareaId}/estado`, { estado: "cancelada" });
    check("cannot patch other team task", patchOther.status === 404 && !JSON.stringify(patchOther.json).includes("Secret"), patchOther);

    console.log("== Supervisor A: three gestión dashboard endpoints ==");
    const priorityA = await api("GET", "/gestion/clientes-prioritarios");
    check("priority clients only include team A", priorityA.status === 200 && priorityA.json.some((x: any) => x.clienteId === fixtureByTeam.a.clienteId) && !priorityA.json.some((x: any) => x.clienteId === fixtureByTeam.b.clienteId), priorityA);
    const summaryA = await api("GET", "/gestion/resumen");
    check("summary counts only team A fixtures", summaryA.status === 200 && summaryA.json.tareasPendientes === 1 && summaryA.json.compromisosPendientes === 1, summaryA);
    const todayA = await api("GET", "/gestion/hoy");
    check("today only returns team A task/agenda", todayA.status === 200 && todayA.json.tareas.some((x: any) => x.id === fixtureByTeam.a.tareaId) && !todayA.json.tareas.some((x: any) => x.id === fixtureByTeam.b.tareaId) && todayA.json.agenda.some((x: any) => x.gestionId === fixtureByTeam.a.gestionId) && !todayA.json.agenda.some((x: any) => x.gestionId === fixtureByTeam.b.gestionId), todayA);
    check("today response leaks no team B names or amounts", !JSON.stringify(todayA.json).includes("999999") && !JSON.stringify(todayA.json).includes("Secret Cliente B"), todayA.json);
    const listOtherGestiones = await api("GET", `/cobros/${fixtureByTeam.b.cobroId}/gestiones`);
    check("inaccessible cobro gestiones is safe 404", listOtherGestiones.status === 404 && !JSON.stringify(listOtherGestiones.json).includes("Secret"), listOtherGestiones);
    const createOtherGestion = await api("POST", `/cobros/${fixtureByTeam.b.cobroId}/gestiones`, { tipo: "email", resultado: "no_contesto" });
    check("cannot create gestión for other team cobro", createOtherGestion.status === 404 && !JSON.stringify(createOtherGestion.json).includes("Secret"), createOtherGestion);
    const completeOtherGestion = await api("POST", `/gestiones/agenda/${fixtureByTeam.b.gestionId}/completar`);
    check("cannot complete other team gestión", completeOtherGestion.status === 404 && !JSON.stringify(completeOtherGestion.json).includes("Secret"), completeOtherGestion);
    const ownHistory = await api("GET", `/cobros/${fixtureByTeam.a.cobroId}/gestiones`);
    check("can read own-team gestión history", ownHistory.status === 200 && ownHistory.json.some((x: any) => x.id === fixtureByTeam.a.gestionId), ownHistory);
    const ownGestion = await api("POST", `/cobros/${fixtureByTeam.a.cobroId}/gestiones`, {
      tipo: "email",
      resultado: "contactado_pagara",
      nota: `Authorized team A ${stamp}`,
      proximaGestionEn: new Date(Date.now() - 30_000).toISOString(),
      proximaGestionTipo: "email",
    });
    check("can create gestión for own-team cobro", ownGestion.status === 201 && ownGestion.json.cobroId === fixtureByTeam.a.cobroId, ownGestion);
    const ownGestionComplete = await api("POST", `/gestiones/agenda/${ownGestion.json.id}/completar`);
    check("can complete own-team agenda gestión", ownGestionComplete.status === 200 && !!ownGestionComplete.json.proximaGestionCompletadaEn, ownGestionComplete);

    currentUser = users["sup-b"];
    console.log("== Supervisor B: symmetric isolation ==");
    const listB = await api("GET", "/tareas");
    check("lists only team B tasks", listB.status === 200 && listB.json.length === 1 && listB.json[0].id === fixtureByTeam.b.tareaId, listB);
    const createB = await api("POST", "/tareas", { titulo: `Supervisor B own ${stamp}`, responsableId: users["exec-b"].id });
    check("can create inside team B", createB.status === 201, createB);
    if (createB.json?.id) createdTareaIds.push(createB.json.id);
    const completeA = await api("POST", `/tareas/${fixtureByTeam.a.tareaId}/completar`);
    check("cannot complete team A task", completeA.status === 404 && !JSON.stringify(completeA.json).includes("Secret"), completeA);

    console.log("== Ejecutivos: own tasks and cobros only ==");
    currentUser = users["exec-a"];
    const execAList = await api("GET", "/tareas");
    check("ejecutivo A lists only own assigned tasks", execAList.status === 200 && execAList.json.every((x: any) => x.userId === users["exec-a"].id), execAList);
    const execAssignOther = await api("POST", "/tareas", { titulo: `Exec forbidden ${stamp}`, responsableId: users["sup-a"].id });
    check("ejecutivo cannot assign to supervisor", execAssignOther.status === 404 && !JSON.stringify(execAssignOther.json).includes("sup-a"), execAssignOther);
    const execOtherCobro = await api("POST", "/tareas", { titulo: `Exec other cobro ${stamp}`, cobroId: fixtureByTeam.b.cobroId });
    check("ejecutivo cannot link other cobro", execOtherCobro.status === 404 && !JSON.stringify(execOtherCobro.json).includes("999999") && !JSON.stringify(execOtherCobro.json).includes("Secret"), execOtherCobro);
    const execPatchOwn = await api("PATCH", `/tareas/${fixtureByTeam.a.tareaId}/estado`, { estado: "cancelada" });
    check("ejecutivo can patch own task", execPatchOwn.status === 200 && execPatchOwn.json.estado === "cancelada", execPatchOwn);
    const execReopenOwn = await api("PATCH", `/tareas/${fixtureByTeam.a.tareaId}/estado`, { estado: "pendiente" });
    check("ejecutivo can reopen own task", execReopenOwn.status === 200 && execReopenOwn.json.estado === "pendiente", execReopenOwn);
    const execPatchForeign = await api("PATCH", `/tareas/${fixtureByTeam.b.tareaId}/estado`, { estado: "cancelada" });
    check("ejecutivo cannot patch foreign task", execPatchForeign.status === 404 && !JSON.stringify(execPatchForeign.json).includes("Secret"), execPatchForeign);
    const execCompleteForeign = await api("POST", `/tareas/${fixtureByTeam.b.tareaId}/completar`);
    check("ejecutivo cannot complete foreign task", execCompleteForeign.status === 404 && !JSON.stringify(execCompleteForeign.json).includes("Secret"), execCompleteForeign);
    const execToday = await api("GET", "/gestion/hoy");
    check("ejecutivo dashboard contains only own cobro", execToday.status === 200 && execToday.json.agenda.every((x: any) => x.cobroId === fixtureByTeam.a.cobroId), execToday);
    const execOtherHistory = await api("GET", `/cobros/${fixtureByTeam.b.cobroId}/gestiones`);
    check("ejecutivo gets safe 404 for other cobro", execOtherHistory.status === 404 && !JSON.stringify(execOtherHistory.json).includes("999999"), execOtherHistory);
    const [foreignTaskAfter] = await db.select({ estado: tareasTable.estado }).from(tareasTable).where(eq(tareasTable.id, fixtureByTeam.b.tareaId));
    check("denied mutations leave foreign task unchanged", foreignTaskAfter?.estado === "pendiente", foreignTaskAfter);

    currentUser = users.admin;
    const adminList = await api("GET", "/tareas");
    check("admin control sees both teams", adminList.status === 200 && [fixtureByTeam.a.tareaId, fixtureByTeam.b.tareaId].every((id) => adminList.json.some((x: any) => x.id === id)), adminList);

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
  } finally {
    currentUser = null;
    if (createdCobroIds.length) {
      await db.delete(gestionesCobranzaTable).where(inArray(gestionesCobranzaTable.cobroId, createdCobroIds));
      await db.delete(cobrosTable).where(inArray(cobrosTable.id, createdCobroIds));
    }
    if (createdTareaIds.length) await db.delete(tareasTable).where(inArray(tareasTable.id, createdTareaIds));
    if (createdClienteIds.length) await db.delete(clientesTable).where(inArray(clientesTable.id, createdClienteIds));
    if (createdUserIds.length) {
      await db.update(usersTable).set({ organizationId: null, supervisorId: null }).where(inArray(usersTable.id, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
    if (organizationId !== null) await db.delete(organizacionesTable).where(eq(organizacionesTable.id, organizationId));
    server.close();
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error("FATAL:", error);
  })
  .finally(() => process.exit(failures === 0 ? 0 : 1));