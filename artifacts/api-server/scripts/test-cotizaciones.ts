import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
const originalUrl = process.env.DATABASE_URL!;
const schema = `quotes_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: originalUrl });
let pool: { end(): Promise<void> } | undefined;
let server: http.Server | undefined;
const realFetch = globalThis.fetch;
let emails = 0;
let failEmail = false;
let failStorage = false;
const emailBodies: string[] = [];
const emailKeys: string[] = [];
try {
  await admin.connect();
  await admin.query(`create schema "${schema}"`);
  const tables = ["cotizaciones", "cotizacion_items", "preferencias", "empresas", "clientes", "productos", "cobros", "users", "organizaciones", "movimientos_stock", "locales", "bodegas", "stock_por_bodega"];
  for (const table of tables) {
    await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
    if (!["users", "preferencias", "empresas"].includes(table)) {
      await admin.query(`create sequence "${schema}"."${table}_seq"`);
      await admin.query(`alter table "${schema}"."${table}" alter column id set default nextval('"${schema}"."${table}_seq"')`);
    }
  }
  const url = new URL(originalUrl);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  // Fake transport only in this isolated process; no real external message.
  process.env.RESEND_API_KEY = "re_fake_test_only";
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.resend.com/")) {
      emails++;
      emailBodies.push(String(init?.body));
      emailKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      if (failEmail) return new Response(JSON.stringify({ name: "application_error", message: "Test failure" }), { status: 500, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ id: "test-message" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  };
  // Exercise the real archive code with a deterministic private storage transport.
  const { ObjectStorageService, objectStorageClient } = await import("../src/lib/objectStorage");
  const objects = new Map<string, { pdf: Buffer; metadata: any }>();
  ObjectStorageService.prototype.getPrivateObjectDir = () => "/test-bucket/private";
  (objectStorageClient as any).bucket = () => ({
    file: (path: string) => ({
      save: async (pdf: Buffer, opts: any) => {
        if (failStorage) throw Error("storage unavailable");
        assert.equal(opts.preconditionOpts.ifGenerationMatch, 0);
        assert.ok(!objects.has(path), "Never overwrite an existing archive");
        objects.set(path, { pdf: Buffer.from(pdf), metadata: opts.metadata });
      },
    }),
  });
  ObjectStorageService.prototype.getObjectEntityFile = async (path: string) => {
    const object = objects.get(path.replace("/objects/", "private/"));
    if (!object) throw Error("missing file");
    return { getMetadata: async () => [object.metadata], download: async () => [Buffer.from(object.pdf)] } as any;
  };
  const { db, pool: p, usersTable, clientesTable, cotizacionesTable, cobrosTable, productosTable, empresasTable } = await import("@workspace/db");
  pool = p;
  const { eq } = await import("drizzle-orm");
  const [owner, outsider] = await db.insert(usersTable).values(["owner", "outsider"].map((s, i) => ({
    id: `quote-${s}`, email: `${s}@quotes.test.invalid`, accountSeq: 21000 + i, esDemo: true, activo: true, profileCompleted: true,
  }))).returning();
  let actor = owner;
  const [cliente] = await db.insert(clientesTable).values({ nombre: "Cliente prueba", email: "debtor@quotes.test.invalid", userId: owner.id, direccion: "Dirección ficticia" }).returning();
  const [product] = await db.insert(productosTable).values({ usuarioId: owner.id, nombre: "Producto", tipo: "producto", costoUnitario: "1", precioUnitario: "10", stockActual: "10", moneda: "USD" }).returning();
  const { initializeInventarioTriggers } = await import("../src/lib/inventario-triggers");
  await initializeInventarioTriggers();
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = actor; (req as any).isAuthenticated = () => true;
    (req as any).log = { error() {}, warn() {}, info() {} }; next();
  });
  app.use("/api", (await import("../src/routes/cotizaciones")).default);
  app.use("/api", (await import("../src/routes/preferencias")).default);
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  async function api(method: string, path: string, data?: unknown) {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  }
  const prefs = { moneda: "USD", decimales: 2, porcentajeIva: 10, formatoFecha: "MM/DD/YYYY", prefijoCobro: "VENT-", prefijoCotizacion: "PRES-" };
  assert.equal((await api("PUT", "/configuracion/preferencias", prefs)).status, 200);
  assert.equal((await api("GET", "/configuracion/preferencias")).data.moneda, "USD");
  const input = { clienteId: cliente.id, fechaEmision: "2026-01-01", fechaVencimiento: "2030-01-01", moneda: "USD", decimales: 2, porcentajeIva: 10, notas: "Prueba", items: [
    { productoId: product.id, descripcion: "Producto", cantidad: 2, precioUnitario: 10, descuentoPorcentaje: 10 },
    { descripcion: "Servicio libre", cantidad: 1, precioUnitario: 5.25, descuentoPorcentaje: 0 },
  ] };
  const created = await api("POST", "/cotizaciones", { ...input, decimales: 0 });
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.data.id;
  assert.equal(created.data.total, 25.58);
  assert.equal(created.data.decimales, 2, "Server preference overrides requested precision");
  assert.equal(created.data.numeroCotizacion, "PRES-0001");
  assert.equal(created.data.clienteDireccion, "Dirección ficticia");
  assert.equal((await api("POST", `/cotizaciones/${id}/convertir`)).status, 409);
  actor = outsider;
  assert.equal((await api("GET", `/cotizaciones/${id}`)).status, 404);
  assert.equal((await api("GET", "/cotizaciones")).data.length, 0);
  actor = owner;
  await api("PUT", "/configuracion/preferencias", { ...prefs, decimales: 0 });
  assert.equal((await api("PATCH", `/cotizaciones/${id}`, { ...input, moneda: "EUR" })).status, 400);
  const edited = await api("PATCH", `/cotizaciones/${id}`, { ...input, decimales: 0, notas: "Editada" });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.total, 25.58);
  assert.equal(edited.data.decimales, 2, "Existing quote keeps original precision despite preference change");
  const whole = await api("POST", "/cotizaciones", input);
  assert.equal(whole.data.decimales, 0);
  assert.equal(whole.data.total, 25);
  await api("PUT", "/configuracion/preferencias", { ...prefs, decimales: 1 });
  const tenths = await api("POST", "/cotizaciones", input);
  assert.equal(tenths.data.decimales, 1);
  assert.equal(tenths.data.total, 25.6);
  const pdf = await fetch(`${base}/cotizaciones/${id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  failStorage = true;
  assert.equal((await api("POST", `/cotizaciones/${id}/enviar`)).status, 500);
  assert.equal(emails, 0, "No email without a durable attachment");
  failStorage = false;
  failEmail = true;
  assert.equal((await api("POST", `/cotizaciones/${id}/enviar`)).status, 500);
  assert.equal((await api("GET", `/cotizaciones/${id}/pdf-enviado`)).status, 404);
  const pending = (await api("GET", `/cotizaciones/${id}`)).data;
  assert.equal(pending.pdfEnviadoDisponible, false);
  assert.equal(pending.envioPendiente, true);
  assert.equal(pending.envioPdf, undefined, "Private paths/payloads not exposed");
  assert.equal((await api("PATCH", `/cotizaciones/${id}`, input)).status, 409);
  await db.insert(empresasTable).values({ scope: `user:${owner.id}`, perfil: { razonSocial: "Identidad nueva", plantilla: "moderna", colorPrimario: "#F00000" } });
  failEmail = false;
  const retries = await Promise.all([1, 2].map(() => api("POST", `/cotizaciones/${id}/enviar`)));
  assert.ok(retries.some(r => r.status === 200));
  assert.ok(retries.every(r => r.status === 200 || r.status === 409));
  assert.equal((await api("POST", `/cotizaciones/${id}/enviar`)).status, 200);
  assert.equal(emails, 2);
  assert.equal(emailBodies[0], emailBodies[1], "Retry keeps the entire email including PDF byte-for-byte");
  assert.equal(emailKeys[0], emailKeys[1]);
  assert.ok(emailKeys[0]);
  const archived = await fetch(`${base}/cotizaciones/${id}/pdf-enviado`);
  assert.equal(archived.status, 200);
  assert.equal(archived.headers.get("cache-control"), "private, no-store");
  const archivedBytes = Buffer.from(await archived.arrayBuffer());
  assert.deepEqual(archivedBytes, Buffer.from(JSON.parse(emailBodies[1]).attachments[0].content, "base64"));
  const regenerated = Buffer.from(await (await fetch(`${base}/cotizaciones/${id}/pdf`)).arrayBuffer());
  assert.notDeepEqual(archivedBytes, regenerated, "Current identity is used only by the regenerated preview");
  const stored = [...objects.values()][0];
  const originalBytes = stored.pdf;
  stored.pdf = Buffer.from("tampered");
  assert.equal((await api("GET", `/cotizaciones/${id}/pdf-enviado`)).status, 500, "Corruption fails explicitly, never regenerates");
  stored.pdf = originalBytes;
  actor = outsider;
  assert.equal((await api("GET", `/cotizaciones/${id}/pdf-enviado`)).status, 404);
  actor = owner;
  // Historical success without an archive must stay unavailable, never fabricated.
  await db.update(cotizacionesTable).set({ enviadoEn: new Date(), estado: "enviada" }).where(eq(cotizacionesTable.id, whole.data.id));
  assert.equal((await api("GET", `/cotizaciones/${whole.data.id}/pdf-enviado`)).status, 404);
  assert.equal((await api("POST", `/cotizaciones/${whole.data.id}/enviar`)).status, 200);
  assert.equal(emails, 2);
  const [sent] = await db.select().from(cotizacionesTable).where(eq(cotizacionesTable.id, id));
  await db.update(cotizacionesTable).set({ envioPdf: { ...sent.envioPdf!, scope: "org:999999" } }).where(eq(cotizacionesTable.id, id));
  assert.equal((await api("GET", `/cotizaciones/${id}/pdf-enviado`)).status, 500, "Reject mismatched tenant metadata");
  await db.update(cotizacionesTable).set({ envioPdf: sent.envioPdf }).where(eq(cotizacionesTable.id, id));
  assert.equal((await api("PATCH", `/cotizaciones/${id}`, input)).status, 409);
  assert.equal((await api("PATCH", `/cotizaciones/${id}/estado`, { estado: "aceptada" })).status, 200);
  const conversions = await Promise.all([1, 2].map(() => api("POST", `/cotizaciones/${id}/convertir`)));
  assert.equal(conversions[0].status, 200, JSON.stringify(conversions[0]));
  assert.equal(conversions[0].data.cobroId, conversions[1].data.cobroId);
  const charges = await db.select().from(cobrosTable);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].monto, "25.58");
  assert.equal(charges[0].moneda, "USD");
  assert.equal(charges[0].numeroDocumento, "VENT-0001");
  assert.equal(charges[0].itemsInventario[0].cantidad, 2);
  assert.match(charges[0].descripcion, /Servicio libre/);
  await db.update(cobrosTable).set({ estado: "pagado" }).where(eq(cobrosTable.id, charges[0].id));
  assert.equal((await db.select().from(productosTable).where(eq(productosTable.id, product.id)))[0].stockActual, "8.000");
  const expired = await api("POST", "/cotizaciones", { ...input, fechaVencimiento: "2026-01-02" });
  assert.equal(expired.data.estado, "vencida");
  assert.equal((await api("POST", `/cotizaciones/${expired.data.id}/enviar`)).status, 409);
  assert.equal(emails, 2);
  failEmail = true;
  assert.equal((await api("POST", `/cotizaciones/${tenths.data.id}/enviar`)).status, 500);
  const [stuck] = await db.select().from(cotizacionesTable).where(eq(cotizacionesTable.id, tenths.data.id));
  await db.update(cotizacionesTable).set({ envioPdf: { ...stuck.envioPdf!, preparedAt: "2020-01-01T00:00:00Z" } }).where(eq(cotizacionesTable.id, stuck.id));
  failEmail = false;
  const beforeRetry = emails;
  assert.equal((await api("POST", `/cotizaciones/${stuck.id}/enviar`)).status, 409);
  assert.equal(emails, beforeRetry, "Never retry outside provider idempotency retention");
  console.log("PASS preferences, totals/discount/IVA, immutable currency, scope isolation, PDF, mocked Resend/idempotency, state guards, concurrent conversion, linked stock, expiration");
} finally {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (pool) await pool.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
