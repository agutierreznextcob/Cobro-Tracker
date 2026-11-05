import {
  db,
  cobrosRecurrentesTable,
  cobrosTable,
  clientesTable,
  organizacionesTable,
  appConfigTable,
  recordatoriosTable,
  cobroEntregasInicialesTable,
  seguimientosCobranzaTable,
  type CobroRecurrente,
} from "@workspace/db";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { fechaHoySantiago } from "./recordatorios";
import { getPlanEfectivoDeOrg } from "../middlewares/requirePlanFeature";
import { planIncluye } from "./plans";
import { userHasAccess } from "./subscription";
import { asegurarLinkPagoCobro } from "./cobro-payment-link";
import { getRemitenteContacto } from "./org";
import { sendPaymentLinkEmail } from "./email";
import { isWhatsAppConfigured, sanitizePhone, sendWhatsAppMensaje } from "./whatsapp";
import { crearNotificacion } from "./notificaciones-service";

export type FrecuenciaRecurrente = CobroRecurrente["frecuencia"];

export function sumarFrecuencia(fecha: string, frecuencia: FrecuenciaRecurrente): string {
  const [year, month, day] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (frecuencia === "semanal") d.setUTCDate(d.getUTCDate() + 7);
  if (frecuencia === "quincenal") d.setUTCDate(d.getUTCDate() + 15);
  if (frecuencia === "mensual") d.setUTCMonth(d.getUTCMonth() + 1);
  if (frecuencia === "bimestral") d.setUTCMonth(d.getUTCMonth() + 2);
  if (frecuencia === "trimestral") d.setUTCMonth(d.getUTCMonth() + 3);
  if (frecuencia === "anual") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Calendar addition anchored to the original day. Jan-31 monthly -> Feb-28
 * -> Mar-31, rather than Date#setMonth's overflow/drift. */
export function fechaCicloAnclada(inicio: string, frecuencia: FrecuenciaRecurrente, ciclo: number): string {
  const [year, month, day] = inicio.split("-").map(Number);
  const dias = frecuencia === "semanal" ? ciclo * 7 : frecuencia === "quincenal" ? ciclo * 15 : 0;
  if (dias) return new Date(Date.UTC(year, month - 1, day + dias)).toISOString().slice(0, 10);
  const periodos = frecuencia === "mensual" ? ciclo : frecuencia === "bimestral" ? ciclo * 2 : frecuencia === "trimestral" ? ciclo * 3 : ciclo * 12;
  const absoluteMonth = (month - 1) + periodos;
  const y = year + Math.floor(absoluteMonth / 12);
  const m = ((absoluteMonth % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, ultimoDia))).toISOString().slice(0, 10);
}

function templateValues(s: CobroRecurrente, fechaVencimiento: string) {
  return {
    decimales: s.decimales,
    itemsInventario: s.itemsInventario,
    monto: s.monto,
    montoNeto: s.montoNeto,
    montoIva: s.montoIva,
    incluyeIva: s.incluyeIva,
    tipoDocumento: s.tipoDocumento as any,
    descripcion: s.descripcion,
    referencia: s.referencia,
    estado: "pendiente" as const,
    organizationId: s.organizationId,
    responsableId: s.responsableId,
    responsableNombre: s.responsableNombre,
    clienteId: s.clienteId,
    clienteNombre: s.clienteNombre,
    emailPagador: s.emailPagador,
    fechaVencimiento,
    recurrenteProgramacionId: s.id,
    workflowId: s.automatizacion === "workflow" ? s.workflowId : null,
  };
}

async function aplicarAutomatizacionTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], cobroId: number, s: CobroRecurrente) {
  if (s.automatizacion !== "simple" || !s.recordatoriosSnapshot?.length) return;
  await tx.insert(recordatoriosTable).values(s.recordatoriosSnapshot.map((r) => ({
    cobroId, canal: r.canal, momento: r.momento, diasOffset: r.diasOffset, activo: r.activo,
  })));
}

async function recurrenteTieneAcceso(s: CobroRecurrente): Promise<boolean> {
  // A schedule must stop when the owner no longer has active access. For
  // standalone legacy schedules, the responsible account is the owner.
  if (s.organizationId == null) return userHasAccess(s.responsableId);
  const [org] = await db.select({ ownerId: organizacionesTable.ownerId })
    .from(organizacionesTable).where(eq(organizacionesTable.id, s.organizationId));
  if (!org || !(await userHasAccess(org.ownerId))) return false;
  const plan = await getPlanEfectivoDeOrg(s.organizationId);
  return plan != null && planIncluye(plan, "cobros_recurrentes");
}

/**
 * Processes a bounded page of schedules. `FOR UPDATE` on each schedule plus
 * the `(programacion, fecha_ciclo)` unique key is the durable serialization
 * point. Repeated sweeps catch up every missed period without unbounded work.
 */
export async function procesarCobrosRecurrentes(
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
  hoy = fechaHoySantiago(),
): Promise<{ generados: number; revisados: number; pendientes: boolean }> {
  const PAGE_SIZE = 100;
  const MAX_CICLOS_POR_SCHEDULE = 24;
  const CURSOR_KEY = "scheduler:cobros-recurrentes:due-cursor";
  const [cursorRow] = await db.select({ valor: appConfigTable.valor })
    .from(appConfigTable).where(eq(appConfigTable.clave, CURSOR_KEY));
  const cursor = Math.max(0, Number(cursorRow?.valor ?? "0") || 0);
  const dueCondition = and(eq(cobrosRecurrentesTable.activo, true), lte(cobrosRecurrentesTable.proximaGeneracion, hoy));
  let candidates = await db
    .select({ id: cobrosRecurrentesTable.id })
    .from(cobrosRecurrentesTable)
    .where(cursor ? and(dueCondition, gt(cobrosRecurrentesTable.id, cursor)) : dueCondition)
    .orderBy(asc(cobrosRecurrentesTable.id))
    .limit(PAGE_SIZE);
  // A durable, rotating keyset cursor means a page full of paused/downgraded
  // schedules cannot permanently hide later eligible schedules. Wrap only
  // after reaching the end; work remains bounded to one page per tick.
  if (!candidates.length && cursor) {
    candidates = await db.select({ id: cobrosRecurrentesTable.id })
      .from(cobrosRecurrentesTable).where(dueCondition)
      .orderBy(asc(cobrosRecurrentesTable.id))
      .limit(PAGE_SIZE);
  }
  const nextCursor = candidates.length ? candidates[candidates.length - 1].id : 0;
  await db.insert(appConfigTable).values({ clave: CURSOR_KEY, valor: String(nextCursor), actualizadoEn: new Date() })
    .onConflictDoUpdate({ target: appConfigTable.clave, set: { valor: String(nextCursor), actualizadoEn: new Date() } });
  let generados = 0;
  let pendientes = candidates.length === PAGE_SIZE;

  for (const candidate of candidates) {
    try {
      const emitted = await db.transaction(async (tx) => {
        const [s] = await tx.select().from(cobrosRecurrentesTable)
          .where(eq(cobrosRecurrentesTable.id, candidate.id)).for("update");
        if (!s || !s.activo || s.proximaGeneracion > hoy) return null;
        if (s.fechaTermino && s.proximaGeneracion > s.fechaTermino) {
          await tx.update(cobrosRecurrentesTable).set({ activo: false, actualizadoEn: new Date() })
            .where(eq(cobrosRecurrentesTable.id, s.id));
          return null;
        }
        if (!(await recurrenteTieneAcceso(s))) return null;
        const cobros = [];
        let ciclo = s.ciclo;
        let generacion = s.proximaGeneracion;
        while (generacion <= hoy && (!s.fechaTermino || generacion <= s.fechaTermino) && cobros.length < MAX_CICLOS_POR_SCHEDULE) {
          const vencimiento = fechaCicloAnclada(s.fechaInicio, s.frecuencia, ciclo + 1);
          const [cobro] = await tx.insert(cobrosTable)
            .values({ ...templateValues(s, vencimiento), recurrenteFechaCiclo: generacion }).returning();
          await aplicarAutomatizacionTx(tx, cobro.id, s);
          if (s.canalesIniciales?.length) {
            await tx.insert(cobroEntregasInicialesTable).values(
              s.canalesIniciales.map((canal) => ({ cobroId: cobro.id, canal })),
            );
          }
          cobros.push(cobro);
          ciclo += 1;
          generacion = fechaCicloAnclada(s.fechaInicio, s.frecuencia, ciclo);
        }
        const remainsDue = generacion <= hoy && (!s.fechaTermino || generacion <= s.fechaTermino);
        if (remainsDue) pendientes = true;
        await tx.update(cobrosRecurrentesTable).set({
          proximaGeneracion: generacion,
          ciclo,
          activo: !s.fechaTermino || generacion <= s.fechaTermino,
          actualizadoEn: new Date(),
        }).where(eq(cobrosRecurrentesTable.id, s.id));
        return cobros;
      });
      if (emitted?.length) {
        generados += emitted.length;
        // A recurring child must always receive its own provider/portal link,
        // even when no initial channel was selected (it can later be opened
        // from the portal or used by a reminder).
        for (const cobro of emitted) {
          try {
            await asegurarLinkPagoCobro(cobro, log);
          } catch (err) {
            log.warn({ err, cobroId: cobro.id }, "No se pudo provisionar link de cobro recurrente");
          }
        }
      }
    } catch (err) {
      log.warn({ err, recurrenteId: candidate.id }, "No se pudo generar cobro recurrente");
    }
  }
  log.info({ hoy, revisados: candidates.length, generados, pendientes }, "Cobros recurrentes procesados");
  return { generados, revisados: candidates.length, pendientes };
}

/** Deliver committed initial notices from the recurring outbox. A failed
 * provider/look-up leaves the row pending; sent/manual rows are never replayed. */
export async function procesarEntregasIniciales(
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
  limite = 100,
): Promise<number> {
  const pendientes = await db.select().from(cobroEntregasInicialesTable)
    .where(and(
      eq(cobroEntregasInicialesTable.estado, "pendiente"),
      or(isNull(cobroEntregasInicialesTable.proximoIntentoEn), lte(cobroEntregasInicialesTable.proximoIntentoEn, new Date())),
    ))
    .orderBy(asc(cobroEntregasInicialesTable.id)).limit(limite);
  let procesadas = 0;
  for (const entrega of pendientes) {
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(cobroEntregasInicialesTable)
          .where(eq(cobroEntregasInicialesTable.id, entrega.id)).for("update");
        if (!locked || locked.estado !== "pendiente") return;
        const [cobro] = await tx.select().from(cobrosTable).where(eq(cobrosTable.id, locked.cobroId));
        if (!cobro) return;
        let estado: "enviado" | "pendiente_manual" | "pendiente" | "fallido" = "pendiente";
        let detalle: string | null = null;
        // Never notify a debtor about a terminal charge. For a recurring
        // source, retain paused/downgraded schedules but do not let them
        // monopolize outbox retries while the owner has no active access.
        if (["pagado", "cancelado", "fallido"].includes(cobro.estado)) {
          estado = "fallido";
          detalle = "El cobro ya no está pendiente.";
        }
        if (estado === "pendiente" && cobro.recurrenteProgramacionId) {
          const [schedule] = await tx.select().from(cobrosRecurrentesTable)
            .where(eq(cobrosRecurrentesTable.id, cobro.recurrenteProgramacionId));
          if (!schedule || !(await recurrenteTieneAcceso(schedule))) {
            estado = "fallido";
            detalle = "La programación ya no tiene acceso activo.";
          }
        }
        let fallbackWaUrl: string | null = null;
        let fallbackMensaje: string | null = null;
        if (estado !== "pendiente") {
          await tx.update(cobroEntregasInicialesTable).set({
            estado, intentos: locked.intentos + 1, ultimoError: detalle,
            proximoIntentoEn: null, actualizadoEn: new Date(),
          }).where(eq(cobroEntregasInicialesTable.id, locked.id));
          await tx.insert(seguimientosCobranzaTable).values({ cobroId: cobro.id, tipo: locked.canal, notas: `Aviso inicial recurrente no enviado: ${detalle}` });
          procesadas++;
          return;
        }
        const prepared = await asegurarLinkPagoCobro(cobro, log);
        const linkPago = prepared.linkPago ?? prepared.portalUrl;
        if (locked.canal === "email") {
          if (!prepared.cobro.emailPagador) {
            estado = "fallido";
            detalle = "Sin email del pagador.";
          }
          else {
            const remitente = await getRemitenteContacto(prepared.cobro.responsableId);
            const r = await sendPaymentLinkEmail({
              cobroId: prepared.cobro.id,
              emailPagador: prepared.cobro.emailPagador, clienteNombre: prepared.cobro.clienteNombre,
              descripcion: prepared.cobro.descripcion,
              monto: Number(prepared.cobro.monto) - Number(prepared.cobro.montoDescuento ?? 0),
              linkPago, comercioNombre: prepared.cobro.responsableNombre || "NextCob",
              remitenteNombre: remitente.nombre || prepared.cobro.responsableNombre, remitenteEmail: remitente.email,
            }, log);
            estado = r.ok ? "enviado" : "pendiente";
            detalle = r.error ?? null;
          }
        } else if (!linkPago) {
          detalle = "No se pudo preparar un enlace de pago.";
        } else {
          const [cliente] = prepared.cobro.clienteId
            ? await tx.select({ telefono: clientesTable.telefono }).from(clientesTable).where(eq(clientesTable.id, prepared.cobro.clienteId))
            : [undefined];
          if (!cliente?.telefono || !sanitizePhone(cliente.telefono)) {
            estado = "fallido";
            detalle = "Sin teléfono válido.";
          }
          else {
            const mensaje = `Hola ${prepared.cobro.clienteNombre || "cliente"}, tienes un cobro pendiente. Puedes pagar aquí: ${linkPago}`;
            if (!isWhatsAppConfigured()) {
              estado = "pendiente_manual";
              fallbackMensaje = mensaje;
              fallbackWaUrl = `https://wa.me/${sanitizePhone(cliente.telefono)}?text=${encodeURIComponent(mensaje)}`;
            }
            else {
              const r = await sendWhatsAppMensaje({ telefono: cliente.telefono, mensaje }, log);
              estado = r.ok ? "enviado" : "pendiente";
              detalle = r.error ?? null;
            }
          }
        }
        const intentos = locked.intentos + 1;
        if (estado === "pendiente" && intentos >= 5) estado = "fallido";
        const proximoIntentoEn = estado === "pendiente"
          ? new Date(Date.now() + Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.min(intentos, 6)))
          : null;
        await tx.update(cobroEntregasInicialesTable).set({
          estado, intentos, ultimoError: detalle, proximoIntentoEn,
          fallbackWaUrl, fallbackMensaje, actualizadoEn: new Date(),
        }).where(eq(cobroEntregasInicialesTable.id, locked.id));
        await tx.insert(seguimientosCobranzaTable).values({
          cobroId: prepared.cobro.id, tipo: locked.canal,
          notas: estado === "enviado" ? "Aviso inicial recurrente enviado" : estado === "pendiente_manual" ? "Aviso inicial recurrente listo para envío manual" : `Aviso inicial recurrente fallido: ${detalle ?? "sin detalle"}`,
        });
        if (estado === "pendiente_manual" && prepared.cobro.responsableId && fallbackWaUrl) {
          await crearNotificacion({
            eventKey: `cobro-entrega-inicial:${locked.id}:manual`,
            userId: prepared.cobro.responsableId, cobroId: prepared.cobro.id,
            tipo: "recordatorio", titulo: `WhatsApp listo para ${prepared.cobro.clienteNombre || "cliente"}`,
            mensaje: fallbackMensaje, waUrl: fallbackWaUrl,
          });
        }
        procesadas++;
      });
    } catch (err) {
      log.warn({ err, entregaId: entrega.id }, "No se pudo entregar aviso inicial recurrente");
    }
  }
  return procesadas;
}

export async function clienteDeSchedule(clienteId: number) {
  const [cliente] = await db.select().from(clientesTable).where(eq(clientesTable.id, clienteId));
  return cliente ?? null;
}