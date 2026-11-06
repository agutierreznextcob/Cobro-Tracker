import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { stockHistory, stockDelta, dayNumber, dayString, inicioPeriodo } from "../src/lib/informes-calculos";

const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
const originalUrl = process.env.DATABASE_URL!;
const schema = `informes_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: originalUrl });
let pool: { end(): Promise<void> } | undefined;
try {
  await admin.connect(); await admin.query(`create schema "${schema}"`);
  const tables = ["users", "organizaciones", "productos", "cobros", "cotizacion_items", "compras", "compra_items", "proveedores",
    "movimientos_stock", "stock_por_bodega", "bodegas", "locales"];
  for (const table of tables) {
    await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
    if (table !== "users") {
      await admin.query(`create sequence "${schema}"."${table}_seq"`);
      await admin.query(`alter table "${schema}"."${table}" alter column id set default nextval('"${schema}"."${table}_seq"')`);
    }
  }
  const url = new URL(originalUrl); url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const D = await import("@workspace/db"); pool = D.pool;
  const { eq } = await import("drizzle-orm");
  const { hoySantiago } = await import("../src/lib/preferencias");
  const { informeArea } = await import("../src/lib/informes");
  const today = hoySantiago(), day = (ago: number) => dayString(dayNumber(today) - ago);
  const date = (ago: number) => new Date(`${day(ago)}T16:00:00Z`);
  const [owner, staff, outsider] = await D.db.insert(D.usersTable).values(["owner", "staff", "outside"].map((n, i) => ({
    id: `reports-${n}`, accountSeq: 48000 + i, email: `${n}@reports.invalid`, activo: true, esDemo: true, profileCompleted: true,
  }))).returning();
  const [org] = await D.db.insert(D.organizacionesTable).values({ nombre: "Reports", ownerId: owner.id }).returning();
  await D.db.update(D.usersTable).set({ organizationId: org.id, orgRole: "admin_org" }).where(eq(D.usersTable.id, owner.id));
  await D.db.update(D.usersTable).set({ organizationId: org.id, orgRole: "ejecutivo" }).where(eq(D.usersTable.id, staff.id));
  const [product, service, slow, usd] = await D.db.insert(D.productosTable).values([
    { nombre: "Top físico", tipo: "producto" as const, stockActual: "0", costoUnitario: "20" },
    { nombre: "Servicio", tipo: "servicio" as const, stockActual: null, costoUnitario: "50" },
    { nombre: "Lento", tipo: "producto" as const, stockActual: "2", costoUnitario: "10" },
    { nombre: "Solo USD", tipo: "producto" as const, stockActual: "100", costoUnitario: "100", moneda: "USD" },
  ].map(p => ({ ...p, usuarioId: owner.id, organizationId: org.id, precioUnitario: "100", creadoEn: date(40) }))).returning();
  const charge = async (p: typeof product, qty: number, monto: string, ago: number, extra: Record<string, unknown> = {}) =>
    (await D.db.insert(D.cobrosTable).values({ descripcion: p.nombre, responsableId: owner.id, organizationId: org.id, monto,
      estado: "pagado", pagadoEn: date(ago), creadoEn: date(ago + 10),
      itemsInventario: [{ productoId: p.id, nombre: p.nombre, tipo: p.tipo, cantidad: qty, precioUnitario: 100 }], ...extra }).returning())[0];
  const c1 = await charge(product, 10, "1190", 6, { montoDescuento: "190" });
  const c2 = await charge(product, 5, "595", 4);
  const c3 = await charge(product, 3, "357", 2);
  await charge(service, 2, "238", 1);
  await charge(slow, 1, "50", 35, { responsableId: staff.id });
  await charge(usd, 999, "999", 1, { moneda: "USD" });
  await charge(product, 900, "99999", 0, { estado: "pendiente", pagadoEn: null });
  const events = [
    { tipo: "entrada" as const, cantidad: "10", creadoEn: date(39) },
    { tipo: "salida" as const, cantidad: "10", creadoEn: date(6), referenciaCobroId: c1.id },
    { tipo: "entrada" as const, cantidad: "5", creadoEn: date(5) },
    { tipo: "salida" as const, cantidad: "5", creadoEn: date(4), referenciaCobroId: c2.id },
    { tipo: "entrada" as const, cantidad: "3", creadoEn: date(3) },
    { tipo: "salida" as const, cantidad: "3", creadoEn: date(2), referenciaCobroId: c3.id },
  ];
  await D.db.insert(D.movimientosStockTable).values(events.map(m => ({ ...m, productoId: product.id, usuarioId: owner.id, motivo: "QA" })));
  const sales = await informeArea(owner.id, { area: "ventas", periodo: "7dias", moneda: "CLP", umbral: 5 });
  assert.equal(sales.total, 2190);
  assert.equal(sales.ventas[0].id, product.id);
  assert.equal(sales.ventas[0].unidades, 18);
  assert.equal(sales.ventas[0].ingresos, 1952);
  assert.equal(sales.ventas[1].tipo, "servicio");
  assert.equal(sales.menorMovimiento.find(p => p.id === slow.id)?.diasSinMovimiento, 35);
  const zero = await informeArea(owner.id, { area: "ventas", periodo: "7dias", moneda: "CLP", umbral: 0 });
  assert.deepEqual(zero.menorMovimiento.map(p => p.id), [slow.id]);
  const staffSales = await informeArea(staff.id, { area: "ventas", periodo: "7dias", moneda: "CLP" });
  assert.equal(staffSales.total, 0);
  assert.equal((await informeArea(outsider.id, { area: "ventas" })).ventas.length, 0);
  const inventory = await informeArea(owner.id, { area: "inventario", periodo: "7dias", moneda: "CLP" });
  assert.equal(inventory.ventas[0].unidades, 18);
  assert.ok(Math.abs(inventory.ventas[0].stockPromedio - 8 / 7) < 1e-8);
  assert.equal(inventory.ventas[0].rotacion, 15.75);
  assert.equal(inventory.quiebres.length, 3);
  assert.ok(inventory.quiebres.every(q => q.frecuencia === 3 && q.critico && q.stockMinimo === 3));
  assert.equal(inventory.totalStock, 20);
  assert.equal(inventory.ventas.some(r => r.tipo === "servicio"), false);
  const [local] = await D.db.insert(D.localesTable).values({ nombre: "Local QA", usuarioId: owner.id, organizationId: org.id }).returning();
  const [b1, b2] = await D.db.insert(D.bodegasTable).values([{ nombre: "Uno", localId: local.id }, { nombre: "Dos", localId: local.id }]).returning();
  await D.db.insert(D.stockPorBodegaTable).values([{ productoId: slow.id, bodegaId: b1.id, stockActual: "1" }, { productoId: slow.id, bodegaId: b2.id, stockActual: "1" }]);
  const located = await informeArea(owner.id, { area: "inventario", bodegaId: b1.id });
  assert.equal(located.totalStock, 10);
  assert.equal(located.valorizado.length, 1);
  assert.equal((await informeArea(owner.id, { area: "inventario", localId: 99999 })).totalStock, 0);
  const [supplier] = await D.db.insert(D.proveedoresTable).values({ razonSocial: "Proveedor QA", rut: "76.086.428-5", usuarioId: owner.id, organizationId: org.id }).returning();
  for (const [i, estado] of (["borrador", "recibida", "contabilizada"] as const).entries()) {
    const [invoice] = await D.db.insert(D.comprasTable).values({ numeroFactura: `${i}`, proveedorId: supplier.id, proveedorNombre: supplier.razonSocial,
      usuarioId: owner.id, organizationId: org.id, fechaEmision: day(4 - i), fechaRecepcion: day(4 - i), estado,
      subtotal: `${100 * (i + 1)}`, montoIva: "0", total: `${100 * (i + 1)}` }).returning();
    await D.db.insert(D.compraItemsTable).values({ compraId: invoice.id, descripcion: "Insumo", cantidad: `${i + 1}`, precioUnitario: "100", subtotalLinea: `${100 * (i + 1)}` });
  }
  const purchases = await informeArea(owner.id, { area: "compras", periodo: "7dias", moneda: "CLP" });
  assert.equal(purchases.total, 600); assert.equal(purchases.facturas, 3); assert.equal(purchases.ticketPromedio, 200);
  assert.equal(purchases.pendientes.reduce((s, i) => s + i.monto, 0), 300);
  assert.equal(purchases.proveedores[0].productos, "Insumo (6)");
  assert.equal(purchases.evolucion.length, 7);
  assert.equal((await informeArea(outsider.id, { area: "compras" })).facturas, 0);
  assert.equal((await informeArea(owner.id, { area: "compras", proveedorId: 99999 })).facturas, 0);
  assert.equal(inicioPeriodo("trimestre", "2026-11-06", "2020-01-01"), "2026-10-01");
  assert.equal(stockDelta({ ...events[1], id: 1, bodegaOrigenId: 1, bodegaDestinoId: 2, referenciaCobroId: null }), 0);
  const empty = stockHistory(0, today, [], day(6), today);
  assert.equal(empty.episodes.length, 0, "Never invent outages for products created with no stock");
  const negative = stockHistory(-2, day(4), [
    { id: 1, tipo: "entrada", cantidad: 4, creadoEn: date(2), bodegaOrigenId: null, bodegaDestinoId: null, referenciaCobroId: null },
    { id: 2, tipo: "salida", cantidad: 5, creadoEn: date(1), bodegaOrigenId: null, bodegaDestinoId: null, referenciaCobroId: 1 },
    { id: 3, tipo: "salida", cantidad: 1, creadoEn: date(0), bodegaOrigenId: null, bodegaDestinoId: null, referenciaCobroId: 2 },
  ], day(6), today);
  assert.equal(negative.episodes.length, 1, "Further negative sales do not create duplicate outage episodes");
  await D.db.insert(D.cotizacionItemsTable).values([
    { cotizacionId: 999, productoId: product.id, descripcion: "Catalog", cantidad: "10", precioUnitario: "100", descuentoPorcentaje: "0", subtotalLinea: "1000" },
    { cotizacionId: 999, productoId: null, descripcion: "Free text", cantidad: "1", precioUnitario: "1000", descuentoPorcentaje: "0", subtotalLinea: "1000" },
  ]);
  await charge(product, 100, "2380", 0, { cotizacionId: 999, montoDescuento: "380" });
  const allocated = await informeArea(owner.id, { area: "ventas", periodo: "7dias", moneda: "CLP" });
  assert.equal(allocated.total, 4190);
  assert.equal(allocated.ventas.find(r => r.id === product.id)?.unidades, 28);
  assert.equal(allocated.ventas.find(r => r.id === product.id)?.ingresos, 2952);
  assert.ok(allocated.ventas.reduce((s, r) => s + r.porcentaje, 0) < 100);
  console.log("PASS reporting: paid-date/discount allocation, services, currency and tenant isolation, low movement, weighted stock, outages, valuation filters, invoices/aging and supplier aggregation");
} finally {
  if (pool) await pool.end();
  await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end();
}
