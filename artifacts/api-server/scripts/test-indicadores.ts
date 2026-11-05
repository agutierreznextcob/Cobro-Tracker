import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
const url = new URL(process.env.DATABASE_URL!);
const schema = `ind_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: url.toString() });
const realFetch = globalThis.fetch;
let pool: { end(): Promise<void> } | undefined;
try {
  await admin.connect();
  await admin.query(`create schema "${schema}"`);
  await admin.query(`create table "${schema}".indicadores_economicos (like public.indicadores_economicos including all)`);
  await admin.query(`create sequence "${schema}".ids`);
  await admin.query(`alter table "${schema}".indicadores_economicos alter column id set default nextval('"${schema}".ids')`);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const { parseSerieIndicador, sincronizarIndicadores, listIndicadoresCache, equivalenciaClpTexto } = await import("../src/lib/indicadores");
  const date = new Date().toISOString().slice(0, 10);
  const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const fixture = (codigo: string) => ({ codigo, nombre: codigo.toUpperCase(), unidad_medida: "Pesos", serie: [
    { fecha: `${previous}T03:00:00.000Z`, valor: 100 },
    { fecha: `${date}T03:00:00.000Z`, valor: 110 },
  ] });
  assert.equal(parseSerieIndicador(fixture("uf"), "uf").valor, "110");
  assert.throws(() => parseSerieIndicador(fixture("dolar"), "uf"));
  assert.throws(() => parseSerieIndicador({ ...fixture("uf"), serie: [{ fecha: `${date}T03:00:00Z`, valor: -1 }] }, "uf"));
  let calls = 0;
  globalThis.fetch = async input => { calls++; return new Response(JSON.stringify(fixture(String(input).split("/").pop()!)), { status: 200 }); };
  await sincronizarIndicadores(true);
  assert.equal(calls, 5);
  const rows = await listIndicadoresCache();
  assert.equal(rows.length, 5);
  assert.ok(Math.abs(rows[0].variacion! - 10) < 0.000001);
  assert.match((await equivalenciaClpTexto(2, "USD"))!, /CLP 220/);
  assert.equal(await equivalenciaClpTexto(2, "CLP"), null);
  assert.equal(calls, 5, "Reads/PDF equivalents must not contact external API");
  await assert.rejects(sincronizarIndicadores(true), /espera/);
  assert.equal(calls, 5);
  const { cotizacionPdf } = await import("../src/lib/cotizacion-pdf");
  const pdf = await cotizacionPdf({ numeroCotizacion: "TEST", estado: "borrador", moneda: "USD", decimales: 2, fechaEmision: date, fechaVencimiento: date,
    clienteNombre: "Prueba", items: [], subtotal: 2, porcentajeIva: 0, montoIva: 0, total: 2, notas: "" } as any, "Test");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  console.log("PASS indicator validation, chronological observations, cached sync, percent change, CLP equivalence, no-network reads/PDF, manual throttle");
} finally {
  globalThis.fetch = realFetch;
  await pool?.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
