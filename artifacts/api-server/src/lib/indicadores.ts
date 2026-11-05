import { db, indicadoresEconomicosTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { hoySantiago, formatDocumentMoney } from "./preferencias";

export const codigosIndicadores = ["uf", "dolar", "euro", "utm", "ivp"] as const;
export function parseSerieIndicador(body: unknown, codigo: string) {
  const data = body as { codigo?: string; nombre?: string; unidad_medida?: string; serie?: { fecha: string; valor: number }[] };
  if (data?.codigo !== codigo || data.unidad_medida !== "Pesos" || !data.nombre || !Array.isArray(data.serie)) throw new Error(`Respuesta inválida para ${codigo}`);
  const rows = data.serie.filter(r => Number.isFinite(r.valor) && r.valor > 0 && /^\d{4}-\d{2}-\d{2}T/.test(r.fecha) && Number.isFinite(Date.parse(r.fecha)))
    .map(r => ({ fecha: r.fecha.slice(0, 10), valor: r.valor }))
    .filter(r => r.fecha <= hoySantiago()).sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!rows.length) throw new Error(`No hay valores válidos para ${codigo}`);
  const current = rows[0];
  const yesterday = new Date(`${hoySantiago()}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  // Carry the latest published value forward on holidays and for monthly UTM.
  // Compare against yesterday's effective value, not the previous month's.
  const previous = rows.find(r => r.fecha <= yesterday.toISOString().slice(0, 10));
  return { codigo, nombre: data.nombre, valor: String(current.valor), fecha: current.fecha,
    valorAnterior: previous ? String(previous.valor) : null, fechaAnterior: previous?.fecha ?? null };
}
export async function listIndicadoresCache() {
  const rows = await db.select().from(indicadoresEconomicosTable).orderBy(indicadoresEconomicosTable.id);
  return rows.map(r => ({ codigo: r.codigo, nombre: r.nombre, valor: Number(r.valor), fecha: r.fecha, updatedAt: r.updatedAt.toISOString(),
    variacion: r.valorAnterior ? (Number(r.valor) / Number(r.valorAnterior) - 1) * 100 : null, fechaAnterior: r.fechaAnterior }));
}
let ultimoIntento = 0;
export async function sincronizarIndicadores(manual = false) {
  if (Date.now() - ultimoIntento < (manual ? 60_000 : 15 * 60_000)) throw new Error("La sincronización está en espera. Intenta nuevamente en unos minutos.");
  ultimoIntento = Date.now();
  return db.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('nextcob:indicadores')) as acquired`);
    if (!lock.rows[0]?.acquired) throw new Error("Hay otra sincronización en curso.");
    const existing = await tx.select().from(indicadoresEconomicosTable);
    if (existing.length === 5) {
      const last = Math.min(...existing.map(r => r.updatedAt.getTime()));
      if (Date.now() - last < 60_000) return listIndicadoresCache();
      const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(new Date(last));
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(new Date(last)));
      if (!manual && day === hoySantiago() && hour >= 9) return listIndicadoresCache();
    }
    // All five responses are validated before any cache row changes.
    const rows = await Promise.all(codigosIndicadores.map(async codigo => {
      const response = await fetch(`https://mindicador.cl/api/${codigo}`, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`mindicador.cl devolvió ${response.status}`);
      return parseSerieIndicador(await response.json(), codigo);
    }));
    const now = new Date();
    for (const row of rows) {
      const old = existing.find(r => r.codigo === row.codigo);
      if (old && old.fecha > row.fecha) throw new Error("La fuente entregó una fecha anterior al valor almacenado.");
      await tx.insert(indicadoresEconomicosTable).values({ ...row, updatedAt: now })
        .onConflictDoUpdate({ target: indicadoresEconomicosTable.codigo, set: { ...row, updatedAt: now } });
    }
    return rows;
  });
}
export async function equivalenciaClpTexto(monto: number, moneda = "CLP", decimales = 0): Promise<string | null> {
  const codigo = ({ USD: "dolar", EUR: "euro", UF: "uf" } as Record<string, string>)[moneda];
  if (!codigo) return null;
  const [r] = await db.select().from(indicadoresEconomicosTable).where(eq(indicadoresEconomicosTable.codigo, codigo));
  if (!r) return "Equivalencia en CLP no disponible: aún no hay indicador sincronizado.";
  return `Equivalencia referencial: ${formatDocumentMoney(monto * Number(r.valor), "CLP", decimales)}. Tipo de cambio: ${formatDocumentMoney(Number(r.valor), "CLP", decimales)} por ${moneda}, fecha ${r.fecha}. No modifica el monto del documento.`;
}
export function startIndicadoresScheduler() {
  const tick = async () => {
    if (Date.now() - ultimoIntento < 15 * 60_000) return;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const cache = await listIndicadoresCache();
    if (hour < 9 && cache.length === 5) return;
    const last = cache.length === 5 ? Math.min(...cache.map(r => Date.parse(r.updatedAt))) : 0;
    const day = last ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(new Date(last)) : "";
    const lastHour = last ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(new Date(last))) : 0;
    if (day === hoySantiago() && lastHour >= 9) return;
    await sincronizarIndicadores();
  };
  const run = () => { void tick().catch(err => logger.warn({ err }, "No se pudieron sincronizar indicadores; se conserva el último valor")); };
  run();
  setInterval(run, 60_000).unref();
}
