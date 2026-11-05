import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
const originalUrl = process.env.DATABASE_URL!;
const schema = `inventario_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: originalUrl });
let pool: { end(): Promise<void> } | undefined;
let server: http.Server | undefined;
try {
  await admin.connect();
  await admin.query(`create schema "${schema}"`);
  for (const table of ["productos", "movimientos_stock", "cobros", "users", "organizaciones", "locales", "bodegas", "stock_por_bodega"]) {
    await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
  }
  for (const table of ["productos", "movimientos_stock", "cobros", "organizaciones", "locales", "bodegas", "stock_por_bodega"]) {
    await admin.query(`create sequence "${schema}"."${table}_seq"`);
    await admin.query(`alter table "${schema}"."${table}" alter column id set default nextval('"${schema}"."${table}_seq"')`);
  }
  const url = new URL(originalUrl);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const { db, pool: p, usersTable, organizacionesTable, productosTable, cobrosTable, movimientosStockTable } = await import("@workspace/db");
  pool = p;
  const { eq, and } = await import("drizzle-orm");
  const { initializeInventarioTriggers } = await import("../src/lib/inventario-triggers");
  const { resolveItemsInventario, productoValues, productoBody } = await import("../src/lib/inventario");
  await initializeInventarioTriggers();
  const router = (await import("../src/routes/inventario")).default;
  const express = (await import("express")).default;
  const [owner, colleague, outsider] = await db.insert(usersTable).values(
    ["owner", "colleague", "outsider"].map((n, i) => ({
      id: `inventory-${n}`, email: `${n}@inventory.test.invalid`, accountSeq: i + 10000,
      firstName: n, activo: true, esDemo: true, profileCompleted: true,
    })),
  ).returning();
  const [org] = await db.insert(organizacionesTable).values({ nombre: "Inventory test", ownerId: owner.id }).returning();
  for (const user of [owner, colleague]) await db.update(usersTable).set({ organizationId: org.id }).where(eq(usersTable.id, user.id));
  let actor = owner;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = actor;
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error() {}, warn() {}, info() {} };
    next();
  });
  app.use("/api", router);
  app.use("/api", (await import("../src/routes/locales")).default);
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  async function api(method: string, path: string, data?: unknown) {
    const r = await fetch(`http://127.0.0.1:${port}/api/inventario${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, data: await r.json() };
  }
  const input = { nombre: "Producto test", tipo: "producto", costoUnitario: 1000, precioUnitario: 2000, margenPorcentaje: 50, stockActual: 10, stockCritico: 2 };
  const created = await api("POST", "", input);
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.data.id;
  assert.equal(created.data.precioCalculado, 2000);
  assert.equal(created.data.margenReal, 50);
  assert.equal(productoValues(productoBody.parse({ ...input, metodoCalculo: "recargo" })).precioCalculado, "1500");
  const svc = await api("POST", "", { ...input, nombre: "Servicio test", tipo: "servicio", tarifaHora: 10000, tiempoEstimadoHoras: 2, factorFactibilidad: 1.5, precioUnitario: 30000 });
  assert.equal(svc.status, 201);
  assert.equal(svc.data.stockActual, null);
  assert.equal(svc.data.precioCalculado, 30000);
  assert.equal((await api("POST", `/${svc.data.id}/movimientos`, { tipo: "entrada", cantidad: 1, motivo: "test" })).status, 400);
  assert.equal((await api("POST", "", { ...input, tipo: "servicio", tarifaHora: 1, tiempoEstimadoHoras: 1, factorFactibilidad: 3 })).status, 400);
  console.log("PASS calculators and service stock isolation");
  actor = outsider;
  assert.equal((await api("GET", `/${id}`)).status, 404);
  assert.equal((await api("GET", `/${id}/movimientos`)).status, 404);
  assert.equal((await api("GET", "")).data.length, 0);
  await assert.rejects(() => resolveItemsInventario(actor.id, [{ productoId: id, cantidad: 1, precioUnitario: 2000 }], 2000));
  actor = colleague;
  assert.equal((await api("GET", `/${id}`)).status, 200);
  console.log("PASS organization isolation and shared catalog");
  actor = owner;
  assert.equal((await api("POST", `/${id}/movimientos`, { tipo: "salida", cantidad: 11, motivo: "insuficiente" })).status, 400);
  await Promise.all([1, 2].map(() => api("POST", `/${id}/movimientos`, { tipo: "salida", cantidad: 4, motivo: "Consumo interno" })));
  assert.equal((await api("GET", `/${id}`)).data.stockActual, 2);
  assert.equal((await api("GET", "/resumen")).data.criticos, 1);
  await api("POST", `/${id}/movimientos`, { tipo: "ajuste", cantidad: 10, motivo: "Ajuste de inventario" });
  assert.equal((await api("PATCH", `/${id}`, { ...input, stockActual: 999 })).data.stockActual, 10);
  const snapshot = await resolveItemsInventario(actor.id, [
    { productoId: id, cantidad: 3, precioUnitario: 2000 },
    { productoId: svc.data.id, cantidad: 1, precioUnitario: 30000 },
  ], 36000);
  await assert.rejects(() => resolveItemsInventario(actor.id, snapshot, 1));
  const [charge] = await db.insert(cobrosTable).values({
    monto: "36000", descripcion: "Venta test", responsableId: owner.id, organizationId: org.id, itemsInventario: snapshot,
  }).returning();
  assert.equal((await api("GET", `/${id}`)).data.stockActual, 10);
  await db.update(cobrosTable).set({ estado: "parcial" }).where(eq(cobrosTable.id, charge.id));
  assert.equal((await api("GET", `/${id}`)).data.stockActual, 10);
  await Promise.all([1, 2].map(() => db.update(cobrosTable).set({ estado: "pagado" }).where(eq(cobrosTable.id, charge.id))));
  assert.equal((await api("GET", `/${id}`)).data.stockActual, 7);
  await db.update(cobrosTable).set({ estado: "pendiente" }).where(eq(cobrosTable.id, charge.id));
  await db.update(cobrosTable).set({ estado: "pagado" }).where(eq(cobrosTable.id, charge.id));
  assert.equal((await api("GET", `/${id}`)).data.stockActual, 7);
  const sales = await db.select().from(movimientosStockTable).where(eq(movimientosStockTable.referenciaCobroId, charge.id));
  assert.equal(sales.length, 1);
  assert.equal(sales[0].productoId, id);
  assert.equal((await api("GET", `/${svc.data.id}`)).data.stockActual, null);
  await assert.rejects(() => db.update(cobrosTable).set({ itemsInventario: [] }).where(eq(cobrosTable.id, charge.id)));
  await assert.rejects(() => db.insert(cobrosTable).values({ monto: "36000", descripcion: "Intruso", responsableId: outsider.id, itemsInventario: snapshot }));
  await db.insert(cobrosTable).values({ monto: "36000", descripcion: "Stock insuficiente pero pagado", responsableId: owner.id, organizationId: org.id, estado: "pagado", itemsInventario: [{ ...snapshot[0], cantidad: 10 }] });
  assert.equal((await api("GET", `/${id}`)).data.stockActual, -3);
  assert.equal((await api("GET", `/${id}`)).data.estadoStock, "agotado");
  console.log("PASS atomic manual movement, critical count, paid transition, replay, service exemption, immutable lines, insufficient-stock payment");
  async function locationApi(method: string, path: string, data?: unknown) {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, data: await r.json() };
  }
  const local = await locationApi("POST", "/locales", { nombre: "Principal", direccion: "Dirección sintética" });
  assert.equal(local.status, 201);
  const first = await locationApi("POST", "/bodegas", { nombre: "A", localId: local.data.id });
  assert.equal(first.status, 201, JSON.stringify(first));
  const wa = first.data.id;
  let product = (await api("GET", `/${id}`)).data;
  assert.equal(product.stockActual, -3);
  assert.equal(product.ubicaciones[0].stockActual, -3);
  assert.equal(product.ubicaciones[0].bodegaId, wa);
  assert.equal(product.codigoInterno, `PROD-${String(id).padStart(4, "0")}`);
  assert.equal((await api("GET", `/${svc.data.id}`)).data.ubicaciones.length, 0);
  const second = await locationApi("POST", "/bodegas", { nombre: "B", localId: local.data.id });
  assert.equal(second.status, 201);
  const wb = second.data.id;
  assert.equal((await api("POST", "", input)).status, 400);
  assert.equal((await api("POST", "", { ...input, bodegaId: wa, unidadMedida: "hora" })).status, 400);
  const coded = await api("POST", "", { ...input, bodegaId: wa, codigoInterno: "ABC-123", sku: "SKU1", codigoBarras: "12345678", unidadMedida: "caja" });
  assert.equal(coded.status, 201, JSON.stringify(coded));
  assert.equal(coded.data.codigoBarras, "12345678");
  assert.equal((await api("POST", "", { ...input, bodegaId: wa, codigoInterno: "abc-123" })).status, 400);
  assert.equal((await api("PATCH", `/${coded.data.id}`, { ...input, codigoInterno: "ABC-123", sku: "", codigoBarras: "" })).data.codigoBarras, "");
  assert.equal((await api("POST", `/${id}/movimientos`, { tipo: "entrada", cantidad: 1, motivo: "texto libre", bodegaDestinoId: wa })).status, 400);
  assert.equal((await api("POST", `/${id}/movimientos`, { tipo: "salida", cantidad: 1, motivo: "Cobro", bodegaOrigenId: wa })).status, 400);
  assert.equal((await api("POST", `/${id}/movimientos`, { tipo: "entrada", cantidad: 1, motivo: "Ingreso por compra" })).status, 400);
  await api("POST", `/${id}/movimientos`, { tipo: "ajuste", cantidad: 10, motivo: "Ajuste de inventario", bodegaDestinoId: wa });
  const transfer = { tipo: "salida", cantidad: 4, motivo: "Movimiento entre bodegas", bodegaOrigenId: wa, bodegaDestinoId: wb };
  const countBefore = (await api("GET", `/${id}/movimientos`)).data.length;
  assert.equal((await api("POST", `/${id}/movimientos`, transfer)).status, 201);
  product = (await api("GET", `/${id}`)).data;
  assert.equal(product.stockActual, 10);
  assert.equal(product.ubicaciones.find((s: any) => s.bodegaId === wa).stockActual, 6);
  assert.equal(product.ubicaciones.find((s: any) => s.bodegaId === wb).stockActual, 4);
  const history = (await api("GET", `/${id}/movimientos`)).data;
  assert.equal(history.length, countBefore + 1);
  assert.equal(history[0].bodegaOrigenId, wa);
  assert.equal(history[0].bodegaDestinoId, wb);
  const concurrent = await Promise.all([1, 2].map(() => api("POST", `/${id}/movimientos`, { ...transfer, cantidad: 5 })));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 400]);
  product = (await api("GET", `/${id}`)).data;
  assert.equal(product.stockActual, 10);
  assert.equal(product.ubicaciones.find((s: any) => s.bodegaId === wa).stockActual, 1);
  assert.equal(product.ubicaciones.find((s: any) => s.bodegaId === wb).stockActual, 9);
  const threshold = await locationApi("PATCH", `/bodegas/${wa}/productos/${id}`, { stockCritico: 2 });
  assert.equal(threshold.status, 200);
  assert.equal(threshold.data.estadoStock, "critico");
  assert.equal((await api("GET", "/resumen")).data.criticos, 1);
  actor = outsider;
  assert.equal((await locationApi("GET", `/locales/${local.data.id}`)).status, 404);
  assert.equal((await locationApi("GET", `/bodegas/${wa}`)).status, 404);
  assert.equal((await locationApi("GET", "/bodegas")).data.length, 0);
  assert.equal((await locationApi("POST", "/bodegas", { localId: local.data.id, nombre: "Intruso" })).status, 404);
  const otherLocal = await locationApi("POST", "/locales", { nombre: "Otro" });
  const otherWarehouse = await locationApi("POST", "/bodegas", { nombre: "Ajena", localId: otherLocal.data.id });
  actor = owner;
  assert.equal((await api("POST", `/${id}/movimientos`, { ...transfer, bodegaDestinoId: otherWarehouse.data.id })).status, 400);
  await assert.rejects(() => resolveItemsInventario(owner.id, [{ productoId: id, cantidad: 1, precioUnitario: 2000, bodegaId: otherWarehouse.data.id }], 2000));
  await assert.rejects(() => db.insert(cobrosTable).values({ monto: "2000", descripcion: "Bodega ajena", responsableId: owner.id, organizationId: org.id, itemsInventario: [{ ...snapshot[0], cantidad: 1, bodegaId: otherWarehouse.data.id }] }));
  const [autoCharge] = await db.insert(cobrosTable).values({
    monto: "4000", descripcion: "Bodega automática", responsableId: owner.id, organizationId: org.id,
    itemsInventario: [{ ...snapshot[0], cantidad: 2 }],
  }).returning();
  await Promise.all([1, 2].map(() => db.update(cobrosTable).set({ estado: "pagado" }).where(eq(cobrosTable.id, autoCharge.id))));
  const autoMoves = await db.select().from(movimientosStockTable).where(eq(movimientosStockTable.referenciaCobroId, autoCharge.id));
  assert.equal(autoMoves.length, 1);
  assert.equal(autoMoves[0].bodegaOrigenId, wb);
  assert.equal(autoMoves[0].motivo, "Cobro");
  const [selectedCharge] = await db.insert(cobrosTable).values({
    monto: "4000", descripcion: "Bodega explícita", responsableId: owner.id, organizationId: org.id, estado: "pagado",
    itemsInventario: [{ ...snapshot[0], cantidad: 2, bodegaId: wa }],
  }).returning();
  const [selectedMove] = await db.select().from(movimientosStockTable).where(eq(movimientosStockTable.referenciaCobroId, selectedCharge.id));
  assert.equal(selectedMove.bodegaOrigenId, wa);
  product = (await api("GET", `/${id}`)).data;
  assert.equal(product.stockActual, 6);
  assert.equal(product.ubicaciones.find((s: any) => s.bodegaId === wa).stockActual, -1);
  assert.equal(product.ubicaciones.find((s: any) => s.bodegaId === wb).stockActual, 7);
  assert.equal((await locationApi("GET", `/bodegas/${wb}`)).data.productos.find((p: any) => p.id === id).id, id);
  assert.equal((await locationApi("GET", `/locales/${local.data.id}`)).data.bodegas.length, 2);
  console.log("PASS first-warehouse migration, codes, units, reason validation, atomic transfer/concurrency, per-warehouse alerts, tenant boundaries and automatic/explicit payment warehouses");
  console.log("ALL INVENTORY TESTS PASSED (isolated database, no providers or customer messages)");
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool?.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
