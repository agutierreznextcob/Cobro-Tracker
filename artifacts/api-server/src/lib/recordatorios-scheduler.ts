import { logger } from "./logger";
import { fechaHoySantiago, procesarRecordatorios } from "./recordatorios";
import { procesarWorkflows } from "./workflows-engine";
import { procesarEncuestasPendientes } from "./encuestas-service";
import {
  reveniuConfigured,
  sincronizarMontosReveniu,
  procesarGraciaPagosFallidos,
} from "./reveniu";
import { generarSnapshotsSaludCartera, verificarSaludSweep } from "./salud-cartera";
import { procesarAvisosTrial, procesarVencimientosNotificaciones } from "./notificaciones-service";
import { procesarCobrosRecurrentes, procesarEntregasIniciales } from "./cobros-recurrentes";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
// Surveys are scheduled ~1h after payment; sweep often so delivery stays close
// to the intended time.
const ENCUESTAS_INTERVAL_MS = 5 * 60 * 1000;

let lastProcessedDate: string | null = null;
let timer: NodeJS.Timeout | null = null;

const runLogger = {
  info: (obj: object, msg: string) => logger.info(obj, msg),
  warn: (obj: object, msg: string) => logger.warn(obj, msg),
  error: (obj: object, msg: string) => logger.error(obj, msg),
};

async function tick(): Promise<void> {
  const hoy = fechaHoySantiago();

  // On every tick (hourly), check whether the sweep has run recently enough.
  // This fires even on days where the date hasn't changed yet, so a stalled
  // scheduler (e.g. process restart that drops the interval) is caught quickly.
  try {
    await verificarSaludSweep(runLogger);
  } catch (err) {
    logger.error({ err }, "Error verificando salud del sweep de salud de cartera");
  }

  // This outbox is independent from the once-per-day reminder sweep. It makes
  // post-commit initial notices retryable after provider/profile failures.
  try {
    await procesarEntregasIniciales(runLogger);
  } catch (err) {
    logger.error({ err }, "Error procesando entregas iniciales de cobros");
  }

  if (lastProcessedDate === hoy) return;
  try {
    // Emits only one overdue cycle per schedule and is transactionally
    // idempotent, so restart/catch-up cannot create duplicate charges.
    const recurrentes = await procesarCobrosRecurrentes(runLogger, hoy);
    // Run after recurring generation so a new same-day due child receives the
    // normal reminder/workflow sweep in this tick.
    await procesarRecordatorios(runLogger, hoy);
    await procesarVencimientosNotificaciones(hoy);
    await procesarAvisosTrial();
    // Workflows de cobranza corren DESPUÉS de los recordatorios simples. Ambos
    // engines coexisten: procesarRecordatorios ignora cobros con workflowId y
    // procesarWorkflows sólo actúa sobre cobros con workflowId asignado.
    await procesarWorkflows(runLogger);
    // Suscripciones Reveniu (una vez al día): sincroniza el monto mensual
    // (base + usuarios extra activos) y procesa la gracia de pagos fallidos.
    if (reveniuConfigured()) {
      await sincronizarMontosReveniu(logger);
      await procesarGraciaPagosFallidos(logger);
    }
    // Snapshot diario de salud de cartera por usuario (tendencias exactas del
    // dashboard). Idempotente por (usuario, fecha), seguro re-ejecutar.
    await generarSnapshotsSaludCartera(runLogger);
    // Leave the date open while the bounded recurring page has work pending;
    // the next hourly tick continues catch-up instead of losing old periods.
    if (!recurrentes.pendientes) lastProcessedDate = hoy;
  } catch (err) {
    logger.error({ err }, "Error en el scheduler de recordatorios");
  }
}

/**
 * Starts the in-process daily reminder scheduler. Runs once at startup
 * (catch-up) and then hourly; the per-day guard plus per-send idempotency
 * make it safe to run multiple times.
 */
export function startRecordatoriosScheduler(): void {
  if (timer) return;
  // Best-effort background work: tick() already try/catches its own body, but we
  // also guard the fire-and-forget call itself so a rejection can never escape as
  // an unhandled rejection and crash the process (which would fail the deploy).
  const runTick = () => {
    tick().catch((err) =>
      logger.error({ err }, "Error no controlado en el scheduler de recordatorios"),
    );
  };
  runTick();
  timer = setInterval(runTick, CHECK_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();

  // Deferred satisfaction surveys: sweep due sends every few minutes. The
  // claim/TTL logic in procesarEncuestasPendientes makes overlapping runs safe.
  const runEncuestas = () => {
    procesarEncuestasPendientes(runLogger).catch((err) =>
      logger.error({ err }, "Error no controlado procesando encuestas pendientes"),
    );
  };
  runEncuestas();
  const encuestasTimer = setInterval(runEncuestas, ENCUESTAS_INTERVAL_MS);
  if (typeof encuestasTimer.unref === "function") encuestasTimer.unref();

  logger.info({}, "Scheduler de recordatorios iniciado");
}
