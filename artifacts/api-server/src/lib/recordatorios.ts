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
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { sendSecuenciaRecordatorioEmail } from "./email";

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
      return diasOffset > 0 && diff > 0 && diff % diasOffset === 0;
    default:
      return false;
  }
}

// --- WhatsApp helpers ---

function sanitizePhone(tel: string): string {
  let d = tel.replace(/\D/g, "");
  if (d.length === 9 && d.startsWith("9")) d = "56" + d;
  else if (d.length === 8) d = "569" + d;
  return d;
}

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

async function logEnviado(
  cobroId: number,
  recordatorioId: number | null,
  canal: "email" | "whatsapp",
  estado: "enviado" | "fallido" | "pendiente",
  detalle: string | null,
  fecha: string,
): Promise<void> {
  await db.insert(recordatoriosEnviadosTable).values({
    cobroId,
    recordatorioId,
    canal,
    estado,
    detalle,
    fecha,
  });
}

export async function procesarRecordatorios(
  log: RunLogger,
  todayArg?: string,
): Promise<RecordatoriosRunResult> {
  const hoy = todayArg ?? fechaHoySantiago();
  let emailsEnviados = 0;
  let notificacionesCreadas = 0;
  let errores = 0;

  const cobros = await db
    .select()
    .from(cobrosTable)
    .where(
      and(
        isNotNull(cobrosTable.fechaVencimiento),
        notInArray(cobrosTable.estado, ["pagado", "cancelado"]),
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
        // Idempotencia: si ya hay un envío exitoso/pendiente hoy para esta regla+canal, saltar.
        const yaEnviado = await db
          .select({ id: recordatoriosEnviadosTable.id })
          .from(recordatoriosEnviadosTable)
          .where(
            and(
              eq(recordatoriosEnviadosTable.cobroId, cobro.id),
              eq(recordatoriosEnviadosTable.recordatorioId, regla.id),
              eq(recordatoriosEnviadosTable.canal, canal),
              eq(recordatoriosEnviadosTable.fecha, hoy),
              inArray(recordatoriosEnviadosTable.estado, ["enviado", "pendiente"]),
            ),
          )
          .limit(1);
        if (yaEnviado.length > 0) continue;

        const diasVencido = diffDays(hoy, vencimiento);
        const linkPago = cobro.flowLinkPago || cobro.mpPaymentLinkUrl || null;

        if (canal === "email") {
          if (!cobro.emailPagador) {
            await logEnviado(cobro.id, regla.id, "email", "fallido", "El cobro no tiene email del pagador.", hoy);
            errores++;
            continue;
          }
          const result = await sendSecuenciaRecordatorioEmail(
            {
              emailPagador: cobro.emailPagador,
              clienteNombre: cobro.clienteNombre,
              descripcion: cobro.descripcion,
              monto: Number(cobro.monto),
              comercioNombre: cobro.responsableNombre || "Cobro Simple",
              linkPago,
              diasVencido,
            },
            log,
          );
          if (result.ok) {
            emailsEnviados++;
            await logEnviado(cobro.id, regla.id, "email", "enviado", null, hoy);
          } else {
            errores++;
            await logEnviado(cobro.id, regla.id, "email", "fallido", result.error ?? "Error al enviar email", hoy);
          }
        } else {
          // WhatsApp = notificación in-app "listo para enviar"
          if (!cobro.responsableId) {
            await logEnviado(cobro.id, regla.id, "whatsapp", "fallido", "El cobro no tiene responsable.", hoy);
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
          await logEnviado(cobro.id, regla.id, "whatsapp", "pendiente", "WhatsApp listo para enviar.", hoy);
        }
      }
    }
  }

  log.info(
    { fecha: hoy, emailsEnviados, notificacionesCreadas, errores },
    "Recordatorios procesados",
  );

  return { ok: true, fecha: hoy, emailsEnviados, notificacionesCreadas, errores };
}
