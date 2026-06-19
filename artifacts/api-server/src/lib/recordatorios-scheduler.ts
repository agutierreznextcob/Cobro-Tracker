import { logger } from "./logger";
import { fechaHoySantiago, procesarRecordatorios } from "./recordatorios";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

let lastProcessedDate: string | null = null;
let timer: NodeJS.Timeout | null = null;

const runLogger = {
  info: (obj: object, msg: string) => logger.info(obj, msg),
  warn: (obj: object, msg: string) => logger.warn(obj, msg),
  error: (obj: object, msg: string) => logger.error(obj, msg),
};

async function tick(): Promise<void> {
  const hoy = fechaHoySantiago();
  if (lastProcessedDate === hoy) return;
  try {
    await procesarRecordatorios(runLogger, hoy);
    lastProcessedDate = hoy;
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
  void tick();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({}, "Scheduler de recordatorios iniciado");
}
