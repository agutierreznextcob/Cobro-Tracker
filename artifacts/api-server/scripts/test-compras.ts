import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type http from "node:http";
const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
const originalUrl = process.env.DATABASE_URL!;
const schema = `compras_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: originalUrl });
let pool: { end(): Promise<void> } | undefined;
let server: http.Server | undefined;
try {
  await admin.connect();
  await admin.query(`create schema "${schema}"`);
  const tables = ["users", "organizaciones", "preferencias", "proveedores", "compras", "compra_items", "productos", "locales", "bodegas", "stock_por_bodega", "movimientos_stock"];
  for (const table of tables) await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
  for (const table of tables.filter(t => !["users", "preferencias"].includes(t))) {
    await admin.query(`create sequence "${schema}"."${table}_seq"`);
    await admin.query(`alter table "${schema}"."${table}" alter column id set default nextval('"${schema}"."${table}_seq"')`);
  }
  const url = new URL(originalUrl); url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const D = await import("@workspace/db");
  const { db, usersTable, organizacionesTable, productosTable, localesTable, bodegasTable, preferenciasTable, comprasTable, stockPorBodegaTable, movimientosStockTable } = D;
  pool = D.pool;
  const { eq } = await import("drizzle-orm");
  const [owner, supervisor, executive, outsider] = await db.insert(usersTable).values(["owner", "supervisor", "executive", "outsider"].map((name, i) => ({
    id: `compras-${name}`, email: `${name}@compras.invalid`, accountSeq: i + 12340,
    firstName: name, activo: true, esDemo: true, profileCompleted: true,
  }))).returning();
  const [org] = await db.insert(organizacionesTable).values({ nombre: "Compras test", ownerId: owner.id }).returning();
  for (const [u, role] of [[owner, "admin_org"], [supervisor, "supervisor"], [executive, "ejecutivo"]] as const)
    await db.update(usersTable).set({ organizationId: org.id, orgRole: role }).where(eq(usersTable.id, u.id));
  await db.insert(preferenciasTable).values({ scope: `org:${org.id}`, decimales: 2 });
  const [local] = await db.insert(localesTable).values({ nombre: "Test local", usuarioId: owner.id, organizationId: org.id }).returning();
  const [warehouseA, warehouseB] = await db.insert(bodegasTable).values([{ localId: local.id, nombre: "A" }, { localId: local.id, nombre: "B" }]).returning();
  const [otherLocal] = await db.insert(localesTable).values({ nombre: "Other", usuarioId: outsider.id }).returning();
  const [otherWarehouse] = await db.insert(bodegasTable).values({ localId: otherLocal.id, nombre: "Other" }).returning();
  const [product, foreignProduct] = await db.insert(productosTable).values([
    { nombre: "Producto test", tipo: "producto" as const, usuarioId: owner.id, organizationId: org.id, costoUnitario: "10", precioUnitario: "25", margenPorcentaje: "30", stockActual: "0", moneda: "CLP" },
    { nombre: "Otro negocio", tipo: "producto" as const, usuarioId: outsider.id, costoUnitario: "10", precioUnitario: "25", stockActual: "0" },
  ]).returning();
  const express = (await import("express")).default;
  const app = express(); app.use(express.json());
  let actor = owner;
  app.use((req, _res, next) => {
    (req as any).user = actor; (req as any).isAuthenticated = () => true;
    (req as any).log = { error: (...args: unknown[]) => console.error(...args), info() {}, warn() {} }; next();
  });
  app.use("/api", (await import("../src/routes/compras")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  async function api(method: string, path: string, body?: unknown) {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: r.status === 204 ? null : await r.json() as any };
  }
  const supplier = await api("POST", "/proveedores", { razonSocial: "Proveedor test", rut: "76.123.456-0" });
  assert.equal(supplier.status, 201, JSON.stringify(supplier));
  const supplierId = supplier.data.id;
  assert.equal((await api("POST", "/proveedores", { razonSocial: "Duplicado", rut: "76123456-0" })).status, 409);
  const draft = { numeroFactura: "TEST-1", proveedorId: supplierId, fechaEmision: "2026-11-01", fechaRecepcion: "2026-11-05", moneda: "CLP", porcentajeIva: 19, notas: "Original", items: [
    { productoId: product.id, descripcion: "Producto A", cantidad: 2, precioUnitario: 20.25, bodegaDestinoId: warehouseA.id },
    { productoId: product.id, descripcion: "Producto B", cantidad: 3, precioUnitario: 20.25, bodegaDestinoId: warehouseB.id },
    { descripcion: "Flete", cantidad: 1, precioUnitario: 5.5 },
  ] };
  const made = await api("POST", "/compras", draft);
  assert.equal(made.status, 201, JSON.stringify(made)); const id = made.data.id;
  assert.equal(made.data.total, 127.03); assert.equal(made.data.decimales, 2);
  assert.equal((await db.select().from(movimientosStockTable)).length, 0);
  assert.equal((await api("POST", "/compras", draft)).status, 409);
  assert.equal((await api("POST", "/compras", { ...draft, numeroFactura: "DATE", fechaEmision: "2026-02-30" })).status, 400);
  actor = outsider;
  assert.equal((await api("GET", `/compras/${id}`)).status, 404);
  assert.equal((await api("GET", `/proveedores/${supplierId}`)).status, 404);
  assert.equal((await api("GET", "/compras")).data.length, 0);
  assert.equal((await api("POST", "/compras", { ...draft, numeroFactura: "CROSS" })).status, 404);
  actor = executive;
  assert.equal((await api("POST", `/compras/${id}/recepcion`, { updatedAt: made.data.updatedAt, decisiones: [] })).status, 403);
  const executiveDraft = await api("POST", "/compras", { ...draft, numeroFactura: "EXEC" });
  assert.equal(executiveDraft.status, 201); assert.equal(executiveDraft.data.puedeRecibir, false);
  actor = supervisor;
  assert.equal((await api("POST", "/compras", { ...draft, numeroFactura: "FOREIGN", items: [{ ...draft.items[0], productoId: foreignProduct.id }] })).status, 400);
  assert.equal((await api("POST", "/compras", { ...draft, numeroFactura: "FOREIGN-WH", items: [{ ...draft.items[0], bodegaDestinoId: otherWarehouse.id }] })).status, 400);
  const preview = await api("GET", `/compras/${id}/recepcion`);
  assert.equal(preview.status, 200); assert.equal(preview.data.cambiosCostos.length, 1);
  const receipt = { updatedAt: preview.data.updatedAt, decisiones: [{ productoId: product.id, actualizar: true, costoAnterior: 10 }] };
  assert.equal((await api("POST", `/compras/${id}/recepcion`, { ...receipt, decisiones: [] })).status, 409);
  const [a, b] = await Promise.all([api("POST", `/compras/${id}/recepcion`, receipt), api("POST", `/compras/${id}/recepcion`, receipt)]);
  assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
  assert.equal(a.data.estado, "recibida"); assert.equal(a.data.itemsRecibidos, 2);
  let [p] = await db.select().from(productosTable).where(eq(productosTable.id, product.id));
  assert.equal(Number(p.stockActual), 5); assert.equal(Number(p.costoUnitario), 20.25);
  assert.equal(Number(p.precioCalculado), 28.93); assert.equal(Number(p.precioUnitario), 25, "Retail price unchanged");
  const stock = await db.select().from(stockPorBodegaTable);
  assert.equal(Number(stock.find(s => s.bodegaId === warehouseA.id)!.stockActual), 2);
  assert.equal(Number(stock.find(s => s.bodegaId === warehouseB.id)!.stockActual), 3);
  const moves = await db.select().from(movimientosStockTable);
  assert.equal(moves.length, 2); assert(moves.every(m => m.referenciaCompraId === id && m.motivo === "Ingreso por compra"));
  assert.equal((await api("DELETE", `/compras/${id}`)).status, 409);
  assert.equal((await api("PATCH", `/compras/${id}`, { ...draft, updatedAt: a.data.updatedAt })).status, 409);
  const supplierStats = await api("GET", `/proveedores/${supplierId}`);
  assert.equal(supplierStats.data.totales[0].acumulado, 127.03, "Drafts excluded");
  assert.equal(supplierStats.data.productosMasComprados[0].cantidad, 5);
  assert.equal((await api("POST", `/compras/${id}/contabilizar`)).data.estado, "contabilizada");
  assert.equal((await api("POST", `/compras/${id}/recepcion`, receipt)).data.estado, "contabilizada");
  await db.update(preferenciasTable).set({ decimales: 0 }).where(eq(preferenciasTable.scope, `org:${org.id}`));
  const edited = await api("PATCH", `/compras/${executiveDraft.data.id}`, { ...draft, numeroFactura: "EXEC", updatedAt: executiveDraft.data.updatedAt, notas: "Changed" });
  assert.equal(edited.status, 200); assert.equal(edited.data.decimales, 2);
  assert.equal((await api("PATCH", `/compras/${executiveDraft.data.id}`, { ...draft, numeroFactura: "EXEC", updatedAt: executiveDraft.data.updatedAt })).status, 409);
  const reject = await api("GET", `/compras/${executiveDraft.data.id}/recepcion`);
  await db.update(productosTable).set({ costoUnitario: "30" }).where(eq(productosTable.id, product.id));
  assert.equal((await api("POST", `/compras/${executiveDraft.data.id}/recepcion`, { updatedAt: reject.data.updatedAt, decisiones: [] })).status, 409, "Concurrent cost change must require fresh decision");
  const rejectNew = await api("GET", `/compras/${executiveDraft.data.id}/recepcion`);
  assert.equal((await api("POST", `/compras/${executiveDraft.data.id}/recepcion`, { updatedAt: rejectNew.data.updatedAt, decisiones: [{ productoId: product.id, costoAnterior: 30, actualizar: false }] })).status, 200);
  [p] = await db.select().from(productosTable).where(eq(productosTable.id, product.id));
  assert.equal(Number(p.costoUnitario), 30); assert.equal(Number(p.stockActual), 10);
  const noWarehouse = await api("POST", "/compras", { ...draft, numeroFactura: "NO-WH", items: [{ ...draft.items[0], bodegaDestinoId: null }] });
  const noWhPreview = await api("GET", `/compras/${noWarehouse.data.id}/recepcion`);
  assert.equal((await api("POST", `/compras/${noWarehouse.data.id}/recepcion`, { updatedAt: noWhPreview.data.updatedAt, decisiones: [{ productoId: product.id, costoAnterior: 30, actualizar: true }] })).status, 400);
  [p] = await db.select().from(productosTable).where(eq(productosTable.id, product.id));
  assert.equal(Number(p.stockActual), 10); assert.equal(Number(p.costoUnitario), 30, "Failed receipt rolls back costs and stock");
  assert.equal((await api("DELETE", `/compras/${noWarehouse.data.id}`)).status, 204);
  console.log("PASS supplier CRUD/duplicate RUT, draft totals/IVA, tenant+warehouse isolation, executive guards, supervisor receipt, concurrent idempotency, stock by warehouse, cost accept/reject/stale decisions, no retail repricing, immutable received docs, preferences/history, supplier stats, contabilizar and rollback");
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (pool) await pool.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
