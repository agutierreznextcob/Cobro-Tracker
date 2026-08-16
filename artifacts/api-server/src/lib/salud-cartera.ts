import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  cobrosTable,
  pagosParciales,
  saludCarteraSnapshotsTable,
  usersTable,
  appConfigTable,
} from "@workspace/db";
import { getOrgContext, cobroScopeCondition } from "./org";
import { sendSweepAlertEmail } from "./email";

// ---------------------------------------------------------------------------
// Salud de cartera: shared classification helpers + daily per-user snapshots.
//
// Day boundaries use America/Santiago (dashboard contract): fechaVencimiento
// is a date-only string compared lexically against the Santiago-local "today".
// Day arithmetic runs on a UTC-noon anchor so DST transitions can't skew it.
// ---------------------------------------------------------------------------

export type Bloque = "sana" | "riesgo" | "critica";

export function hoySantiagoStr(ref: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(ref);
}

export function sumarDias(ymd: string, dias: number): string {
  return new Date(new Date(`${ymd}T12:00:00Z`).getTime() + dias * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function clasificarBloque(venc: string | null, refHoy: string, ref7: string): Bloque {
  if (!venc) return "sana";
  if (venc < refHoy) return "critica";
  if (venc <= ref7) return "riesgo";
  return "sana";
}

export interface BloquesSaludCartera {
  sana: { monto: number; cantidad: number };
  riesgo: { monto: number; cantidad: number };
  critica: { monto: number; cantidad: number; sumaMora: number };
}

/**
 * Computes the current traffic-light blocks for one user's scoped view
 * (admin=org, supervisor=team, ejecutivo=own). Open cobros only, valued at
 * saldo (net of descuento and confirmed abonos). Self-contained so the daily
 * sweep can run it for every user without going through the HTTP route.
 */
export async function calcularBloquesUsuario(
  userId: string,
  hoyStr: string = hoySantiagoStr(),
): Promise<BloquesSaludCartera> {
  const ctx = await getOrgContext(userId);
  const scope = cobroScopeCondition(ctx, userId, undefined);
  const en7Str = sumarDias(hoyStr, 7);

  const abiertos = await db
    .select({
      id: cobrosTable.id,
      monto: cobrosTable.monto,
      montoDescuento: cobrosTable.montoDescuento,
      fechaVencimiento: cobrosTable.fechaVencimiento,
    })
    .from(cobrosTable)
    .where(and(scope, inArray(cobrosTable.estado, ["pendiente", "parcial"])));

  const abonado = new Map<number, number>();
  if (abiertos.length > 0) {
    const sums = await db
      .select({
        cobroId: pagosParciales.cobroId,
        total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
      })
      .from(pagosParciales)
      .where(
        and(
          eq(pagosParciales.estado, "confirmado"),
          inArray(pagosParciales.cobroId, abiertos.map((r) => r.id)),
        ),
      )
      .groupBy(pagosParciales.cobroId);
    for (const s of sums) abonado.set(s.cobroId, s.total);
  }

  const bloques: BloquesSaludCartera = {
    sana: { monto: 0, cantidad: 0 },
    riesgo: { monto: 0, cantidad: 0 },
    critica: { monto: 0, cantidad: 0, sumaMora: 0 },
  };
  const msDia = 24 * 60 * 60 * 1000;
  for (const r of abiertos) {
    const saldo = Math.max(
      Number(r.monto) - Number(r.montoDescuento ?? 0) - (abonado.get(r.id) ?? 0),
      0,
    );
    const bloque = clasificarBloque(r.fechaVencimiento, hoyStr, en7Str);
    bloques[bloque].monto += saldo;
    bloques[bloque].cantidad += 1;
    if (bloque === "critica" && r.fechaVencimiento) {
      bloques.critica.sumaMora += Math.max(
        Math.round(
          (new Date(`${hoyStr}T00:00:00`).getTime() -
            new Date(`${r.fechaVencimiento}T00:00:00`).getTime()) /
            msDia,
        ),
        0,
      );
    }
  }
  return bloques;
}

type SweepLogger = {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

/**
 * Daily sweep: stores one salud-de-cartera snapshot per active user for the
 * current Santiago day. Idempotent via the (usuarioId, fecha) unique index +
 * ON CONFLICT DO NOTHING, so overlapping or repeated runs are safe.
 *
 * `options` is intentionally exposed for testing:
 *   - `calcularFn`: replaces `calcularBloquesUsuario` (inject deterministic
 *     failures to verify the per-user try/catch without real DB side-effects).
 *   - `users`: provides an explicit ordered user list instead of querying all
 *     active users. Iteration order is exactly the array order — no DB query is
 *     issued — so tests can guarantee which user is processed first and thereby
 *     prove that a failure on user N does not abort processing of user N+1.
 */
export async function generarSnapshotsSaludCartera(
  log: SweepLogger,
  options?: {
    calcularFn?: (userId: string, fecha: string) => Promise<BloquesSaludCartera>;
    users?: Array<{ id: string }>;
  },
): Promise<void> {
  const fecha = hoySantiagoStr();
  const calcular = options?.calcularFn ?? calcularBloquesUsuario;
  const usuarios = options?.users
    ? options.users
    : await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.activo, true));

  let creados = 0;
  for (const u of usuarios) {
    try {
      const b = await calcular(u.id, fecha);
      const inserted = await db
        .insert(saludCarteraSnapshotsTable)
        .values({
          usuarioId: u.id,
          fecha,
          sanaMonto: b.sana.monto.toFixed(2),
          sanaCantidad: b.sana.cantidad,
          riesgoMonto: b.riesgo.monto.toFixed(2),
          riesgoCantidad: b.riesgo.cantidad,
          criticaMonto: b.critica.monto.toFixed(2),
          criticaCantidad: b.critica.cantidad,
          criticaSumaMora: b.critica.sumaMora,
        })
        .onConflictDoNothing()
        .returning({ id: saludCarteraSnapshotsTable.id });
      if (inserted.length > 0) creados += 1;
    } catch (err) {
      // One user's failure must not abort the sweep for the rest.
      log.error({ err, userId: u.id }, "Error generando snapshot de salud de cartera");
    }
  }
  if (creados > 0) {
    log.info({ fecha, creados }, "Snapshots de salud de cartera generados");
  }

  await purgarSnapshotsAntiguos(fecha, log);
  await registrarUltimaEjecucionSweep(log);
}

// ---------------------------------------------------------------------------
// Sweep health tracking: writes/reads a timestamp in app_config so operators
// (and the admin endpoint) can detect when the sweep has silently stalled.
// ---------------------------------------------------------------------------

export const SWEEP_ULTIMO_EXITO_KEY = "sweep_salud_cartera_ultima_ejecucion";
export const SWEEP_ALERTA_ENVIADA_KEY = "sweep_salud_cartera_alerta_enviada_en";
const ALERT_RATE_LIMIT_HORAS = 12;

/**
 * Upserts the current UTC timestamp into app_config after a successful sweep.
 * Failures are logged and swallowed — tracking must never abort the sweep.
 */
export async function registrarUltimaEjecucionSweep(log: SweepLogger): Promise<void> {
  try {
    const ahora = new Date().toISOString();
    await db
      .insert(appConfigTable)
      .values({ clave: SWEEP_ULTIMO_EXITO_KEY, valor: ahora })
      .onConflictDoUpdate({
        target: appConfigTable.clave,
        set: { valor: ahora },
      });
  } catch (err) {
    log.error({ err }, "Error registrando última ejecución del sweep de salud de cartera");
  }
}

/**
 * Reads the last successful sweep timestamp from app_config.
 * Returns null if the key has never been written (e.g. fresh deployment).
 */
export async function leerUltimaEjecucionSweep(): Promise<Date | null> {
  const [row] = await db
    .select({ valor: appConfigTable.valor })
    .from(appConfigTable)
    .where(eq(appConfigTable.clave, SWEEP_ULTIMO_EXITO_KEY));
  if (!row) return null;
  const d = new Date(row.valor);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sends a one-off stale-sweep alert email to the platform superadmin,
 * rate-limited to at most one per ALERT_RATE_LIMIT_HORAS. Tracks the last
 * send time in app_config under SWEEP_ALERTA_ENVIADA_KEY. All failures are
 * swallowed so this never disrupts the health-check caller.
 */
async function enviarAlertaSweepSiNecesario(
  log: SweepLogger,
  ultimaEjecucion: Date | null,
  horasDesde: number | null,
): Promise<void> {
  try {
    // Check last alert timestamp for rate limiting.
    const [alertaRow] = await db
      .select({ valor: appConfigTable.valor })
      .from(appConfigTable)
      .where(eq(appConfigTable.clave, SWEEP_ALERTA_ENVIADA_KEY));

    if (alertaRow) {
      const ultimaAlerta = new Date(alertaRow.valor);
      if (!isNaN(ultimaAlerta.getTime())) {
        const horasDesdeAlerta = (Date.now() - ultimaAlerta.getTime()) / (1000 * 60 * 60);
        if (horasDesdeAlerta < ALERT_RATE_LIMIT_HORAS) {
          log.info(
            { horasDesdeAlerta: Math.round(horasDesdeAlerta), rateLimitHoras: ALERT_RATE_LIMIT_HORAS },
            "Alerta de sweep ya enviada recientemente — omitiendo",
          );
          return;
        }
      }
    }

    // Fetch superadmin email (reserved accountId NCB-0000000001).
    const [admin] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.accountId, "NCB-0000000001"));

    const destinatario = admin?.email;
    if (!destinatario) {
      log.error({}, "No se encontró el email del superadmin para enviar la alerta del sweep");
      return;
    }

    const result = await sendSweepAlertEmail(
      { destinatario, ultimaEjecucion, horasDesde },
      { warn: (obj, msg) => log.error(obj, msg) },
    );

    if (result.ok) {
      // Record the send time so subsequent ticks respect the rate limit.
      const ahora = new Date().toISOString();
      await db
        .insert(appConfigTable)
        .values({ clave: SWEEP_ALERTA_ENVIADA_KEY, valor: ahora })
        .onConflictDoUpdate({
          target: appConfigTable.clave,
          set: { valor: ahora },
        });
      log.info({ destinatario }, "Alerta de sweep de salud de cartera enviada por email");
    }
  } catch (err) {
    log.error({ err }, "Error enviando alerta de sweep por email");
  }
}

/**
 * Checks whether the sweep is overdue (gap > umbralHoras since last success).
 * Returns `{ stale, ultimaEjecucion }`. Logs a warning when stale and sends
 * a rate-limited alert email to the platform superadmin (at most once per 12 h).
 */
export async function verificarSaludSweep(
  log: SweepLogger,
  umbralHoras = 24,
): Promise<{ stale: boolean; ultimaEjecucion: Date | null }> {
  const ultimaEjecucion = await leerUltimaEjecucionSweep();
  if (!ultimaEjecucion) {
    log.error(
      { umbralHoras },
      "Sweep de salud de cartera nunca ha registrado una ejecución exitosa",
    );
    await enviarAlertaSweepSiNecesario(log, null, null);
    return { stale: true, ultimaEjecucion: null };
  }
  const horasDesde = (Date.now() - ultimaEjecucion.getTime()) / (1000 * 60 * 60);
  if (horasDesde > umbralHoras) {
    log.error(
      { ultimaEjecucion: ultimaEjecucion.toISOString(), horasDesde: Math.round(horasDesde), umbralHoras },
      "ALERTA: el sweep de salud de cartera lleva más de 25 horas sin ejecutarse",
    );
    await enviarAlertaSweepSiNecesario(log, ultimaEjecucion, horasDesde);
    return { stale: true, ultimaEjecucion };
  }
  return { stale: false, ultimaEjecucion };
}

/**
 * Retention policy so salud_cartera_snapshots stays bounded:
 * - last RETENCION_DIARIA_DIAS days: keep every daily snapshot;
 * - between that and RETENCION_TOTAL_DIAS: keep only one weekly snapshot
 *   (Mondays, ISO dow = 1);
 * - older than RETENCION_TOTAL_DIAS: delete everything (hard cap).
 * Per user this bounds the table at ~90 daily rows + ~95 weekly rows.
 * Weekly history/trends survive because a Monday row remains per week within
 * the horizon, and the week-over-week trend only looks ~7 days back (well
 * inside the daily window). Runs as part of the daily sweep; failures are
 * logged, never thrown.
 */
export const RETENCION_DIARIA_DIAS = 90;
export const RETENCION_TOTAL_DIAS = 730; // ~2 años

export async function purgarSnapshotsAntiguos(
  hoyStr: string,
  log: SweepLogger,
): Promise<void> {
  const corteDiario = sumarDias(hoyStr, -RETENCION_DIARIA_DIAS);
  const corteTotal = sumarDias(hoyStr, -RETENCION_TOTAL_DIAS);
  try {
    const borrados = await db
      .delete(saludCarteraSnapshotsTable)
      .where(
        sql`${lte(saludCarteraSnapshotsTable.fecha, corteTotal)} OR (${and(
          lte(saludCarteraSnapshotsTable.fecha, corteDiario),
          // fecha is a YYYY-MM-DD varchar; cast to date for day-of-week.
          sql`extract(isodow from ${saludCarteraSnapshotsTable.fecha}::date) <> 1`,
        )})`,
      )
      .returning({ id: saludCarteraSnapshotsTable.id });
    if (borrados.length > 0) {
      log.info(
        { corteDiario, corteTotal, borrados: borrados.length },
        "Snapshots antiguos de salud de cartera purgados (diarios 90 días, semanales hasta 2 años)",
      );
    }
  } catch (err) {
    // Purge failure must not affect the sweep's snapshot generation.
    log.error(
      { err, corteDiario, corteTotal },
      "Error purgando snapshots antiguos de salud de cartera",
    );
  }
}

/**
 * Finds the stored snapshot closest to `objetivo` (~7 days ago) within a
 * ±2-day window, for exact week-over-week trends. Returns null when no
 * snapshot exists (caller falls back to the reconstruction).
 */
export async function buscarSnapshotPrevio(
  userId: string,
  objetivo: string,
): Promise<{ fecha: string; sana: number; riesgo: number; critica: number } | null> {
  const desde = sumarDias(objetivo, -2);
  const hasta = sumarDias(objetivo, 2);
  const rows = await db
    .select()
    .from(saludCarteraSnapshotsTable)
    .where(
      and(
        eq(saludCarteraSnapshotsTable.usuarioId, userId),
        gte(saludCarteraSnapshotsTable.fecha, desde),
        lte(saludCarteraSnapshotsTable.fecha, hasta),
      ),
    );
  if (rows.length === 0) return null;
  const objetivoMs = new Date(`${objetivo}T12:00:00Z`).getTime();
  rows.sort(
    (a, b) =>
      Math.abs(new Date(`${a.fecha}T12:00:00Z`).getTime() - objetivoMs) -
      Math.abs(new Date(`${b.fecha}T12:00:00Z`).getTime() - objetivoMs),
  );
  const s = rows[0];
  return {
    fecha: s.fecha,
    sana: Number(s.sanaMonto),
    riesgo: Number(s.riesgoMonto),
    critica: Number(s.criticaMonto),
  };
}
