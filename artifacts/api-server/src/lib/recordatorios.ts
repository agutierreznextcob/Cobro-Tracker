import {
  db,
  cobrosTable,
  clientesTable,
  recordatoriosTable,
  recordatoriosDefaultTable,
  recordatoriosEnviadosTable,
  notificacionesTable,
  type RecordatorioDefault,
} from "@workspace/db";
import { and, eq, isNotNull, inArray } from "drizzle-orm";
import { sendSecuenciaRecordatorioEmail } from "./email";
import { getRemitenteContacto } from "./org";
import { isWhatsAppConfigured, sanitizePhone, sendWhatsAppMensaje } from "./whatsapp";

type Canal = "email" | "whatsapp" | "ambos";
type Momento = "antes" | "dia" | "despues" | "recurrente";

interface RunLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface RecordatoriosRunResult {
  ok: boolean;
  fecha: string;
  emailsEnviados: number;
  whatsappsEnviados: number;
  notificacionesCreadas: number;
  errores: number;
}

// --- Date helpers (calendar-only, América/Santiago) ---

export function fechaHoySantiago(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}

function parseYMD(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** a - b en días (a, b son YYYY-MM-DD) */
function diffDays(a: string, b: string): number {
  return Math.round((parseYMD(a) - parseYMD(b)) / 86_400_000);
}

function esDueHoy(momento: Momento, diasOffset: number, vencimiento: string, hoy: string): boolean {
  const diff = diffDays(hoy, vencimiento); // positivo = ya vencido
  switch (momento) {
    case "antes":
      return diasOffset > 0 && diff === -diasOffset;
    case "dia":
      return diff === 0;
    case "despues":
      return diasOffset > 0 && diff === diasOffset;
    case "recurrente":
      // Empieza estrictamente DESPUÉS del primer ciclo (p. ej. con 7 → día 14, 21…)
      // para no duplicar un "despues" que caiga el mismo día (día 7).
      return diasOffset > 0 && diff > diasOffset && diff % diasOffset === 0;
    default:
      return false;
  }
}

// --- WhatsApp helpers ---

function buildWaMensaje(cobro: typeof cobrosTable.$inferSelect, linkPago: string | null): string {
  const nombre = cobro.clienteNombre || "cliente";
  const monto = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(Number(cobro.monto)));
  let msg = `Hola ${nombre}, tienes un cobro pendiente de ${monto} por concepto de "${cobro.descripcion}".`;
  if (linkPago) msg += ` Puedes pagar aquí: ${linkPago}`;
  else msg += ` Por favor comunícate para coordinar el pago.`;
  return msg;
}

function buildWaUrl(telefono: string | null, mensaje: string): string {
  const base = telefono ? `https://wa.me/${sanitizePhone(telefono)}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(mensaje)}`;
}

// --- Default sequence (per-user editable template) ---

const SISTEMA_DEFAULT: Array<{ canal: Canal; momento: Momento; diasOffset: number }> = [
  { canal: "email", momento: "despues", diasOffset: 1 },
  { canal: "email", momento: "despues", diasOffset: 3 },
  { canal: "email", momento: "despues", diasOffset: 7 },
  { canal: "email", momento: "recurrente", diasOffset: 7 },
];

/** Devuelve la secuencia por defecto del usuario, creándola con la plantilla del sistema si no existe. */
export async function ensureUserDefaults(userId: string): Promise<RecordatorioDefault[]> {
  const existing = await db
    .select()
    .from(recordatoriosDefaultTable)
    .where(eq(recordatoriosDefaultTable.userId, userId))
    .orderBy(recordatoriosDefaultTable.orden);
  if (existing.length > 0) return existing;

  await db.insert(recordatoriosDefaultTable).values(
    SISTEMA_DEFAULT.map((r, i) => ({
      userId,
      canal: r.canal,
      momento: r.momento,
      diasOffset: r.diasOffset,
      activo: true,
      orden: i,
    })),
  );

  return db
    .select()
    .from(recordatoriosDefaultTable)
    .where(eq(recordatoriosDefaultTable.userId, userId))
    .orderBy(recordatoriosDefaultTable.orden);
}

/** Copia la secuencia por defecto del usuario sobre un cobro que aún no tiene reglas. */
export async function aplicarDefaultsACobro(cobroId: number, userId: string): Promise<void> {
  const yaTiene = await db
    .select({ id: recordatoriosTable.id })
    .from(recordatoriosTable)
    .where(eq(recordatoriosTable.cobroId, cobroId))
    .limit(1);
  if (yaTiene.length > 0) return;

  const defaults = await ensureUserDefaults(userId);
  if (defaults.length === 0) return;

  await db.insert(recordatoriosTable).values(
    defaults.map((d) => ({
      cobroId,
      canal: d.canal,
      momento: d.momento,
      diasOffset: d.diasOffset,
      activo: d.activo,
    })),
  );
}

// --- The engine ---

// Atomically claim the right to send for (cobro, regla, canal, día). Relies on the
// unique index ux_recordatorios_enviados_dia to make concurrent runs race-safe.
// Returns the row id when the caller wins the claim, or null if another run already
// sent it (estado enviado/pendiente). A previous "fallido" can be re-claimed for retry.
async function claimEnvio(
  cobroId: number,
  recordatorioId: number,
  canal: "email" | "whatsapp",
  fecha: string,
): Promise<number | null> {
  const inserted = await db
    .insert(recordatoriosEnviadosTable)
    .values({ cobroId, recordatorioId, canal, estado: "pendiente", detalle: null, fecha })
    .onConflictDoNothing()
    .returning({ id: recordatoriosEnviadosTable.id });
  if (inserted.length > 0) return inserted[0].id;

  // A row already exists. Only re-claim if the prior attempt failed.
  const reclaimed = await db
    .update(recordatoriosEnviadosTable)
    .set({ estado: "pendiente", detalle: null, creadoEn: new Date() })
    .where(
      and(
        eq(recordatoriosEnviadosTable.cobroId, cobroId),
        eq(recordatoriosEnviadosTable.recordatorioId, recordatorioId),
        eq(recordatoriosEnviadosTable.canal, canal),
        eq(recordatoriosEnviadosTable.fecha, fecha),
        eq(recordatoriosEnviadosTable.estado, "fallido"),
      ),
    )
    .returning({ id: recordatoriosEnviadosTable.id });
  return reclaimed.length > 0 ? reclaimed[0].id : null;
}

async function marcarEnvio(
  id: number,
  estado: "enviado" | "fallido" | "pendiente",
  detalle: string | null,
): Promise<void> {
  await db
    .update(recordatoriosEnviadosTable)
    .set({ estado, detalle })
    .where(eq(recordatoriosEnviadosTable.id, id));
}

export async function procesarRecordatorios(
  log: RunLogger,
  todayArg?: string,
): Promise<RecordatoriosRunResult> {
  const hoy = todayArg ?? fechaHoySantiago();
  let emailsEnviados = 0;
  let whatsappsEnviados = 0;
  let notificacionesCreadas = 0;
  let errores = 0;

  const cobros = await db
    .select()
    .from(cobrosTable)
    .where(
      and(
        isNotNull(cobrosTable.fechaVencimiento),
        // Solo cobros vigentes por cobrar: excluye pagado, cancelado y fallido.
        inArray(cobrosTable.estado, ["pendiente", "parcial"]),
      ),
    );

  log.info({ fecha: hoy, cobros: cobros.length }, "Procesando recordatorios del día");

  for (const cobro of cobros) {
    const vencimiento = cobro.fechaVencimiento;
    if (!vencimiento) continue;

    const reglas = await db
      .select()
      .from(recordatoriosTable)
      .where(and(eq(recordatoriosTable.cobroId, cobro.id), eq(recordatoriosTable.activo, true)));

    for (const regla of reglas) {
      if (!esDueHoy(regla.momento as Momento, regla.diasOffset, vencimiento, hoy)) continue;

      const canales: Array<"email" | "whatsapp"> =
        regla.canal === "ambos" ? ["email", "whatsapp"] : [regla.canal as "email" | "whatsapp"];

      for (const canal of canales) {
        // Idempotencia race-safe: reclamar el envío del día. Si otro run ya lo tomó
        // (enviado/pendiente), claimEnvio devuelve null y saltamos.
        const envioId = await claimEnvio(cobro.id, regla.id, canal, hoy);
        if (envioId === null) continue;

        const diasVencido = diffDays(hoy, vencimiento);
        const linkPago = cobro.flowLinkPago || cobro.mpPaymentLinkUrl || null;

        if (canal === "email") {
          if (!cobro.emailPagador) {
            await marcarEnvio(envioId, "fallido", "El cobro no tiene email del pagador.");
            errores++;
            continue;
          }
          const remitente = await getRemitenteContacto(cobro.responsableId);
          const result = await sendSecuenciaRecordatorioEmail(
            {
              emailPagador: cobro.emailPagador,
              clienteNombre: cobro.clienteNombre,
              descripcion: cobro.descripcion,
              monto: Number(cobro.monto),
              comercioNombre: cobro.responsableNombre || "Cobro Simple",
              linkPago,
              diasVencido,
              remitenteNombre: remitente.nombre || cobro.responsableNombre,
              remitenteEmail: remitente.email,
            },
            log,
          );
          if (result.ok) {
            emailsEnviados++;
            await marcarEnvio(envioId, "enviado", null);
          } else {
            errores++;
            await marcarEnvio(envioId, "fallido", result.error ?? "Error al enviar email");
          }
        } else {
          // WhatsApp: envío automático vía proveedor (Cloud API). Si no hay
          // proveedor configurado o falta el teléfono, cae al flujo de
          // notificación in-app "listo para enviar".
          if (!cobro.responsableId) {
            await marcarEnvio(envioId, "fallido", "El cobro no tiene responsable.");
            errores++;
            continue;
          }
          let telefono: string | null = null;
          if (cobro.clienteId) {
            const [cliente] = await db
              .select({ telefono: clientesTable.telefono })
              .from(clientesTable)
              .where(eq(clientesTable.id, cobro.clienteId));
            telefono = cliente?.telefono ?? null;
          }
          const mensaje = buildWaMensaje(cobro, linkPago);

          if (isWhatsAppConfigured() && telefono && sanitizePhone(telefono)) {
            const result = await sendWhatsAppMensaje({ telefono, mensaje }, log);
            if (result.ok) {
              whatsappsEnviados++;
              await marcarEnvio(
                envioId,
                "enviado",
                result.messageId
                  ? `WhatsApp enviado automáticamente (id ${result.messageId}).`
                  : "WhatsApp enviado automáticamente.",
              );
            } else {
              errores++;
              await marcarEnvio(envioId, "fallido", result.error ?? "Error al enviar WhatsApp");
            }
          } else {
            // Fallback: notificación in-app con botón "Abrir WhatsApp".
            const waUrl = buildWaUrl(telefono, mensaje);
            await db.insert(notificacionesTable).values({
              userId: cobro.responsableId,
              cobroId: cobro.id,
              tipo: "whatsapp",
              titulo: `WhatsApp listo para enviar a ${cobro.clienteNombre || "cliente"}`,
              mensaje,
              waUrl,
            });
            notificacionesCreadas++;
            await marcarEnvio(envioId, "pendiente", "WhatsApp listo para enviar.");
          }
        }
      }
    }
  }

  log.info(
    { fecha: hoy, emailsEnviados, whatsappsEnviados, notificacionesCreadas, errores },
    "Recordatorios procesados",
  );

  return { ok: true, fecha: hoy, emailsEnviados, whatsappsEnviados, notificacionesCreadas, errores };
}
