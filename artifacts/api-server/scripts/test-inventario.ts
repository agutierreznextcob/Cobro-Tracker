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
  for (const table of ["productos", "movimientos_stock", "cobros", "users", "organizaciones"]) {
    await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
  }
  for (const table of ["productos", "movimientos_stock", "cobros", "organizaciones"]) {
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
  await Promise.all([1, 2].map(() => api("POST", `/${id}/movimientos`, { tipo: "salida", cantidad: 4, motivo: "concurrente" })));
  assert.equal((await api("GET", `/${id}`)).data.stockActual, 2);
  assert.equal((await api("GET", "/resumen")).data.criticos, 1);
  await api("POST", `/${id}/movimientos`, { tipo: "ajuste", cantidad: 10, motivo: "conteo físico" });
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
  console.log("ALL INVENTORY TESTS PASSED (isolated database, no providers or customer messages)");
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool?.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
