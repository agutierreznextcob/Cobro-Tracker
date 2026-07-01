import {
  db,
  cobrosTable,
  clientesTable,
  usersTable,
  notificacionesTable,
  tareasTable,
  cobroDescuentosTable,
  workflowsTable,
  workflowStepsTable,
  workflowEjecucionesTable,
  type Workflow,
  type WorkflowStep,
  type WorkflowCondiciones,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { sendWorkflowEmail, sendSecuenciaRecordatorioEmail } from "./email";
import { getRemitenteContacto, cobroScopeCondition, type OrgContext } from "./org";
import { isWhatsAppConfigured, sanitizePhone, sendWhatsAppMensaje } from "./whatsapp";
import { computeClienteScores } from "./scoring";
import { emitirComprobante } from "./comprobante-service";
import { crearYEnviarEncuesta } from "./encuestas-service";

interface RunLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface WorkflowsRunResult {
  ok: boolean;
  fecha: string;
  cobros: number;
  pasosEjecutados: number;
  errores: number;
}

type Cobro = typeof cobrosTable.$inferSelect;

// --- Date helpers (calendar-only, América/Santiago) ---

function hoySantiago(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}

function parseYMD(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toYMD(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Converts a timestamp (creadoEn/actualizadoEn) to a Santiago calendar date.
function fechaSantiago(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(d);
}

function addDaysYMD(ymd: string, dias: number): string {
  return toYMD(parseYMD(ymd) + dias * 86_400_000);
}

// a - b in days (both YYYY-MM-DD).
function diffDays(a: string, b: string): number {
  return Math.round((parseYMD(a) - parseYMD(b)) / 86_400_000);
}

function montoACobrar(cobro: Pick<Cobro, "monto" | "montoDescuento">): number {
  return Number(cobro.monto) - Number(cobro.montoDescuento ?? 0);
}

// Computes the workflow anchor date (YYYY-MM-DD) for a cobro given the trigger
// config, or null when the trigger cannot apply to this cobro (e.g. a date-based
// trigger on a cobro without fechaVencimiento, or marcado_parcial on a
// non-parcial cobro).
function computeAnchor(
  cobro: Cobro,
  triggerTipo: Workflow["triggerTipo"],
  triggerDias: number,
): string | null {
  const venc = cobro.fechaVencimiento;
  const creado = fechaSantiago(cobro.creadoEn);
  switch (triggerTipo) {
    case "cobro_creado":
      return creado;
    case "proximo_vencer":
      return venc ? addDaysYMD(venc, -triggerDias) : null;
    case "vencido":
      return venc ?? null;
    case "dias_mora":
      return venc ? addDaysYMD(venc, triggerDias) : null;
    case "no_pagado_despues":
      return addDaysYMD(creado, triggerDias);
    case "marcado_parcial":
      return cobro.estado === "parcial" ? fechaSantiago(cobro.actualizadoEn) : null;
    case "email_no_abierto":
      // Best-effort: sin open-tracking real, se ancla en creación + triggerDias.
      return addDaysYMD(creado, triggerDias);
    default:
      return null;
  }
}

// Evaluates optional workflow conditions against a cobro. `scoreCategoria` is the
// precomputed AI category for the cobro's cliente (or null).
function cumpleCondiciones(
  cobro: Cobro,
  cond: WorkflowCondiciones | null | undefined,
  scoreCategoria: string | null,
): boolean {
  if (!cond) return true;
  const aCobrar = montoACobrar(cobro);
  if (cond.montoMin != null && aCobrar < cond.montoMin) return false;
  if (cond.montoMax != null && aCobrar > cond.montoMax) return false;
  if (cond.scores && cond.scores.length > 0) {
    if (!scoreCategoria || !cond.scores.includes(scoreCategoria)) return false;
  }
  if (cond.tiposDocumento && cond.tiposDocumento.length > 0) {
    if (!cobro.tipoDocumento || !cond.tiposDocumento.includes(cobro.tipoDocumento)) return false;
  }
  if (cond.clienteIds && cond.clienteIds.length > 0) {
    if (cobro.clienteId == null || !cond.clienteIds.includes(cobro.clienteId)) return false;
  }
  if (cond.responsableIds && cond.responsableIds.length > 0) {
    if (!cobro.responsableId || !cond.responsableIds.includes(cobro.responsableId)) return false;
  }
  return true;
}

// Loads a workflow with its steps (ordered), or null when missing.
async function fetchWorkflowWithSteps(
  id: number,
): Promise<{ workflow: Workflow; steps: WorkflowStep[] } | null> {
  const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, id));
  if (!workflow) return null;
  const steps = await db
    .select()
    .from(workflowStepsTable)
    .where(eq(workflowStepsTable.workflowId, id));
  steps.sort((a, b) => a.orden - b.orden || a.delayDias - b.delayDias);
  return { workflow, steps };
}

export interface ProximaAccion {
  cobroId: number;
  accionTipo: string;
  fecha: string;
  workflowNombre: string | null;
  clienteNombre: string | null;
  descripcion: string | null;
}

// Computes upcoming (not-yet-executed) workflow steps for a set of cobros,
// ordered by due date. Used by the dashboard. `cobros` should already be scoped
// to what the requesting user may see.
export async function listProximasAcciones(
  cobros: Cobro[],
  limit = 20,
): Promise<ProximaAccion[]> {
  const hoy = hoySantiago();
  const result: ProximaAccion[] = [];
  const cache = new Map<number, { workflow: Workflow; steps: WorkflowStep[] } | null>();

  const cobroIds = cobros.map((c) => c.id);
  const executed = new Set<string>();
  if (cobroIds.length > 0) {
    const rows = await db
      .select({
        cobroId: workflowEjecucionesTable.cobroId,
        stepId: workflowEjecucionesTable.stepId,
      })
      .from(workflowEjecucionesTable)
      .where(inArray(workflowEjecucionesTable.cobroId, cobroIds));
    for (const r of rows) if (r.stepId != null) executed.add(`${r.cobroId}:${r.stepId}`);
  }

  for (const cobro of cobros) {
    if (cobro.workflowId == null) continue;
    let entry = cache.get(cobro.workflowId);
    if (entry === undefined) {
      entry = await fetchWorkflowWithSteps(cobro.workflowId);
      cache.set(cobro.workflowId, entry);
    }
    if (!entry || !entry.workflow.activo) continue;
    const anchor = computeAnchor(cobro, entry.workflow.triggerTipo, entry.workflow.triggerDias);
    if (!anchor) continue;
    for (const step of entry.steps) {
      if (executed.has(`${cobro.id}:${step.id}`)) continue;
      const due = addDaysYMD(anchor, step.delayDias);
      if (diffDays(due, hoy) < 0) continue; // overdue but unrun — omit from "próximas"
      result.push({
        cobroId: cobro.id,
        accionTipo: step.accionTipo,
        fecha: due,
        workflowNombre: entry.workflow.nombre,
        clienteNombre: cobro.clienteNombre,
        descripcion: cobro.descripcion,
      });
    }
  }

  result.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return result.slice(0, limit);
}

interface StepOutcome {
  ok: boolean;
  detalle: string;
  resultado?: unknown;
  pagado?: boolean; // signals the cobro reached "pagado" — stop further steps
}

// Executes a single workflow step's action against a cobro. Never throws.
async function ejecutarAccion(
  cobro: Cobro,
  step: WorkflowStep,
  log: RunLogger,
): Promise<StepOutcome> {
  const cfg = step.config ?? {};
  const linkPago = cobro.flowLinkPago || cobro.mpPaymentLinkUrl || null;

  try {
    switch (step.accionTipo) {
      case "enviar_email": {
        if (!cobro.emailPagador) {
          return { ok: false, detalle: "El cobro no tiene email del pagador." };
        }
        const remitente = await getRemitenteContacto(cobro.responsableId);
        // If the step provides a custom message, use the workflow email; otherwise
        // fall back to the polished sequence-reminder template.
        let result;
        if (cfg.mensaje && cfg.mensaje.trim()) {
          result = await sendWorkflowEmail(
            {
              emailPagador: cobro.emailPagador,
              clienteNombre: cobro.clienteNombre,
              asunto: cfg.asunto || "",
              mensaje: cfg.mensaje,
              monto: montoACobrar(cobro),
              descripcion: cobro.descripcion,
              comercioNombre: cobro.responsableNombre || "NextCob",
              linkPago,
              remitenteNombre: remitente.nombre || cobro.responsableNombre,
              remitenteEmail: remitente.email,
            },
            log,
          );
        } else {
          const diasVencido = cobro.fechaVencimiento
            ? diffDays(hoySantiago(), cobro.fechaVencimiento)
            : 0;
          result = await sendSecuenciaRecordatorioEmail(
            {
              emailPagador: cobro.emailPagador,
              clienteNombre: cobro.clienteNombre,
              descripcion: cobro.descripcion,
              monto: montoACobrar(cobro),
              comercioNombre: cobro.responsableNombre || "NextCob",
              linkPago,
              diasVencido,
              remitenteNombre: remitente.nombre || cobro.responsableNombre,
              remitenteEmail: remitente.email,
            },
            log,
          );
        }
        return result.ok
          ? { ok: true, detalle: "Email enviado." }
          : { ok: false, detalle: result.error ?? "Error al enviar email." };
      }

      case "enviar_whatsapp": {
        if (!cobro.responsableId) {
          return { ok: false, detalle: "El cobro no tiene responsable." };
        }
        let telefono: string | null = null;
        if (cobro.clienteId) {
          const [cliente] = await db
            .select({ telefono: clientesTable.telefono })
            .from(clientesTable)
            .where(eq(clientesTable.id, cobro.clienteId));
          telefono = cliente?.telefono ?? null;
        }
        const monto = new Intl.NumberFormat("es-CL", {
          style: "currency",
          currency: "CLP",
          maximumFractionDigits: 0,
        }).format(Math.round(montoACobrar(cobro)));
        const nombre = cobro.clienteNombre || "cliente";
        let mensaje =
          cfg.mensaje && cfg.mensaje.trim()
            ? cfg.mensaje
            : `Hola ${nombre}, tienes un cobro pendiente de ${monto} por "${cobro.descripcion}".`;
        if (linkPago) mensaje += ` Puedes pagar aquí: ${linkPago}`;

        if (isWhatsAppConfigured() && telefono && sanitizePhone(telefono)) {
          const result = await sendWhatsAppMensaje({ telefono, mensaje }, log);
          return result.ok
            ? {
                ok: true,
                detalle: result.messageId
                  ? `WhatsApp enviado automáticamente (id ${result.messageId}).`
                  : "WhatsApp enviado automáticamente.",
              }
            : { ok: false, detalle: result.error ?? "Error al enviar WhatsApp." };
        }
        // Fallback: notificación in-app "listo para enviar".
        const base = telefono ? `https://wa.me/${sanitizePhone(telefono)}` : `https://wa.me/`;
        const waUrl = `${base}?text=${encodeURIComponent(mensaje)}`;
        await db.insert(notificacionesTable).values({
          userId: cobro.responsableId,
          cobroId: cobro.id,
          tipo: "whatsapp",
          titulo: `WhatsApp listo para enviar a ${nombre}`,
          mensaje,
          waUrl,
        });
        return { ok: true, detalle: "WhatsApp en notificación in-app (listo para enviar)." };
      }

      case "crear_tarea": {
        if (!cobro.responsableId) {
          return { ok: false, detalle: "El cobro no tiene responsable para asignar la tarea." };
        }
        const titulo =
          cfg.tareaTitulo?.trim() ||
          `Gestión de cobranza: ${cobro.clienteNombre || cobro.descripcion}`;
        const [tarea] = await db
          .insert(tareasTable)
          .values({
            organizationId: cobro.organizationId ?? null,
            userId: cobro.responsableId,
            cobroId: cobro.id,
            titulo,
            origen: "workflow",
          })
          .returning({ id: tareasTable.id });
        return { ok: true, detalle: `Tarea creada (#${tarea?.id}).`, resultado: { tareaId: tarea?.id } };
      }

      case "notificar_admin": {
        // Notify org admins; if there's no organization, fall back to the responsable.
        let destinatarios: string[] = [];
        if (cobro.organizationId != null) {
          const admins = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(
              and(
                eq(usersTable.organizationId, cobro.organizationId),
                eq(usersTable.orgRole, "admin_org"),
                eq(usersTable.activo, true),
              ),
            );
          destinatarios = admins.map((a) => a.id);
        }
        if (destinatarios.length === 0 && cobro.responsableId) {
          destinatarios = [cobro.responsableId];
        }
        if (destinatarios.length === 0) {
          return { ok: false, detalle: "No hay administradores para notificar." };
        }
        const monto = new Intl.NumberFormat("es-CL", {
          style: "currency",
          currency: "CLP",
          maximumFractionDigits: 0,
        }).format(Math.round(montoACobrar(cobro)));
        await db.insert(notificacionesTable).values(
          destinatarios.map((userId) => ({
            userId,
            cobroId: cobro.id,
            tipo: "workflow" as const,
            titulo: `Cobro requiere atención: ${cobro.clienteNombre || cobro.descripcion}`,
            mensaje: `El workflow de cobranza escaló este cobro de ${monto}.`,
          })),
        );
        return { ok: true, detalle: `Administrador(es) notificado(s): ${destinatarios.length}.` };
      }

      case "aplicar_descuento": {
        if (cobro.estado === "pagado" || cobro.estado === "cancelado") {
          return { ok: false, detalle: "No se aplica descuento a un cobro pagado o cancelado." };
        }
        if (Number(cobro.montoDescuento ?? 0) > 0) {
          return { ok: false, detalle: "El cobro ya tiene un descuento aplicado." };
        }
        const tipo = cfg.descuentoTipo ?? "porcentaje";
        const valor = Number(cfg.descuentoValor ?? 0);
        if (valor <= 0) return { ok: false, detalle: "Descuento inválido (valor <= 0)." };
        if (tipo === "porcentaje" && valor > 100) {
          return { ok: false, detalle: "El porcentaje de descuento no puede superar 100." };
        }
        const montoOriginal = Number(cobro.monto);
        const descuentoAbsoluto =
          tipo === "porcentaje"
            ? Math.round((montoOriginal * valor) / 100)
            : Math.round(valor);
        if (descuentoAbsoluto <= 0 || descuentoAbsoluto >= montoOriginal) {
          return { ok: false, detalle: "El descuento resultante es inválido." };
        }
        const montoFinal = montoOriginal - descuentoAbsoluto;
        await db.insert(cobroDescuentosTable).values({
          cobroId: cobro.id,
          // The descuentos table enum is porcentaje|fijo; map the step's "monto" → "fijo".
          tipo: tipo === "porcentaje" ? "porcentaje" : "fijo",
          valor: String(valor),
          montoDescuento: String(descuentoAbsoluto),
          montoOriginal: String(montoOriginal),
          montoFinal: String(montoFinal),
          motivo: "Descuento automático por workflow de cobranza",
          aplicadoPorId: cobro.responsableId ?? null,
          aplicadoPorNombre: "Workflow de cobranza",
        });
        await db
          .update(cobrosTable)
          .set({ montoDescuento: String(descuentoAbsoluto), actualizadoEn: new Date() })
          .where(eq(cobrosTable.id, cobro.id));
        return {
          ok: true,
          detalle: `Descuento aplicado: ${descuentoAbsoluto} (monto final ${montoFinal}).`,
          resultado: { descuentoAbsoluto, montoFinal },
        };
      }

      case "cambiar_estado": {
        const nuevoEstado = cfg.nuevoEstado;
        if (!nuevoEstado) return { ok: false, detalle: "No se configuró un estado destino." };
        await db
          .update(cobrosTable)
          .set({ estado: nuevoEstado, actualizadoEn: new Date() })
          .where(eq(cobrosTable.id, cobro.id));
        if (nuevoEstado === "pagado") {
          void emitirComprobante(cobro.id, { metodo: "manual" }, log);
        }
        return {
          ok: true,
          detalle: `Estado cambiado a ${nuevoEstado}.`,
          pagado: nuevoEstado === "pagado",
        };
      }

      case "enviar_comprobante": {
        void emitirComprobante(cobro.id, { metodo: "manual" }, log);
        return { ok: true, detalle: "Emisión de comprobante solicitada." };
      }

      case "enviar_encuesta": {
        void crearYEnviarEncuesta(cobro.id, log);
        return { ok: true, detalle: "Encuesta de satisfacción solicitada." };
      }

      default:
        return { ok: false, detalle: `Acción no soportada: ${step.accionTipo}` };
    }
  } catch (err) {
    log.error({ err, cobroId: cobro.id, stepId: step.id }, "Error ejecutando acción de workflow");
    return { ok: false, detalle: err instanceof Error ? err.message : "Error interno." };
  }
}

// Processes all cobros that have an assigned collection workflow. Designed to run
// AFTER procesarRecordatorios in the daily scheduler; recordatorios simples skip
// cobros with a workflowId, so the two engines never act on the same cobro.
//
// A step runs ONCE per cobro (idempotency via the unique index on
// workflow_ejecuciones(cobroId, stepId)): we claim by inserting a "pendiente" row
// (onConflictDoNothing), reclaim only rows left "fallido", then stamp the outcome.
export async function procesarWorkflows(log: RunLogger): Promise<WorkflowsRunResult> {
  const hoy = hoySantiago();
  let pasosEjecutados = 0;
  let errores = 0;

  // Only active-by-collection cobros with a workflow assigned. Paid/cancelled/
  // failed cobros are terminal for collections and are excluded.
  const cobros = await db
    .select()
    .from(cobrosTable)
    .where(
      and(
        isNotNull(cobrosTable.workflowId),
        inArray(cobrosTable.estado, ["pendiente", "parcial"]),
      ),
    );

  log.info({ fecha: hoy, cobros: cobros.length }, "Procesando workflows de cobranza");

  // Cache workflows + steps per workflowId to avoid refetching.
  const workflowCache = new Map<number, { workflow: Workflow; steps: WorkflowStep[] } | null>();
  async function loadWorkflow(id: number) {
    if (workflowCache.has(id)) return workflowCache.get(id)!;
    const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, id));
    if (!workflow) {
      workflowCache.set(id, null);
      return null;
    }
    const steps = await db
      .select()
      .from(workflowStepsTable)
      .where(eq(workflowStepsTable.workflowId, id));
    steps.sort((a, b) => a.orden - b.orden || a.delayDias - b.delayDias);
    const entry = { workflow, steps };
    workflowCache.set(id, entry);
    return entry;
  }

  for (const cobro of cobros) {
    if (cobro.workflowId == null) continue;
    const entry = await loadWorkflow(cobro.workflowId);
    if (!entry || !entry.workflow.activo) continue;
    const { workflow, steps } = entry;

    const anchor = computeAnchor(cobro, workflow.triggerTipo, workflow.triggerDias);
    if (!anchor) continue;

    // Evaluate conditions (score computed only when the workflow gates on it).
    let scoreCategoria: string | null = null;
    if (workflow.condiciones?.scores?.length && cobro.clienteId != null) {
      // Score within the responsable/org scope so it matches the app's scoring.
      const ctx: OrgContext = {
        organizationId: cobro.organizationId,
        orgRole: null,
        isOrgAdmin: cobro.organizationId != null,
      };
      const scope = cobro.organizationId != null
        ? eq(cobrosTable.organizationId, cobro.organizationId)
        : cobroScopeCondition(ctx, cobro.responsableId ?? "");
      const scores = await computeClienteScores([cobro.clienteId], scope);
      scoreCategoria = scores.get(cobro.clienteId)?.categoria ?? null;
    }
    if (!cumpleCondiciones(cobro, workflow.condiciones, scoreCategoria)) continue;

    for (const step of steps) {
      const due = addDaysYMD(anchor, step.delayDias);
      if (diffDays(hoy, due) < 0) continue; // not due yet

      // Claim the step: insert pendiente; on conflict it already exists.
      const claimed = await db
        .insert(workflowEjecucionesTable)
        .values({
          cobroId: cobro.id,
          workflowId: workflow.id,
          stepId: step.id,
          accionTipo: step.accionTipo,
          estado: "pendiente",
          fecha: hoy,
        })
        .onConflictDoNothing({
          target: [workflowEjecucionesTable.cobroId, workflowEjecucionesTable.stepId],
        })
        .returning({ id: workflowEjecucionesTable.id });

      let ejecucionId: number;
      if (claimed.length > 0) {
        ejecucionId = claimed[0]!.id;
      } else {
        // Row exists. Reclaim only if it was left "fallido" (retry); otherwise skip.
        const reclaimed = await db
          .update(workflowEjecucionesTable)
          .set({ estado: "pendiente", fecha: hoy })
          .where(
            and(
              eq(workflowEjecucionesTable.cobroId, cobro.id),
              eq(workflowEjecucionesTable.stepId, step.id),
              eq(workflowEjecucionesTable.estado, "fallido"),
            ),
          )
          .returning({ id: workflowEjecucionesTable.id });
        if (reclaimed.length === 0) continue; // already enviado/pendiente
        ejecucionId = reclaimed[0]!.id;
      }

      const outcome = await ejecutarAccion(cobro, step, log);
      await db
        .update(workflowEjecucionesTable)
        .set({
          estado: outcome.ok ? "enviado" : "fallido",
          detalle: outcome.detalle,
          resultado: outcome.resultado ?? null,
        })
        .where(eq(workflowEjecucionesTable.id, ejecucionId));

      if (outcome.ok) pasosEjecutados++;
      else errores++;

      // If the cobro just became paid, stop running further steps for it.
      if (outcome.pagado) break;
    }
  }

  log.info({ fecha: hoy, cobros: cobros.length, pasosEjecutados, errores }, "Workflows procesados");
  return { ok: true, fecha: hoy, cobros: cobros.length, pasosEjecutados, errores };
}
