import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  cobrosTable,
  pagosParciales,
  saludCarteraSnapshotsTable,
  usersTable,
} from "@workspace/db";
import { getOrgContext, cobroScopeCondition } from "./org";

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
 */
export async function generarSnapshotsSaludCartera(log: SweepLogger): Promise<void> {
  const fecha = hoySantiagoStr();
  const usuarios = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.activo, true));

  let creados = 0;
  for (const u of usuarios) {
    try {
      const b = await calcularBloquesUsuario(u.id, fecha);
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
