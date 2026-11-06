import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type http from "node:http";

const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
const originalUrl = process.env.DATABASE_URL!;
const schema = `empresa_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: originalUrl });
let pool: { end(): Promise<void> } | undefined;
let server: http.Server | undefined;
try {
  await admin.connect();
  await admin.query(`create schema "${schema}"`);
  const tables = ["users", "organizaciones", "empresas", "empresa_uploads", "preferencias", "clientes", "cotizaciones", "cotizacion_items", "cobros", "productos"];
  for (const table of tables) {
    await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
    if (!["users", "empresas", "empresa_uploads", "preferencias"].includes(table)) {
      await admin.query(`create sequence "${schema}"."${table}_seq"`);
      await admin.query(`alter table "${schema}"."${table}" alter column id set default nextval('"${schema}"."${table}_seq"')`);
    }
  }
  const url = new URL(originalUrl); url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const D = await import("@workspace/db");
  pool = D.pool;
  const { eq } = await import("drizzle-orm");
  const [owner, staff, outsider] = await D.db.insert(D.usersTable).values(["owner", "staff", "outside"].map((name, i) => ({
    id: `empresa-${name}`, email: `${name}@empresa.invalid`, accountSeq: 45000 + i,
    firstName: name, activo: true, esDemo: true, profileCompleted: true,
  }))).returning();
  const [org] = await D.db.insert(D.organizacionesTable).values({ nombre: "Empresa prueba", ownerId: owner.id }).returning();
  for (const [u, role] of [[owner, "admin_org"], [staff, "ejecutivo"]] as const)
    await D.db.update(D.usersTable).set({ organizationId: org.id, orgRole: role }).where(eq(D.usersTable.id, u.id));
  let actor = owner;
  let authenticated = true;
  const express = (await import("express")).default;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = actor; (req as any).isAuthenticated = () => authenticated;
    (req as any).log = { error() {}, warn() {}, info() {} }; next();
  });
  app.use("/api", (await import("../src/routes/empresa")).default);
  app.use("/api", (await import("../src/routes/cotizaciones")).default);
  app.use("/api", (await import("../src/routes/cobro-pdf")).default);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api`;
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const { empresaDefault } = await import("../src/lib/empresa");
  const company = { ...empresaDefault, razonSocial: "Empresa Documentos Prueba", rut: "760864285", giro: "Servicios profesionales",
    direccion: "Calle de prueba 123", ciudad: "Santiago", telefono: "+56912345678", email: "contacto@empresa.invalid",
    condicionesPago: "50% anticipo", piePagina: "Gracias por preferirnos", plantilla: "moderna", validezDias: 30 };
  assert.equal((await api("PUT", "/configuracion/empresa", company)).status, 200);
  assert.equal((await api("GET", "/configuracion/empresa")).data.rut, "76.086.428-5");
  assert.equal((await api("PUT", "/configuracion/empresa", { ...company, colorPrimario: "red" })).status, 400);
  assert.equal((await api("PUT", "/configuracion/empresa", { ...company, sitioWeb: "javascript:alert(1)" })).status, 400);
  assert.equal((await api("POST", "/configuracion/empresa/logo/upload", { size: 2097153, contentType: "image/png" })).status, 400);
  assert.equal((await api("POST", "/configuracion/empresa/logo/upload", { size: 10, contentType: "image/svg+xml" })).status, 400);
  assert.equal((await api("PUT", "/configuracion/empresa", { ...company, logoPath: `/objects/uploads/${randomUUID()}` })).status, 403);
  actor = staff;
  assert.equal((await api("GET", "/configuracion/empresa")).data.razonSocial, company.razonSocial);
  assert.equal((await api("PUT", "/configuracion/empresa", company)).status, 403);
  assert.equal((await api("POST", "/configuracion/empresa/logo/upload", { size: 10, contentType: "image/png" })).status, 403);
  actor = outsider;
  assert.equal((await api("GET", "/configuracion/empresa")).data.razonSocial, "");
  actor = owner;
  const [cliente] = await D.db.insert(D.clientesTable).values({ nombre: "Receptor Prueba", giro: "Comercio", rut: "76.086.428-5",
    direccion: "Dirección del receptor", userId: owner.id, organizationId: org.id }).returning();
  const input = { clienteId: cliente.id, fechaEmision: "2026-11-06", fechaVencimiento: "2026-12-06",
    moneda: "CLP", decimales: 0, porcentajeIva: 19, notas: "Notas conservadas", tiempoEntrega: "5 días",
    items: [{ descripcion: "Servicio de diseño", cantidad: 2, precioUnitario: 10000, descuentoPorcentaje: 10 }] };
  const created = await api("POST", "/cotizaciones", input);
  assert.equal(created.status, 201);
  const q = created.data;
  assert.equal(q.clienteGiro, "Comercio");
  assert.equal(q.formaPago, company.condicionesPago);
  assert.equal(q.validezDias, 30);
  assert.equal(q.total, 21420);
  const pdf = await fetch(`${base}/cotizaciones/${q.id}/pdf`);
  assert.equal(pdf.status, 200);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  const text = spawnSync("pdftotext", ["-", "-"], { input: bytes, encoding: "utf8" });
  assert.equal(text.status, 0);
  for (const expected of ["Empresa Documentos Prueba", "Receptor Prueba", "Comercio", "50% anticipo", "5 días", "21.420", "Gracias por preferirnos", "nextcob.com"])
    assert.ok(text.stdout.includes(expected), `Missing PDF content: ${expected}`);
  const [cobro] = await D.db.insert(D.cobrosTable).values({ responsableId: owner.id, organizationId: org.id, clienteId: cliente.id,
    descripcion: "Servicio", monto: "1190", montoNeto: "1000", montoIva: "190", incluyeIva: true, montoDescuento: "90",
    tipoDocumento: "factura_afecta", numeroDocumento: "COB-TEST", clienteNombre: cliente.nombre }).returning();
  const cpdf = await fetch(`${base}/cobros/${cobro.id}/pdf`);
  assert.equal(cpdf.status, 200);
  const ctext = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(await cpdf.arrayBuffer()), encoding: "utf8" }).stdout;
  assert.ok(ctext.includes("1.100") && ctext.includes("Descuento") && ctext.includes("Comercio"));
  await D.db.update(D.cotizacionesTable).set({ fechaVencimiento: "2026-11-16", validezDias: 30 }).where(eq(D.cotizacionesTable.id, q.id));
  const historical = (await api("GET", `/cotizaciones/${q.id}`)).data;
  assert.equal(historical.validezDias, 10, "Historical expiry overrides the new 30-day default");
  assert.equal(historical.total, 21420);
  assert.equal((await api("PATCH", `/cotizaciones/${q.id}`, { ...input, fechaVencimiento: "2026-11-16", tiempoEntrega: undefined })).data.tiempoEntrega, "5 días", "Older clients preserve saved commercial conditions");
  actor = outsider;
  assert.equal((await fetch(`${base}/cotizaciones/${q.id}/pdf`)).status, 404);
  assert.equal((await fetch(`${base}/cobros/${cobro.id}/pdf`)).status, 404);
  authenticated = false;
  assert.equal((await api("GET", "/configuracion/empresa")).status, 401);
  assert.equal((await fetch(`${base}/cobros/${cobro.id}/pdf`)).status, 401);
  console.log("PASS company scope/read/write permissions, upload metadata/ownership guards, quote conditions, actual PDF text, cobro discounts and cross-tenant PDF isolation");
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (pool) await pool.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
