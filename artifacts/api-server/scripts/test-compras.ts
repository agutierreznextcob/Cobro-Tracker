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
  const tables = ["users", "organizaciones", "preferencias", "proveedores", "compras", "compra_items", "productos", "locales", "bodegas", "stock_por_bodega", "movimientos_stock",
    "historial_costos", "notificaciones", "notificacion_eventos", "notificacion_lecturas"];
  for (const table of tables) await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
  for (const table of tables.filter(t => !["users", "preferencias", "notificacion_eventos", "notificacion_lecturas"].includes(t))) {
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
  const receipt = { updatedAt: preview.data.updatedAt };
  assert.equal((await api("POST", `/compras/${id}/recepcion`, { updatedAt: "stale" })).status, 409);
  const [a, b] = await Promise.all([api("POST", `/compras/${id}/recepcion`, receipt), api("POST", `/compras/${id}/recepcion`, receipt)]);
  assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
  assert.equal(a.data.estado, "recibida"); assert.equal(a.data.itemsRecibidos, 2);
  let [p] = await db.select().from(productosTable).where(eq(productosTable.id, product.id));
  assert.equal(Number(p.stockActual), 5); assert.equal(Number(p.costoUnitario), 20.25);
  assert.equal(Number(p.precioCalculado), 28.93); assert.equal(Number(p.precioUnitario), 25, "Retail price unchanged");
  const costHistory = await db.select().from(D.historialCostosTable);
  assert.equal(costHistory.length, 1, "Concurrent receipt adds one cost history row");
  assert.equal(Number(costHistory[0].costoAnterior), 10);
  assert.equal(Number(costHistory[0].costoNuevo), 20.25, "Invoice cost is NET, not divided by invoice IVA");
  assert.equal(costHistory[0].numeroFactura, "TEST-1");
  const notices = await db.select().from(D.notificacionesTable);
  assert.equal(notices.length, 1);
  assert.match(notices[0].mensaje!, /El costo de Producto test se actualizó desde la factura Nº TEST-1\. Precio sugerido actualizado a/);
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
  assert.equal((await api("POST", `/compras/${executiveDraft.data.id}/recepcion`, { updatedAt: reject.data.updatedAt, decisiones: [{ productoId: product.id, costoAnterior: 10, actualizar: false }] })).status, 200, "Costs synchronize automatically even when legacy payload rejects cost update");
  [p] = await db.select().from(productosTable).where(eq(productosTable.id, product.id));
  assert.equal(Number(p.costoUnitario), 20.25); assert.equal(Number(p.stockActual), 10);
  const noWarehouse = await api("POST", "/compras", { ...draft, numeroFactura: "NO-WH", items: [{ ...draft.items[0], bodegaDestinoId: null }] });
  const noWhPreview = await api("GET", `/compras/${noWarehouse.data.id}/recepcion`);
  assert.equal((await api("POST", `/compras/${noWarehouse.data.id}/recepcion`, { updatedAt: noWhPreview.data.updatedAt, decisiones: [{ productoId: product.id, costoAnterior: 30, actualizar: true }] })).status, 400);
  [p] = await db.select().from(productosTable).where(eq(productosTable.id, product.id));
  assert.equal(Number(p.stockActual), 10); assert.equal(Number(p.costoUnitario), 20.25, "Failed receipt rolls back costs and stock");
  assert.equal((await db.select().from(D.historialCostosTable)).length, 2);
  assert.equal((await db.select().from(D.notificacionesTable)).length, 2, "Failed receipt writes no notification");
  assert.equal((await api("DELETE", `/compras/${noWarehouse.data.id}`)).status, 204);
  const returnPath = `/compras/${id}/devoluciones`;
  const [lineA, lineB, freeLine] = a.data.items;
  const returnInput = { clave: randomUUID(), motivo: "Mercadería dañada", items: [{ itemId: lineA.id, cantidad: 0.5 }] };
  actor = outsider;
  assert.equal((await api("GET", returnPath)).status, 404);
  assert.equal((await api("POST", returnPath, returnInput)).status, 404);
  actor = executive;
  assert.equal((await api("POST", returnPath, returnInput)).status, 403);
  actor = supervisor;
  const draftReturn = await api("POST", "/compras", { ...draft, numeroFactura: "RETURN-DRAFT" });
  assert.equal((await api("POST", `/compras/${draftReturn.data.id}/devoluciones`, returnInput)).status, 409);
  assert.equal((await api("POST", returnPath, { ...returnInput, items: [{ itemId: freeLine.id, cantidad: 1 }] })).status, 400);
  assert.equal((await api("POST", returnPath, { ...returnInput, items: [{ itemId: edited.data.items[0].id, cantidad: 1 }] })).status, 400);
  assert.equal((await api("POST", returnPath, { ...returnInput, items: [returnInput.items[0], returnInput.items[0]] })).status, 400);
  for (const cantidad of [0, -1, 0.0001, 1e9])
    assert.equal((await api("POST", returnPath, { ...returnInput, items: [{ itemId: lineA.id, cantidad }] })).status, 400);
  const returns = await Promise.all([api("POST", returnPath, returnInput), api("POST", returnPath, returnInput)]);
  assert(returns.every(r => r.status === 200), JSON.stringify(returns));
  assert.equal((await api("GET", returnPath)).data.length, 1, "Concurrent replay creates only one movement");
  assert.equal((await api("POST", returnPath, { ...returnInput, motivo: "Otro motivo" })).status, 409);
  const race = await Promise.all([1, 2].map(() => api("POST", returnPath, {
    clave: randomUUID(), motivo: "Resto A", items: [{ itemId: lineA.id, cantidad: 1.5 }],
  })));
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409], "Distinct simultaneous returns cannot exceed receipt");
  const [afterA] = await db.select().from(productosTable).where(eq(productosTable.id, product.id));
  assert.equal(Number(afterA.stockActual), 8);
  assert.equal(Number(afterA.costoUnitario), 20.25);
  assert.equal(Number(afterA.precioUnitario), 25);
  // Exhaust B in a controlled fixture: a batch that first updates A must roll back entirely.
  const { and } = await import("drizzle-orm");
  await db.update(stockPorBodegaTable).set({ stockActual: "0" }).where(and(eq(stockPorBodegaTable.productoId, product.id), eq(stockPorBodegaTable.bodegaId, warehouseB.id)));
  await db.update(productosTable).set({ stockActual: "2" }).where(eq(productosTable.id, product.id));
  const otherReturnPath = `/compras/${executiveDraft.data.id}/devoluciones`;
  const otherItems = (await api("GET", `/compras/${executiveDraft.data.id}`)).data.items;
  const batch = { clave: randomUUID(), motivo: "Devolver lote", items: [
    { itemId: otherItems[0].id, cantidad: 1 }, { itemId: otherItems[1].id, cantidad: 1 },
  ] };
  assert.equal((await api("POST", otherReturnPath, batch)).status, 409);
  assert.equal((await api("GET", otherReturnPath)).data.length, 0);
  assert.equal(Number((await db.select().from(productosTable).where(eq(productosTable.id, product.id)))[0].stockActual), 2, "Failed batch rolls back stock");
  await db.update(stockPorBodegaTable).set({ stockActual: "6" }).where(and(eq(stockPorBodegaTable.productoId, product.id), eq(stockPorBodegaTable.bodegaId, warehouseB.id)));
  await db.update(productosTable).set({ stockActual: "8" }).where(eq(productosTable.id, product.id));
  actor = owner;
  assert.equal((await api("POST", returnPath, { clave: randomUUID(), motivo: "Resto B", items: [{ itemId: lineB.id, cantidad: 3 }] })).status, 200);
  assert.equal((await api("POST", returnPath, { clave: randomUUID(), motivo: "Exceso", items: [{ itemId: lineB.id, cantidad: 0.001 }] })).status, 409);
  assert.equal((await api("POST", returnPath, returnInput)).status, 200, "Replay remains successful after full return");
  const hist = (await api("GET", returnPath)).data;
  assert.equal(hist.reduce((n: number, r: any) => n + r.cantidad, 0), 5);
  assert(hist.every((r: any) => r.usuarioId && r.creadoEn && [warehouseA.id, warehouseB.id].includes(r.bodegaId)));
  const finalDoc = (await api("GET", `/compras/${id}`)).data;
  assert.equal(finalDoc.estado, "contabilizada"); assert.equal(finalDoc.total, 127.03);
  assert.equal((await api("DELETE", `/compras/${id}`)).status, 409);
  assert.equal(Number((await db.select().from(productosTable).where(eq(productosTable.id, product.id)))[0].stockActual), 5);
  await db.update(preferenciasTable).set({ decimales: 2 }).where(eq(preferenciasTable.scope, `org:${org.id}`));
  const [zeroCost] = await db.insert(productosTable).values({ nombre: "Sin costo", tipo: "producto", usuarioId: owner.id, organizationId: org.id,
    costoUnitario: "0", precioUnitario: "99", margenPorcentaje: "20", stockActual: "0", incluyeIvaPrecio: true, porcentajeIvaPrecio: "19" }).returning();
  const zeroInvoice = await api("POST", "/compras", { ...draft, numeroFactura: "ZERO-COST", items: [
    { productoId: zeroCost.id, descripcion: "Sin costo", cantidad: 1, precioUnitario: 800, bodegaDestinoId: warehouseA.id },
  ] });
  assert.equal(zeroInvoice.status, 201);
  const zeroPreview = await api("GET", `/compras/${zeroInvoice.data.id}/recepcion`);
  assert.equal((await api("POST", `/compras/${zeroInvoice.data.id}/recepcion`, { updatedAt: zeroPreview.data.updatedAt })).status, 200);
  const [synced] = await db.select().from(productosTable).where(eq(productosTable.id, zeroCost.id));
  assert.equal(Number(synced.costoUnitario), 800);
  assert.equal(Number(synced.precioCalculadoNeto), 1000);
  assert.equal(Number(synced.precioCalculado), 1190, "Automatic suggested price uses stored IVA and margin");
  assert.equal(Number(synced.precioUnitario), 99, "Cost sync never adopts the suggested retail price");
  const beforeHistories = (await db.select().from(D.historialCostosTable)).length;
  const beforeNotifications = (await db.select().from(D.notificacionesTable)).length;
  const rollbackInvoice = await api("POST", "/compras", { ...draft, numeroFactura: "ROLLBACK-COST", items: [
    { productoId: product.id, descripcion: "First", cantidad: 1, precioUnitario: 50, bodegaDestinoId: warehouseA.id },
    { productoId: zeroCost.id, descripcion: "Second", cantidad: 1, precioUnitario: 900, bodegaDestinoId: null },
  ] });
  const rollbackPreview = await api("GET", `/compras/${rollbackInvoice.data.id}/recepcion`);
  assert.equal((await api("POST", `/compras/${rollbackInvoice.data.id}/recepcion`, { updatedAt: rollbackPreview.data.updatedAt })).status, 400);
  assert.equal((await db.select().from(D.historialCostosTable)).length, beforeHistories);
  assert.equal((await db.select().from(D.notificacionesTable)).length, beforeNotifications, "Earlier product notification rolls back if later line fails");
  assert.equal(Number((await db.select().from(productosTable).where(eq(productosTable.id, product.id)))[0].costoUnitario), 20.25);
  console.log("PASS compras + devoluciones + automatic NET costs, IVA suggested price, zero-cost initialization, no retail change, exactly-once history/notifications and full receipt rollback");
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (pool) await pool.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
