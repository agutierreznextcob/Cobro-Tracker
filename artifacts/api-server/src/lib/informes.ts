import { db, cobrosTable, productosTable, movimientosStockTable, comprasTable, compraItemsTable, cotizacionItemsTable,
  stockPorBodegaTable, bodegasTable, localesTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { InformeArea, InformeProducto, GetInformeAreaParams } from "@workspace/api-zod";
import { inventarioScope } from "./inventario";
import { cobroScopeCondition } from "./org";
import { compraScope } from "./compras";
import { hoySantiago } from "./preferencias";
import { chileDay, dayNumber, dayString, inicioPeriodo, stockHistory } from "./informes-calculos";

export async function informeArea(userId: string, options: GetInformeAreaParams): Promise<InformeArea> {
  const { ctx, condition } = await inventarioScope(userId);
  const hoy = hoySantiago();
  const moneda = options.moneda ?? "CLP";
  return db.transaction(async tx => {
    const out: InformeArea = { desde: hoy, hasta: hoy, moneda, notas: "", total: 0, facturas: 0, ticketPromedio: 0,
      mesActual: 0, mesAnterior: 0, variacion: null, totalStock: 0, ventas: [], menorMovimiento: [], proveedores: [], pendientes: [], evolucion: [], valorizado: [], quiebres: [] };
    if (options.area === "compras") {
      const invoices = await tx.select().from(comprasTable).where(and(compraScope(ctx, userId), eq(comprasTable.moneda, moneda),
        options.proveedorId ? eq(comprasTable.proveedorId, options.proveedorId) : undefined));
      out.desde = inicioPeriodo(options.periodo ?? "mes", hoy, invoices.reduce((d, i) => i.fechaEmision < d ? i.fechaEmision : d, hoy));
      const selected = invoices.filter(i => i.fechaEmision >= out.desde && i.fechaEmision <= hoy);
      const lines = selected.length ? await tx.select().from(compraItemsTable).where(inArray(compraItemsTable.compraId, selected.map(i => i.id))) : [];
      const suppliers = new Map<number, { id: number; nombre: string; facturas: number; total: number; ultimaCompra: string; quantities: Map<string, number> }>();
      const series = new Map<string, number>();
      for (const i of selected) {
        const total = Number(i.total);
        out.total += total;
        const s = suppliers.get(i.proveedorId) ?? { id: i.proveedorId, nombre: i.proveedorNombre, facturas: 0, total: 0, ultimaCompra: "", quantities: new Map() };
        s.facturas++; s.total += total; if (i.fechaEmision > s.ultimaCompra) s.ultimaCompra = i.fechaEmision;
        for (const item of lines.filter(l => l.compraId === i.id)) s.quantities.set(item.descripcion, (s.quantities.get(item.descripcion) ?? 0) + Number(item.cantidad));
        suppliers.set(s.id, s);
        series.set(i.fechaEmision, (series.get(i.fechaEmision) ?? 0) + total);
        if (i.estado !== "contabilizada") out.pendientes.push({ id: i.id, numero: i.numeroFactura, proveedor: i.proveedorNombre,
          fecha: i.fechaEmision, monto: total, dias: Math.max(0, dayNumber(hoy) - dayNumber(i.fechaEmision)), estado: i.estado });
      }
      out.facturas = selected.length; out.ticketPromedio = out.facturas ? out.total / out.facturas : 0;
      out.proveedores = [...suppliers.values()].map(({ quantities, ...s }) => ({ ...s,
        productos: [...quantities].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => `${name} (${qty})`).join(", ") })).sort((a, b) => b.total - a.total);
      // Zero-filled daily series, or monthly for long history; never truncate.
      const monthly = dayNumber(hoy) - dayNumber(out.desde) > 366;
      const buckets = new Map<string, number>();
      for (let d = dayNumber(out.desde); d <= dayNumber(hoy); d++) {
        const date = dayString(d), key = monthly ? `${date.slice(0, 7)}-01` : date;
        buckets.set(key, (buckets.get(key) ?? 0) + (series.get(date) ?? 0));
      }
      out.evolucion = [...buckets].map(([fecha, total]) => ({ fecha, total }));
      const [year, month, day] = hoy.split("-").map(Number);
      const previousStart = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
      const previousEnd = `${previousStart.slice(0, 7)}-${String(Math.min(day, new Date(Date.UTC(year, month - 1, 0)).getUTCDate())).padStart(2, "0")}`;
      for (const i of invoices) {
        if (i.fechaEmision >= `${hoy.slice(0, 7)}-01` && i.fechaEmision <= hoy) out.mesActual += Number(i.total);
        if (i.fechaEmision >= previousStart && i.fechaEmision <= previousEnd) out.mesAnterior += Number(i.total);
      }
      out.variacion = out.mesAnterior ? (out.mesActual - out.mesAnterior) / out.mesAnterior * 100 : null;
      out.pendientes.sort((a, b) => b.dias - a.dias);
      out.notas = `Facturas por fecha de emisión, incluidos borradores y devoluciones sin restar: se informan importes originales. “Por pagar” significa no contabilizadas, no prueba un saldo de pago. Comparativa: mes actual hasta hoy contra los mismos días del mes anterior. Evolución ${monthly ? "mensual" : "diaria"}.`;
      return out;
    }
    const products = await tx.select().from(productosTable).where(and(condition, eq(productosTable.moneda, moneda)));
    const charges = await tx.select().from(cobrosTable).where(and(cobroScopeCondition(ctx, userId), eq(cobrosTable.moneda, moneda)));
    const paid = charges.filter(c => c.estado === "pagado" && chileDay(c.pagadoEn ?? c.creadoEn) <= hoy);
    const movements = options.area === "inventario" && products.length ? await tx.select().from(movimientosStockTable)
      .where(inArray(movimientosStockTable.productoId, products.map(p => p.id))) : [];
    const oldest = [...products.map(p => chileDay(p.creadoEn)), ...paid.map(c => chileDay(c.pagadoEn ?? c.creadoEn)), ...movements.map(m => chileDay(m.creadoEn))].sort()[0] ?? hoy;
    out.desde = inicioPeriodo(options.periodo ?? "mes", hoy, oldest);
    const rows = new Map<number, InformeProducto>(products.map(p => [p.id, { id: p.id, nombre: p.nombre, tipo: p.tipo,
      unidades: 0, ingresos: 0, porcentaje: 0, ultimaVenta: null, diasSinMovimiento: Math.max(0, dayNumber(hoy) - dayNumber(chileDay(p.creadoEn))),
      stockActual: Number(p.stockActual ?? 0), stockPromedio: 0, rotacion: null }]));
    const quoteIds = [...new Set(charges.flatMap(c => c.cotizacionId == null ? [] : [c.cotizacionId]))];
    const quoteLines = quoteIds.length ? await tx.select().from(cotizacionItemsTable).where(inArray(cotizacionItemsTable.cotizacionId, quoteIds)) : [];
    const allocations = new Map<string, number>();
    for (const c of charges) {
      const lines = c.cotizacionId ? quoteLines.filter(i => i.cotizacionId === c.cotizacionId).map(i => ({
        id: i.productoId, cantidad: Number(i.cantidad), weight: Number(i.subtotalLinea),
      })) : c.itemsInventario.map(i => ({ id: i.productoId, cantidad: i.cantidad, weight: i.precioUnitario * i.cantidad }));
      const weight = lines.reduce((s, i) => s + i.weight, 0);
      // Manual/unassigned quote lines stay in the denominator: never assign
      // their revenue to catalog products that happen to share the invoice.
      const total = Math.max(0, Number(c.monto) - Number(c.montoDescuento ?? 0));
      const date = chileDay(c.pagadoEn ?? c.creadoEn);
      const isPaid = c.estado === "pagado" && date <= hoy;
      const inPeriod = isPaid && date >= out.desde;
      if (inPeriod) out.total += total;
      for (const line of lines) {
        if (line.id == null) continue;
        const key = `${c.id}:${line.id}`, revenue = weight > 0 ? total * line.weight / weight : 0;
        allocations.set(key, (allocations.get(key) ?? 0) + revenue);
        const row = rows.get(line.id);
        if (!row || !isPaid) continue;
        if (!row.ultimaVenta || date > row.ultimaVenta) row.ultimaVenta = date;
        if (inPeriod && options.area === "ventas") { row.unidades += line.cantidad; row.ingresos += revenue; }
      }
    }
    for (const row of rows.values()) {
      if (row.ultimaVenta) row.diasSinMovimiento = Math.max(0, dayNumber(hoy) - dayNumber(row.ultimaVenta));
      row.porcentaje = out.total ? row.ingresos / out.total * 100 : 0;
    }
    if (options.area === "ventas") {
      out.ventas = [...rows.values()].filter(r => r.unidades > 0).sort((a, b) => b.unidades - a.unidades || b.ingresos - a.ingresos || a.id - b.id);
      const limit = options.umbral ?? 5;
      const active = new Set(products.filter(p => p.activo).map(p => p.id));
      out.menorMovimiento = [...rows.values()].filter(r => active.has(r.id) && (limit === 0 ? r.unidades === 0 : r.unidades < limit))
        .sort((a, b) => b.diasSinMovimiento - a.diasSinMovimiento || a.id - b.id);
      out.notas = "Ventas: cobros pagados por fecha de pago (fecha de creación si falta), según acceso a la cartera. Ingresos después de descuento global, incluido IVA cuando corresponde, repartidos proporcionalmente entre ítems. % sobre todas las ventas pagadas; cobros sin producto asociado pueden hacer que la suma sea menor a 100%. Sin venta: días desde alta. No incluye abonos parciales.";
      return out;
    }
    for (const p of products.filter(p => p.tipo === "producto")) {
      const row = rows.get(p.id)!;
      const events = movements.filter(m => m.productoId === p.id && chileDay(m.creadoEn) <= hoy);
      const history = stockHistory(Number(p.stockActual ?? 0), chileDay(p.creadoEn), events, out.desde, hoy);
      for (const m of events) {
        if (m.tipo !== "salida" || m.referenciaCobroId == null || (m.bodegaOrigenId != null && m.bodegaDestinoId != null)) continue;
        const date = chileDay(m.creadoEn);
        if (date < out.desde) continue;
        row.unidades += Number(m.cantidad);
        row.ingresos += allocations.get(`${m.referenciaCobroId}:${p.id}`) ?? 0;
      }
      row.stockPromedio = history.promedio; row.rotacion = history.promedio > 0 ? row.unidades / history.promedio : null;
      for (const e of history.episodes) out.quiebres.push({ productoId: p.id, nombre: p.nombre, fecha: e.fecha,
        diasSinStock: e.diasSinStock, frecuencia: history.episodes.length, critico: history.episodes.length > 2,
        stockMinimo: Math.ceil(row.unidades / history.dias), abierto: e.fin == null });
    }
    const physical = [...rows.values()].filter(r => r.tipo === "producto");
    out.ventas = physical.filter(r => r.unidades > 0).sort((a, b) => b.unidades - a.unidades || a.id - b.id);
    out.quiebres.sort((a, b) => b.frecuencia - a.frecuencia || b.fecha.localeCompare(a.fecha));
    const localScope = ctx.organizationId != null ? eq(localesTable.organizationId, ctx.organizationId)
      : and(isNull(localesTable.organizationId), eq(localesTable.usuarioId, userId));
    const warehouses = await tx.select({ b: bodegasTable, l: localesTable }).from(bodegasTable).innerJoin(localesTable, eq(bodegasTable.localId, localesTable.id)).where(localScope);
    const stocks = products.length ? await tx.select().from(stockPorBodegaTable).where(inArray(stockPorBodegaTable.productoId, products.map(p => p.id))) : [];
    for (const p of products.filter(p => p.tipo === "producto")) {
      const matches = stocks.filter(s => s.productoId === p.id);
      for (const s of matches) {
        const place = warehouses.find(w => w.b.id === s.bodegaId);
        if (!place || (options.bodegaId && s.bodegaId !== options.bodegaId) || (options.localId && place.l.id !== options.localId)) continue;
        out.valorizado.push({ productoId: p.id, nombre: p.nombre, bodegaId: s.bodegaId, bodega: place.b.nombre, localId: place.l.id, local: place.l.nombre,
          stock: Number(s.stockActual), costo: Number(p.costoUnitario), valor: Number(s.stockActual) * Number(p.costoUnitario) });
      }
      if (!matches.length && !options.bodegaId && !options.localId) out.valorizado.push({
        productoId: p.id, nombre: p.nombre, bodegaId: null, bodega: "Stock general", localId: null, local: "Sin local",
        stock: Number(p.stockActual ?? 0), costo: Number(p.costoUnitario), valor: Number(p.stockActual ?? 0) * Number(p.costoUnitario),
      });
    }
    out.totalStock = out.valorizado.reduce((s, r) => s + r.valor, 0);
    out.notas = "Inventario del negocio. Salidas: movimientos vinculados a cobros, no traslados ni salidas manuales. Ingresos asociados según acceso a los cobros; son importes documentados, no una conciliación de caja. Rotación: unidades / stock disponible promedio diario al cierre (hoy: stock actual; negativo cuenta como 0). Quiebres: cruces de stock positivo a 0 o negativo iniciados en el período; no se inventa historial previo. Stock mínimo sugerido: un día de ventas promedio, sin plazo de reposición. Valorización actual al costo neto, incluidos productos archivados y saldos negativos.";
    return out;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
