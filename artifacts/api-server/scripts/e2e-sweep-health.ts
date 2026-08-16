/**
 * E2E sweep-health validation: verifica que el barrido diario de salud de
 * cartera registre su marca de tiempo en app_config y que la función
 * verificarSaludSweep detecte correctamente los estados fresco y obsoleto.
 *
 * Nota: el endpoint HTTP GET /admin/sweep-health requiere autenticación de
 * superadmin (no disponible en e2e con la cuenta demo), por lo que se valida
 * a nivel de librería. La firma del endpoint está cubierta por typecheck.
 *
 * Pasos:
 *  1. Ejecuta generarSnapshotsSaludCartera directamente.
 *  2. Lee la marca de tiempo via leerUltimaEjecucionSweep() y verifica que
 *     se actualizó recientemente (< 60 s).
 *  3. Llama verificarSaludSweep() → debe retornar stale=false.
 *  4. Simula timestamp obsoleto (>25 h); verifica stale=true + alerta emitida.
 *  5. Verifica que verificarSaludSweep emite log.error cuando nunca se ejecutó
 *     (clave ausente en app_config).
 *  6. Restaura el valor correcto.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/e2e-sweep-health.ts
 */
import { db, appConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  generarSnapshotsSaludCartera,
  leerUltimaEjecucionSweep,
  verificarSaludSweep,
  SWEEP_ULTIMO_EXITO_KEY,
} from "../src/lib/salud-cartera";

let failures = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const silentLog = {
  info: (_obj: object, _msg: string) => {},
  warn: (_obj: object, _msg: string) => {},
  error: (_obj: object, _msg: string) => {},
};

async function upsertTimestamp(ts: string) {
  await db
    .insert(appConfigTable)
    .values({ clave: SWEEP_ULTIMO_EXITO_KEY, valor: ts })
    .onConflictDoUpdate({ target: appConfigTable.clave, set: { valor: ts } });
}

async function deleteKey() {
  await db.delete(appConfigTable).where(eq(appConfigTable.clave, SWEEP_ULTIMO_EXITO_KEY));
}

async function main() {
  console.log("\n== E2E sweep-health ==\n");

  // ── Paso 1: ejecutar el sweep ────────────────────────────────────────────
  console.log("1. Ejecutar sweep directamente");
  await generarSnapshotsSaludCartera(silentLog);

  // ── Paso 2: verificar marca de tiempo ────────────────────────────────────
  console.log("2. Verificar marca de tiempo en app_config");
  const ultima = await leerUltimaEjecucionSweep();
  check("leerUltimaEjecucionSweep() devuelve una fecha", ultima instanceof Date);
  const edadMs = ultima ? Date.now() - ultima.getTime() : Infinity;
  check("Marca de tiempo actualizada en los últimos 60 s", edadMs < 60_000, {
    edadMs,
    ultima: ultima?.toISOString(),
  });

  // Save for restoration later.
  const goodTimestamp = ultima ? ultima.toISOString() : new Date().toISOString();

  // ── Paso 3: verificarSaludSweep con sweep reciente ───────────────────────
  console.log("3. verificarSaludSweep() con sweep reciente");
  const resultFresh = await verificarSaludSweep(silentLog);
  check("stale=false cuando sweep es reciente", resultFresh.stale === false, resultFresh);
  check("ultimaEjecucion es una Date", resultFresh.ultimaEjecucion instanceof Date);

  // ── Paso 4: simular timestamp obsoleto (>25 h atrás) ────────────────────
  console.log("4. verificarSaludSweep() con timestamp obsoleto (simulado >25 h)");
  // Simulate a timestamp just beyond the 24-hour threshold (24 h + 1 min).
  const oldTs = new Date(Date.now() - (24 * 60 + 1) * 60 * 1000).toISOString();
  await upsertTimestamp(oldTs);

  const alertas: string[] = [];
  const alertLog = {
    info: (_obj: object, _msg: string) => {},
    warn: (_obj: object, msg: string) => { alertas.push(msg); },
    error: (_obj: object, msg: string) => { alertas.push(msg); },
  };
  const resultStale = await verificarSaludSweep(alertLog);
  check("stale=true cuando han pasado >25 h", resultStale.stale === true, resultStale);
  check("Alerta emitida via log.error", alertas.length > 0, { alertas });
  check(
    "ultimaEjecucion apunta al timestamp obsoleto",
    resultStale.ultimaEjecucion?.toISOString() === oldTs,
    resultStale,
  );

  // ── Paso 5: comportamiento cuando la clave no existe ─────────────────────
  console.log("5. verificarSaludSweep() cuando la clave nunca se ha escrito");
  await deleteKey();

  const alertasNull: string[] = [];
  const nullLog = {
    info: (_obj: object, _msg: string) => {},
    warn: (_obj: object, msg: string) => { alertasNull.push(msg); },
    error: (_obj: object, msg: string) => { alertasNull.push(msg); },
  };
  const resultNull = await verificarSaludSweep(nullLog);
  check("stale=true cuando clave ausente", resultNull.stale === true, resultNull);
  check("ultimaEjecucion=null cuando clave ausente", resultNull.ultimaEjecucion === null);
  check("Alerta emitida cuando clave ausente", alertasNull.length > 0, { alertasNull });

  // ── Paso 6: restaurar ────────────────────────────────────────────────────
  console.log("6. Restaurar timestamp correcto");
  await upsertTimestamp(goodTimestamp);
  const resultRestored = await verificarSaludSweep(silentLog);
  check("stale=false tras restaurar", resultRestored.stale === false, resultRestored);

  // ── Resumen ──────────────────────────────────────────────────────────────
  console.log(
    failures === 0
      ? "\n✅ sweep-health: todos los checks OK"
      : `\n❌ ${failures} falla(s) en sweep-health`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
