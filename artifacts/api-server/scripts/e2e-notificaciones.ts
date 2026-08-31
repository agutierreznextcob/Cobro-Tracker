/**
 * Notification-center regression: durable idempotency, retention, backfill,
 * current-user isolation, and mark-all behavior.
 *
 * Run: pnpm --filter @workspace/api-server run e2e:notificaciones
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
    cobrosTable,
    comprobantesTransferenciaTable,
    db,
    invitacionesTable,
    notificacionBackfillsTable,
    notificacionEventosTable,
    notificacionLecturasTable,
    notificacionesTable,
    organizacionesTable,
    recordatoriosEnviadosTable,
    usersTable,
    workflowEjecucionesTable,
  } = await import("@workspace/db");
  const { and, count, eq, inArray } = await import("drizzle-orm");
  const {
    backfillNotificacionesUsuario,
    crearNotificacion,
  } = await import("../src/lib/notificaciones-service");
  const notificacionesRouter = (await import("../src/routes/notificaciones")).default;
  const express = (await import("express")).default;

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
  app.use("/api", notificacionesRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const stamp = Date.now();
  const createdUserIds: string[] = [];
  const createdCobroIds: number[] = [];
  const createdInvitationIds: number[] = [];
  let organizationId: number | null = null;

  async function api(method: string, path: string) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method });
    let json: any = null;
    try { json = await response.json(); } catch { /* empty response */ }
    return { status: response.status, json };
  }

  try {
    console.log("== Setup ==");
    const [owner] = await db.insert(usersTable).values({
      email: `e2e-notificaciones-owner-${stamp}@test.invalid`,
      firstName: "Dueño",
      lastName: "Prueba",
      orgRole: "admin_org",
      activo: true,
      esDemo: false,
      subscriptionStatus: "prueba",
      trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      profileCompleted: true,
    } as any).returning({ id: usersTable.id });
    const [other] = await db.insert(usersTable).values({
      email: `e2e-notificaciones-other-${stamp}@test.invalid`,
      firstName: "Otro",
      orgRole: "ejecutivo",
      activo: true,
      esDemo: true,
      profileCompleted: true,
    } as any).returning({ id: usersTable.id });
    const acceptedEmail = `e2e-notificaciones-accepted-${stamp}@test.invalid`;
    const [accepted] = await db.insert(usersTable).values({
      email: acceptedEmail,
      firstName: "Integrante",
      lastName: "Nuevo",
      orgRole: "ejecutivo",
      activo: true,
      esDemo: true,
      profileCompleted: true,
    } as any).returning({ id: usersTable.id });
    createdUserIds.push(owner.id, other.id, accepted.id);

    const [organization] = await db.insert(organizacionesTable).values({
      nombre: `e2e-notificaciones-${stamp}`,
      ownerId: owner.id,
    }).returning();
    organizationId = organization.id;
    await db.update(usersTable)
      .set({ organizationId })
      .where(inArray(usersTable.id, [owner.id, accepted.id]));

    const paidAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const [paidCobro] = await db.insert(cobrosTable).values({
      monto: "123456",
      descripcion: "E2E notificaciones pagado",
      estado: "pagado",
      pagadoEn: paidAt,
      responsableId: owner.id,
      responsableNombre: "Dueño Prueba",
      clienteNombre: "Cliente Pagado",
      organizationId,
    }).returning({ id: cobrosTable.id });
    const overdueDate = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
    const [overdueCobro] = await db.insert(cobrosTable).values({
      monto: "65432",
      descripcion: "E2E notificaciones vencido",
      estado: "pendiente",
      fechaVencimiento: overdueDate,
      responsableId: owner.id,
      responsableNombre: "Dueño Prueba",
      clienteNombre: "Cliente Atrasado",
      organizationId,
    }).returning({ id: cobrosTable.id });
    createdCobroIds.push(paidCobro.id, overdueCobro.id);

    const transferAt = new Date(Date.now() - 90 * 60 * 1000);
    const [transferReceipt] = await db.insert(comprobantesTransferenciaTable).values({
      cobroId: overdueCobro.id,
      archivo: "data:image/png;base64,iVBORw0KGgo=",
      nombreArchivo: "comprobante-e2e.png",
      comentario: "Persistido sin notificación para probar reconciliación",
      creadoEn: transferAt,
    }).returning({ id: comprobantesTransferenciaTable.id });

    const whatsappFallbackAt = new Date(Date.now() - 80 * 60 * 1000);
    const [reminderFallback] = await db.insert(recordatoriosEnviadosTable).values({
      cobroId: overdueCobro.id,
      recordatorioId: null,
      canal: "whatsapp",
      estado: "pendiente",
      detalle: "WhatsApp listo para enviar.",
      fecha: overdueDate,
      creadoEn: whatsappFallbackAt,
      actualizadoEn: whatsappFallbackAt,
      fallbackListoEn: whatsappFallbackAt,
      fallbackWaUrl: "https://wa.me/56911111111?text=Recordatorio%20E2E",
      fallbackMensaje: "Recordatorio E2E listo para enviar",
    }).returning({ id: recordatoriosEnviadosTable.id });

    const workflowWhatsappAt = new Date(Date.now() - 70 * 60 * 1000);
    const workflowWhatsappKey = `workflow:whatsapp:${overdueCobro.id}:910001`;
    await db.insert(workflowEjecucionesTable).values({
      cobroId: overdueCobro.id,
      workflowId: 910000,
      stepId: 910001,
      accionTipo: "enviar_whatsapp",
      estado: "enviado",
      detalle: "WhatsApp en notificación in-app (listo para enviar).",
      resultado: {
        notificaciones: [{
          eventKey: workflowWhatsappKey,
          userId: owner.id,
          cobroId: overdueCobro.id,
          tipo: "whatsapp",
          titulo: "WhatsApp workflow listo para Cliente Atrasado",
          mensaje: "Mensaje de workflow E2E",
          waUrl: "https://wa.me/56922222222?text=Workflow%20E2E",
        }],
      },
      fecha: overdueDate,
      creadoEn: workflowWhatsappAt,
      actualizadoEn: workflowWhatsappAt,
    });

    const workflowAdminAt = new Date(Date.now() - 60 * 60 * 1000);
    const workflowAdminKey = `workflow:admin:${overdueCobro.id}:910002:${other.id}`;
    await db.insert(workflowEjecucionesTable).values({
      cobroId: overdueCobro.id,
      workflowId: 910000,
      stepId: 910002,
      accionTipo: "notificar_admin",
      estado: "enviado",
      detalle: "Administrador notificado.",
      resultado: {
        notificaciones: [{
          eventKey: workflowAdminKey,
          userId: other.id,
          cobroId: overdueCobro.id,
          tipo: "workflow",
          titulo: "Cobro requiere atención: Cliente Atrasado",
          mensaje: "Escalamiento E2E",
        }],
      },
      fecha: overdueDate,
      creadoEn: workflowAdminAt,
      actualizadoEn: workflowAdminAt,
    });

    const acceptedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const [invitation] = await db.insert(invitacionesTable).values({
      organizationId,
      email: acceptedEmail,
      orgRole: "ejecutivo",
      token: `e2e-notificaciones-${stamp}`,
      estado: "aceptada",
      invitadoPorId: owner.id,
      aceptadaEn: acceptedAt,
    }).returning({ id: invitacionesTable.id });
    createdInvitationIds.push(invitation.id);

    console.log("== Durable event identity ==");
    const historicAt = new Date(Date.now() - 5 * 86400000);
    const first = await crearNotificacion({
      eventKey: `same-source-${stamp}`,
      userId: owner.id,
      tipo: "test",
      titulo: "Evento histórico",
      creadoEn: historicAt,
    });
    const duplicate = await crearNotificacion({
      eventKey: `same-source-${stamp}`,
      userId: owner.id,
      tipo: "test",
      titulo: "Duplicado",
    });
    const fanout = await crearNotificacion({
      eventKey: `same-source-${stamp}`,
      userId: other.id,
      tipo: "test",
      titulo: "Mismo evento, otro destinatario",
    });
    check("first claim creates a row", first);
    check("retry is a no-op", !duplicate);
    check("same source can notify another recipient", fanout);
    const [historicRow] = await db.select().from(notificacionesTable).where(and(
      eq(notificacionesTable.userId, owner.id),
      eq(notificacionesTable.titulo, "Evento histórico"),
    ));
    check("source timestamp is preserved", historicRow?.creadoEn.getTime() === historicAt.getTime(), historicRow?.creadoEn);

    console.log("== Retention ==");
    for (let i = 0; i < 101; i += 1) {
      await crearNotificacion({
        eventKey: `retention-${stamp}-${i}`,
        userId: owner.id,
        tipo: "test",
        titulo: `Retención ${i}`,
        creadoEn: new Date(Date.now() + i * 1000),
      });
    }
    const [visibleCount] = await db.select({ value: count() }).from(notificacionesTable)
      .where(eq(notificacionesTable.userId, owner.id));
    const [claimCount] = await db.select({ value: count() }).from(notificacionEventosTable)
      .where(eq(notificacionEventosTable.userId, owner.id));
    check("only newest 100 visible rows remain", Number(visibleCount.value) === 100, visibleCount);
    check("durable claims survive visible retention", Number(claimCount.value) === 102, claimCount);
    await Promise.all([
      crearNotificacion({
        eventKey: `concurrent-${stamp}-a`,
        userId: owner.id,
        tipo: "test",
        titulo: "Concurrencia A",
      }),
      crearNotificacion({
        eventKey: `concurrent-${stamp}-b`,
        userId: owner.id,
        tipo: "test",
        titulo: "Concurrencia B",
      }),
    ]);
    const [concurrentCount] = await db.select({ value: count() }).from(notificacionesTable)
      .where(eq(notificacionesTable.userId, owner.id));
    const [concurrentClaimCount] = await db.select({ value: count() }).from(notificacionEventosTable)
      .where(eq(notificacionEventosTable.userId, owner.id));
    check("concurrent writes preserve the physical 100-row bound", Number(concurrentCount.value) === 100, concurrentCount);
    check("concurrent event claims are both durable", Number(concurrentClaimCount.value) === 104, concurrentClaimCount);

    console.log("== Real notification router + backfill ==");
    // Start the backfill assertions with an empty visible inbox while keeping
    // all durable claims from the retention test intact.
    await db.delete(notificacionesTable).where(eq(notificacionesTable.userId, owner.id));
    currentUser = owner;
    const firstList = await api("GET", "/notificaciones");
    check("initial list stays responsive while backfill runs", firstList.status === 200 && firstList.json.length <= 100, firstList);
    let backfillCompleted = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await db
        .select({ completadoEn: notificacionBackfillsTable.completadoEn })
        .from(notificacionBackfillsTable)
        .where(eq(notificacionBackfillsTable.userId, owner.id));
      if (state?.completadoEn) {
        backfillCompleted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    check("background backfill completes", backfillCompleted);
    const backfilledList = await api("GET", "/notificaciones");
    check("paid cobro was backfilled with CLP and client", backfilledList.json.some(
      (n: any) => n.cobroId === paidCobro.id && n.titulo.includes("Cliente Pagado") && n.titulo.includes("$123.456"),
    ));
    check("both overdue milestones were backfilled", [0, 7].every((milestone) =>
      backfilledList.json.some((n: any) =>
        n.cobroId === overdueCobro.id &&
        (milestone === 0 ? n.titulo.includes("Venció el cobro") : n.titulo.includes("7 días")),
      ),
    ));
    check("accepted invitation uses member name", backfilledList.json.some(
      (n: any) => n.titulo.includes("Integrante Nuevo") && n.tipo === "equipo",
    ));
    check("persisted transfer receipt is recovered exactly once", backfilledList.json.filter(
      (n: any) => n.cobroId === overdueCobro.id &&
        n.titulo.includes("envió un comprobante") &&
        n.creadoEn === transferAt.toISOString(),
    ).length === 1, { transferReceiptId: transferReceipt.id });
    check("persisted reminder WhatsApp fallback keeps its action link", backfilledList.json.filter(
      (n: any) => n.cobroId === overdueCobro.id &&
        n.titulo.includes("WhatsApp listo para enviar") &&
        n.waUrl?.includes("56911111111") &&
        n.creadoEn === whatsappFallbackAt.toISOString(),
    ).length === 1, { reminderFallbackId: reminderFallback.id });
    check("persisted workflow WhatsApp fallback keeps its action link", backfilledList.json.filter(
      (n: any) => n.titulo === "WhatsApp workflow listo para Cliente Atrasado" &&
        n.waUrl?.includes("56922222222") &&
        n.creadoEn === workflowWhatsappAt.toISOString(),
    ).length === 1);
    check("crossed trial warnings were backfilled", [7, 2].every((days) =>
      backfilledList.json.some((n: any) => n.titulo.includes(`${days} días`)),
    ));

    const [claimsAfterFirstList] = await db.select({ value: count() }).from(notificacionEventosTable)
      .where(eq(notificacionEventosTable.userId, owner.id));
    const secondList = await api("GET", "/notificaciones");
    const [claimsAfterSecondList] = await db.select({ value: count() }).from(notificacionEventosTable)
      .where(eq(notificacionEventosTable.userId, owner.id));
    check("backfill rerun is a no-op", secondList.status === 200 &&
      Number(claimsAfterFirstList.value) === Number(claimsAfterSecondList.value));

    await backfillNotificacionesUsuario(other.id);
    const otherRows = await db.select().from(notificacionesTable).where(eq(notificacionesTable.userId, other.id));
    check("persisted non-responsible workflow admin recipient is recovered exactly once", otherRows.filter(
      (n) => n.titulo === "Cobro requiere atención: Cliente Atrasado" &&
        n.creadoEn.getTime() === workflowAdminAt.getTime(),
    ).length === 1);
    const fanoutRow = otherRows.find((n) => n.titulo === "Mismo evento, otro destinatario");
    check("other recipient keeps its own direct notification", fanoutRow != null);
    const crossRead = await api("POST", `/notificaciones/${fanoutRow!.id}/leida`);
    check("cannot mutate another user's notification", crossRead.status === 404, crossRead);
    const markAll = await api("POST", "/notificaciones/marcar-todas-leidas");
    check("mark-all succeeds", markAll.status === 200 && markAll.json.ok === true, markAll);
    await crearNotificacion({
      eventKey: `historical-after-mark-all-${stamp}`,
      userId: owner.id,
      tipo: "test",
      titulo: "Histórico insertado después de marcar todas",
      creadoEn: new Date(Date.now() - 60 * 60 * 1000),
    });
    const unread = await api("GET", "/notificaciones?soloNoLeidas=true");
    check("historical rows inserted after mark-all remain read", unread.status === 200 && unread.json.length === 0, unread);
    const [otherAfter] = await db.select().from(notificacionesTable).where(eq(notificacionesTable.id, fanoutRow!.id));
    check("mark-all does not touch another user", otherAfter?.leida === false, otherAfter);

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
  } finally {
    currentUser = null;
    if (createdUserIds.length) {
      await db.delete(notificacionesTable).where(inArray(notificacionesTable.userId, createdUserIds));
      await db.delete(notificacionEventosTable).where(inArray(notificacionEventosTable.userId, createdUserIds));
      await db.delete(notificacionBackfillsTable).where(inArray(notificacionBackfillsTable.userId, createdUserIds));
      await db.delete(notificacionLecturasTable).where(inArray(notificacionLecturasTable.userId, createdUserIds));
    }
    if (createdInvitationIds.length) {
      await db.delete(invitacionesTable).where(inArray(invitacionesTable.id, createdInvitationIds));
    }
    if (createdCobroIds.length) {
      await db.delete(cobrosTable).where(inArray(cobrosTable.id, createdCobroIds));
    }
    if (createdUserIds.length) {
      await db.update(usersTable).set({ organizationId: null }).where(inArray(usersTable.id, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
    if (organizationId !== null) {
      await db.delete(organizacionesTable).where(eq(organizacionesTable.id, organizationId));
    }
    server.close();
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error("FATAL:", error);
  })
  .finally(() => process.exit(failures === 0 ? 0 : 1));