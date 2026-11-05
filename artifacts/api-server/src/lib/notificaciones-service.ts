import {
  cobrosTable,
  comprobantesTable,
  comprobantesTransferenciaTable,
  db,
  invitacionesTable,
  notificacionBackfillsTable,
  notificacionEventosTable,
  notificacionLecturasTable,
  notificacionesTable,
  pagosParciales,
  recordatoriosEnviadosTable,
  workflowEjecucionesTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

export type NotificacionInput = {
  eventKey: string;
  userId: string;
  cobroId?: number | null;
  tipo: string;
  titulo: string;
  mensaje?: string | null;
  waUrl?: string | null;
  creadoEn?: Date;
};

export const formatoClp = (monto: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(monto));

/**
 * The sole notification write boundary. Event claims and the visible row live
 * in one transaction so retries either write both or neither. Claims survive
 * retention pruning, which makes old events permanently idempotent.
 */
type NotificationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function crearNotificacion(input: NotificacionInput, existingTx?: NotificationTx): Promise<boolean> {
  // A source event can legitimately fan out to several people. Keep that fact
  // distinct in the durable claim while callers continue to supply source keys.
  const claimKey = `${input.userId}:${input.eventKey}`;
  const creadoEn = input.creadoEn ?? new Date();
  const write = async (tx: NotificationTx) => {
    // Serialize all writes for one inbox. This guarantees the physical
    // retention bound even when several producers finish simultaneously.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
    const claim = await tx
      .insert(notificacionEventosTable)
      .values({ eventoKey: claimKey, userId: input.userId, creadoEn })
      .onConflictDoNothing()
      .returning({ eventoKey: notificacionEventosTable.eventoKey });
    if (!claim.length) return false;
    const [readCursor] = await tx
      .select({ leidoHastaEn: notificacionLecturasTable.leidoHastaEn })
      .from(notificacionLecturasTable)
      .where(eq(notificacionLecturasTable.userId, input.userId));
    await tx.insert(notificacionesTable).values({
      userId: input.userId, cobroId: input.cobroId ?? null, tipo: input.tipo,
      titulo: input.titulo, mensaje: input.mensaje ?? null, waUrl: input.waUrl ?? null,
      creadoEn,
      leida: readCursor != null && creadoEn.getTime() <= readCursor.leidoHastaEn.getTime(),
    });
    // Delete everything after the newest 100 for this user. The indexed order
    // keeps this bounded even when old installations already contain many rows.
    await tx.execute(sql`
      delete from notificaciones
      where user_id = ${input.userId}
        and id in (
          select id from notificaciones
          where user_id = ${input.userId}
          order by creado_en desc, id desc
          offset 100
        )`);
    return true;
  };
  return existingTx ? write(existingTx) : db.transaction(write);
}

export async function podarNotificacionesExistentes(userId?: string): Promise<void> {
  await db.execute(sql`
    delete from notificaciones n
    where ${userId ? sql`n.user_id = ${userId} and` : sql``} n.id in (
      select id from (
        select id, row_number() over (partition by user_id order by creado_en desc, id desc) as rn
        from notificaciones ${userId ? sql`where user_id = ${userId}` : sql``}
      ) recientes where rn > 100
    )`);
}

/** Rebuild only facts that remain durably provable; all writes reuse event keys. */
export async function backfillNotificacionesUsuario(userId: string, desde?: Date): Promise<number> {
  await podarNotificacionesExistentes(userId);
  let creadas = 0;
  const cobros = await db.select().from(cobrosTable).where(and(
    eq(cobrosTable.responsableId, userId),
    desde
      ? or(
          gte(cobrosTable.pagadoEn, desde),
          gte(cobrosTable.actualizadoEn, desde),
          inArray(cobrosTable.estado, ["pendiente", "parcial"]),
        )
      : undefined,
  ));
  for (const cobro of cobros) {
    const monto = formatoClp(Number(cobro.monto) - Number(cobro.montoDescuento ?? 0));
    const cliente = cobro.clienteNombre || "Cliente";
    if (cobro.estado === "pagado" || cobro.estado === "fallido") {
      creadas += Number(await crearNotificacion({
        eventKey: `cobro:${cobro.id}:${cobro.estado}`, userId, cobroId: cobro.id, tipo: "pago",
        titulo: cobro.estado === "pagado" ? `💰 ${cliente} pagó ${monto}` : `❌ Pago fallido de ${cliente} por ${monto}`,
        creadoEn: cobro.pagadoEn ?? cobro.actualizadoEn,
      }));
    }
    if ((cobro.estado === "pendiente" || cobro.estado === "parcial") && cobro.fechaVencimiento) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
      const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cobro.fechaVencimiento}T00:00:00Z`)) / 86400000);
      for (const milestone of days >= 7 ? [0, 7] : [days]) {
        if (milestone !== 0 && milestone !== 7) continue;
        creadas += Number(await crearNotificacion({
          eventKey: `cobro:${cobro.id}:vencido:${milestone}`, userId, cobroId: cobro.id, tipo: "vencimiento",
           titulo: milestone === 0
             ? (days === 0 ? `⏰ El cobro de ${cliente} venció hoy` : `⏰ Venció el cobro de ${cliente}`)
             : `🔴 ${cliente} lleva 7 días sin pagar ${monto}`,
          creadoEn: new Date(Date.parse(`${cobro.fechaVencimiento}T12:00:00Z`) + milestone * 86400000),
        }));
      }
    }
  }
  const abonos = await db.select({
    id: pagosParciales.id,
    cobroId: pagosParciales.cobroId,
    monto: pagosParciales.monto,
    estado: pagosParciales.estado,
    confirmadoEn: pagosParciales.confirmadoEn,
    creadoEn: pagosParciales.creadoEn,
    actualizadoEn: pagosParciales.actualizadoEn,
    cliente: cobrosTable.clienteNombre,
  })
    .from(pagosParciales).innerJoin(cobrosTable, eq(cobrosTable.id, pagosParciales.cobroId))
    .where(and(
      eq(cobrosTable.responsableId, userId),
      inArray(pagosParciales.estado, ["confirmado", "fallido"]),
      desde
        ? gte(pagosParciales.actualizadoEn, desde)
        : undefined,
    ))
    .orderBy(asc(pagosParciales.confirmadoEn), asc(pagosParciales.id));
  for (const a of abonos) creadas += Number(await crearNotificacion(a.estado === "confirmado"
    ? {
        eventKey: `abono:${a.id}:confirmado`,
        userId,
        cobroId: a.cobroId,
        tipo: "abono",
        titulo: `💛 ${a.cliente || "Cliente"} realizó un abono de ${formatoClp(Number(a.monto))}`,
        creadoEn: a.confirmadoEn ?? a.actualizadoEn,
      }
    : {
        eventKey: `abono:${a.id}:fallido`,
        userId,
        cobroId: a.cobroId,
        tipo: "pago_fallido",
        titulo: `❌ Pago fallido de ${a.cliente || "Cliente"} por ${formatoClp(Number(a.monto))}`,
        creadoEn: a.actualizadoEn,
      }));
  const receipts = await db.select({
    cobroId: comprobantesTable.cobroId,
    creadoEn: comprobantesTable.creadoEn,
    emailEnviadoEn: comprobantesTable.emailEnviadoEn,
    cliente: cobrosTable.clienteNombre,
  }).from(comprobantesTable)
    .innerJoin(cobrosTable, eq(cobrosTable.id, comprobantesTable.cobroId))
    .where(and(
      eq(cobrosTable.responsableId, userId),
      eq(comprobantesTable.emailEnviado, true),
      desde ? gte(comprobantesTable.emailEnviadoEn, desde) : undefined,
    ));
  for (const r of receipts) creadas += Number(await crearNotificacion({
    eventKey: `comprobante:${r.cobroId}:email`, userId, cobroId: r.cobroId, tipo: "comprobante",
    titulo: `📄 Comprobante enviado a ${r.cliente || "Cliente"}`,
    mensaje: "El comprobante de pago fue enviado por email.",
    creadoEn: r.emailEnviadoEn ?? r.creadoEn,
  }));
  const transferReceipts = await db.select({
    id: comprobantesTransferenciaTable.id,
    cobroId: comprobantesTransferenciaTable.cobroId,
    creadoEn: comprobantesTransferenciaTable.creadoEn,
    cliente: cobrosTable.clienteNombre,
    descripcion: cobrosTable.descripcion,
  }).from(comprobantesTransferenciaTable)
    .innerJoin(cobrosTable, eq(cobrosTable.id, comprobantesTransferenciaTable.cobroId))
    .where(and(
      eq(cobrosTable.responsableId, userId),
      desde ? gte(comprobantesTransferenciaTable.creadoEn, desde) : undefined,
    ));
  for (const r of transferReceipts) creadas += Number(await crearNotificacion({
    eventKey: `transferencia:${r.id}:recibida`,
    userId,
    cobroId: r.cobroId,
    tipo: "comprobante",
    titulo: `El cliente ${r.cliente || "Cliente"} envió un comprobante para el cobro "${r.descripcion}"`,
    mensaje: "Revisa el comprobante de transferencia y confirma el pago.",
    creadoEn: r.creadoEn,
  }));
  const recordatorios = await db.select({
    id: recordatoriosEnviadosTable.id, cobroId: recordatoriosEnviadosTable.cobroId,
    canal: recordatoriosEnviadosTable.canal,
    estado: recordatoriosEnviadosTable.estado,
    creadoEn: recordatoriosEnviadosTable.creadoEn,
    actualizadoEn: recordatoriosEnviadosTable.actualizadoEn,
    fallbackListoEn: recordatoriosEnviadosTable.fallbackListoEn,
    fallbackWaUrl: recordatoriosEnviadosTable.fallbackWaUrl,
    fallbackMensaje: recordatoriosEnviadosTable.fallbackMensaje,
    cliente: cobrosTable.clienteNombre,
  }).from(recordatoriosEnviadosTable)
    .innerJoin(cobrosTable, eq(cobrosTable.id, recordatoriosEnviadosTable.cobroId))
    .where(and(
      eq(cobrosTable.responsableId, userId),
      or(
        eq(recordatoriosEnviadosTable.estado, "enviado"),
        isNotNull(recordatoriosEnviadosTable.fallbackListoEn),
      ),
      desde ? gte(recordatoriosEnviadosTable.actualizadoEn, desde) : undefined,
    ));
  for (const r of recordatorios) {
    if (r.estado === "enviado") {
      creadas += Number(await crearNotificacion({
        eventKey: `recordatorio:${r.id}:enviado`, userId, cobroId: r.cobroId, tipo: "recordatorio",
        titulo: `📧 Recordatorio enviado a ${r.cliente || "Cliente"}`,
        mensaje: `Se envió un recordatorio por ${r.canal}.`,
        creadoEn: r.actualizadoEn,
      }));
    } else if (r.fallbackListoEn && r.fallbackWaUrl && r.fallbackMensaje) {
      creadas += Number(await crearNotificacion({
        eventKey: `recordatorio:${r.id}:listo`,
        userId,
        cobroId: r.cobroId,
        tipo: "whatsapp",
        titulo: `WhatsApp listo para enviar a ${r.cliente || "cliente"}`,
        mensaje: r.fallbackMensaje,
        waUrl: r.fallbackWaUrl,
        creadoEn: r.fallbackListoEn,
      }));
    }
  }
  const workflows = await db.select({
    id: workflowEjecucionesTable.id, cobroId: workflowEjecucionesTable.cobroId,
    accion: workflowEjecucionesTable.accionTipo,
    creadoEn: workflowEjecucionesTable.creadoEn,
    actualizadoEn: workflowEjecucionesTable.actualizadoEn,
    resultado: workflowEjecucionesTable.resultado,
    stepId: workflowEjecucionesTable.stepId,
    responsableId: cobrosTable.responsableId,
    cliente: cobrosTable.clienteNombre,
  }).from(workflowEjecucionesTable)
    .innerJoin(cobrosTable, eq(cobrosTable.id, workflowEjecucionesTable.cobroId))
    .where(and(
      or(
        eq(cobrosTable.responsableId, userId),
        sql`exists (
          select 1
          from jsonb_array_elements(
            coalesce(${workflowEjecucionesTable.resultado}->'notificaciones', '[]'::jsonb)
          ) as notification
          where notification->>'userId' = ${userId}
        )`,
      ),
      eq(workflowEjecucionesTable.estado, "enviado"),
      desde ? gte(workflowEjecucionesTable.actualizadoEn, desde) : undefined,
    ));
  for (const w of workflows) {
    const notificaciones = w.resultado && typeof w.resultado === "object"
      ? (w.resultado as { notificaciones?: unknown }).notificaciones
      : null;
    if (!Array.isArray(notificaciones)) {
      if (w.responsableId === userId) {
        creadas += Number(await crearNotificacion({
          eventKey: `workflow:${w.id}:exitoso`,
          userId,
          cobroId: w.cobroId,
          tipo: "workflow",
          titulo: `⚡ Workflow ejecutó acción para ${w.cliente || "Cliente"}`,
          mensaje: `El workflow ejecutó: ${w.accion}.`,
          creadoEn: w.actualizadoEn,
        }));
      }
      continue;
    }
    for (const notification of notificaciones) {
      if (
        !notification ||
        typeof notification !== "object" ||
        typeof notification.eventKey !== "string" ||
        notification.userId !== userId ||
        typeof notification.cobroId !== "number" ||
        typeof notification.tipo !== "string" ||
        typeof notification.titulo !== "string"
      ) continue;
      creadas += Number(await crearNotificacion({
        eventKey: notification.eventKey,
        userId,
        cobroId: notification.cobroId,
        tipo: notification.tipo,
        titulo: notification.titulo,
        mensaje: typeof notification.mensaje === "string" ? notification.mensaje : null,
        waUrl: typeof notification.waUrl === "string" ? notification.waUrl : null,
        creadoEn: w.actualizadoEn,
      }));
    }
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  if (user) {
    const acceptedInvitations = await db
      .select()
      .from(invitacionesTable)
      .where(and(
        eq(invitacionesTable.estado, "aceptada"),
        desde ? gte(invitacionesTable.aceptadaEn, desde) : undefined,
        or(
          eq(invitacionesTable.invitadoPorId, userId),
          user.organizationId != null && user.orgRole === "admin_org" && user.activo
            ? and(
                isNull(invitacionesTable.invitadoPorId),
                eq(invitacionesTable.organizationId, user.organizationId),
              )
            : sql`false`,
        ),
      ));
    for (const invitation of acceptedInvitations) {
      const [acceptedUser] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(and(
          eq(usersTable.organizationId, invitation.organizationId),
          sql`lower(${usersTable.email}) = lower(${invitation.email})`,
        ))
        .limit(1);
      const acceptedName = [acceptedUser?.firstName, acceptedUser?.lastName].filter(Boolean).join(" ")
        || invitation.email;
      creadas += Number(await crearNotificacion({
        eventKey: `invitacion:${invitation.id}:aceptada`,
        userId,
        tipo: "equipo",
        titulo: `👤 ${acceptedName} se unió a tu equipo`,
        creadoEn: invitation.aceptadaEn ?? invitation.creadoEn,
      }));
    }
  }

  if (user && !user.esDemo && user.subscriptionStatus === "prueba" && user.trialEndsAt) {
    for (const days of [7, 2]) {
      const milestoneAt = new Date(user.trialEndsAt.getTime() - days * 86400000);
      if (milestoneAt.getTime() > Date.now()) continue;
      if (desde && milestoneAt.getTime() < desde.getTime()) continue;
      creadas += Number(await crearNotificacion({
        eventKey: `trial:${user.id}:faltan:${days}`, userId, tipo: "trial",
        titulo: days === 7 ? "Tu prueba termina en 7 días" : "Tu prueba termina en 2 días",
        mensaje: "Activa tu suscripción para seguir usando NextCob.",
        creadoEn: milestoneAt,
      }));
    }
  }
  return creadas;
}

const backfillsEnCurso = new Map<string, Promise<void>>();

/**
 * Claim a user's incremental historical scan without blocking their inbox.
 * A crashed scan becomes claimable again after 15 minutes. Successful scans
 * retain their start time as a watermark, so events committed during a scan
 * are safely picked up by the next pass.
 */
async function ejecutarBackfillNotificacionesUsuario(userId: string): Promise<void> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const claim = await db
    .insert(notificacionBackfillsTable)
    .values({ userId, intentoEn: now })
    .onConflictDoUpdate({
      target: notificacionBackfillsTable.userId,
      set: { intentoEn: now },
      setWhere: lt(notificacionBackfillsTable.intentoEn, staleBefore),
    })
    .returning({
      userId: notificacionBackfillsTable.userId,
      completadoEn: notificacionBackfillsTable.completadoEn,
    });
  if (!claim.length) return;
  await backfillNotificacionesUsuario(userId, claim[0].completadoEn ?? undefined);
  await db
    .update(notificacionBackfillsTable)
    .set({ completadoEn: now })
    .where(eq(notificacionBackfillsTable.userId, userId));
}

export function programarBackfillNotificacionesUsuario(userId: string): Promise<void> {
  const existing = backfillsEnCurso.get(userId);
  if (existing) return existing;
  const job = ejecutarBackfillNotificacionesUsuario(userId).finally(() => {
    backfillsEnCurso.delete(userId);
  });
  backfillsEnCurso.set(userId, job);
  return job;
}

export async function marcarTodasNotificacionesLeidas(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const now = new Date();
    await tx
      .insert(notificacionLecturasTable)
      .values({ userId, leidoHastaEn: now })
      .onConflictDoUpdate({
        target: notificacionLecturasTable.userId,
        set: { leidoHastaEn: now },
      });
    await tx
      .update(notificacionesTable)
      .set({ leida: true })
      .where(and(
        eq(notificacionesTable.userId, userId),
        eq(notificacionesTable.leida, false),
      ));
  });
}

/** Daily durable due-date sweep; only live, unpaid charges are considered. */
export async function procesarVencimientosNotificaciones(hoy: string): Promise<void> {
  const cobros = await db.select().from(cobrosTable).where(inArray(cobrosTable.estado, ["pendiente", "parcial"]));
  for (const cobro of cobros) {
    if (!cobro.responsableId || !cobro.fechaVencimiento) continue;
    const days = Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${cobro.fechaVencimiento}T00:00:00Z`)) / 86400000);
    if (days < 0) continue;
    const monto = formatoClp(Number(cobro.monto) - Number(cobro.montoDescuento ?? 0));
    const cliente = cobro.clienteNombre || "Cliente";
    for (const milestone of days >= 7 ? [0, 7] : [0]) {
      await crearNotificacion({
        eventKey: `cobro:${cobro.id}:vencido:${milestone}`,
        userId: cobro.responsableId,
        cobroId: cobro.id,
        tipo: "vencimiento",
          titulo: milestone === 0
          ? (days === 0 ? `⏰ El cobro de ${cliente} venció hoy` : `⏰ Venció el cobro de ${cliente}`)
          : `🔴 ${cliente} lleva 7 días sin pagar ${monto}`,
        creadoEn: new Date(Date.parse(`${cobro.fechaVencimiento}T12:00:00Z`) + milestone * 86400000),
      });
    }
  }
}

export async function procesarAvisosTrial(): Promise<void> {
  const users = await db.select().from(usersTable)
    .where(and(eq(usersTable.subscriptionStatus, "prueba"), eq(usersTable.esDemo, false)));
  for (const user of users) {
    if (!user.trialEndsAt) continue;
    for (const days of [7, 2]) {
      const milestoneAt = new Date(user.trialEndsAt.getTime() - days * 86400000);
      if (milestoneAt.getTime() > Date.now()) continue;
      await crearNotificacion({
        eventKey: `trial:${user.id}:faltan:${days}`,
        userId: user.id,
        tipo: "trial",
        titulo: days === 7 ? "Tu prueba termina en 7 días" : "Tu prueba termina en 2 días",
        mensaje: "Activa tu suscripción para seguir usando NextCob.",
        creadoEn: milestoneAt,
      });
    }
  }
}

export async function notificarInvitacionAceptada(input: {
  invitacionId: number;
  invitadoPorId: string | null;
  organizationId: number;
  aceptadaEn: Date;
  nombreAceptante: string;
}): Promise<void> {
  const destinatarios = input.invitadoPorId
    ? [input.invitadoPorId]
    : (await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          eq(usersTable.organizationId, input.organizationId),
          eq(usersTable.orgRole, "admin_org"),
          eq(usersTable.activo, true),
        )))
        .map((user) => user.id);
  await Promise.all(destinatarios.map((userId) => crearNotificacion({
    eventKey: `invitacion:${input.invitacionId}:aceptada`,
    userId,
    tipo: "equipo",
    titulo: `👤 ${input.nombreAceptante} se unió a tu equipo`,
    creadoEn: input.aceptadaEn,
  })));
}