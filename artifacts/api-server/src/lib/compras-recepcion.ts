import { db, comprasTable, compraItemsTable, productosTable, stockPorBodegaTable, movimientosStockTable } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { compraPorId, CompraError, exigirRecepcion, serializeCompras } from "./compras";
import { inventarioScope } from "./inventario";
import { lockInventoryScope, scopedBodegas, ensureStockRow, type InventoryTx } from "./inventario-bodegas";
import { getPreferenciasNegocio, formatDocumentMoney } from "./preferencias";
import { registrarCosto } from "./inventario-costos";
import { calcularPrecios } from "./inventario-precios";
import { crearNotificacion } from "./notificaciones-service";

const recepcionInput = z.object({
  updatedAt: z.string(),
  decisiones: z.array(z.object({
    productoId: z.number().int().positive(), actualizar: z.boolean(), costoAnterior: z.number().finite().min(0),
  })).max(200).optional(),
});
async function contextoRecepcion(tx: InventoryTx, userId: string, id: number) {
  const { ctx, condition } = await inventarioScope(userId);
  exigirRecepcion(ctx);
  await lockInventoryScope(tx, ctx, userId);
  const { c } = await compraPorId(userId, id, tx, true);
  const items = await tx.select().from(compraItemsTable).where(eq(compraItemsTable.compraId, id)).orderBy(asc(compraItemsTable.id));
  const ids = [...new Set(items.flatMap(i => i.productoId ? [i.productoId] : []))].sort((a, b) => a - b);
  const products = ids.length ? await tx.select().from(productosTable).where(and(condition, inArray(productosTable.id, ids))).orderBy(asc(productosTable.id)).for("update") : [];
  if (products.length !== ids.length) throw new CompraError("Un producto ya no está disponible.", 409);
  const changes = products.flatMap(p => {
    const cost = Number(items.find(i => i.productoId === p.id)!.precioUnitario);
    return cost !== Number(p.costoUnitario) ? [{ productoId: p.id, nombre: p.nombre, costoAnterior: Number(p.costoUnitario), costoNuevo: cost }] : [];
  });
  return { c, ctx, items, products, changes };
}
export async function previewRecepcion(userId: string, id: number) {
  return db.transaction(async tx => {
    const { c, changes } = await contextoRecepcion(tx, userId, id);
    if (c.estado !== "borrador") throw new CompraError("La compra ya fue recibida.", 409);
    return { updatedAt: c.updatedAt.toISOString(), cambiosCostos: changes };
  });
}
export async function recibirCompra(userId: string, id: number, input: unknown) {
  const d = recepcionInput.parse(input);
  const prefs = await getPreferenciasNegocio(userId);
  return db.transaction(async tx => {
    const { c, ctx, items, products, changes } = await contextoRecepcion(tx, userId, id);
    // Repeat delivery is success, never another stock movement or cost update.
    if (c.estado !== "borrador") return (await serializeCompras([c], ctx, tx))[0];
    if (c.updatedAt.toISOString() !== d.updatedAt) throw new CompraError("La compra cambió. Revisa nuevamente la recepción.", 409);
    // Costs are applied automatically under the same receipt lock. Legacy
    // decision payloads are accepted but no longer opt out of synchronization.
    const warehouses = await scopedBodegas(userId, tx);
    for (const p of products) {
      if (!p.activo || p.moneda !== c.moneda) throw new CompraError(`Revisa ${p.nombre}: producto inactivo o moneda distinta.`, 409);
      const lines = items.filter(i => i.productoId === p.id);
      for (const item of lines) {
        if (p.tipo === "producto") {
          if (!item.bodegaDestinoId || !warehouses.some(w => w.bodega.id === item.bodegaDestinoId)) throw new CompraError(`Selecciona una bodega activa para ${p.nombre}.`);
          await ensureStockRow(tx, p, item.bodegaDestinoId);
          await tx.update(stockPorBodegaTable).set({
            stockActual: sql`${stockPorBodegaTable.stockActual} + ${item.cantidad}::numeric`, actualizadoEn: new Date(),
          }).where(and(eq(stockPorBodegaTable.productoId, p.id), eq(stockPorBodegaTable.bodegaId, item.bodegaDestinoId)));
          await tx.insert(movimientosStockTable).values({
            productoId: p.id, tipo: "entrada", cantidad: item.cantidad, motivo: "Ingreso por compra",
            referenciaCompraId: c.id, referenciaCompraItemId: item.id, bodegaDestinoId: item.bodegaDestinoId, usuarioId: userId,
          });
        }
      }
      if (p.tipo === "producto") {
        const [total] = await tx.select({ cantidad: sql<string>`coalesce(sum(${stockPorBodegaTable.stockActual}),0)::text` }).from(stockPorBodegaTable).where(eq(stockPorBodegaTable.productoId, p.id));
        await tx.update(productosTable).set({ stockActual: total.cantidad, actualizadoEn: new Date() }).where(eq(productosTable.id, p.id));
      }
      const change = changes.find(x => x.productoId === p.id);
      const updateCost = !!change;
      if (updateCost) {
        const cost = change!.costoNuevo; // Invoice unit costs are NET, regardless of invoice IVA.
        const prices = calcularPrecios({ costo: cost, tipo: p.tipo, metodo: p.metodoCalculo,
          margen: Number(p.margenPorcentaje), factor: Number(p.factorFactibilidad ?? 1),
          incluyeIva: p.incluyeIvaPrecio, iva: Number(p.porcentajeIvaPrecio),
          pvp: p.pvpProveedor == null ? null : Number(p.pvpProveedor), pvpIncluyeIva: p.pvpIncluyeIva,
        }, prefs.decimales);
        await tx.update(productosTable).set({ costoUnitario: String(cost), precioCalculado: String(prices.final),
          precioCalculadoNeto: String(prices.neto),
          actualizadoEn: new Date(Math.max(Date.now(), p.actualizadoEn.getTime() + 1)),
        }).where(eq(productosTable.id, p.id));
        await registrarCosto(tx, { productoId: p.id, anterior: Number(p.costoUnitario), nuevo: cost, usuarioId: userId,
          moneda: p.moneda, decimales: c.decimales, compra: { id: c.id, numeroFactura: c.numeroFactura } });
        await crearNotificacion({
          eventKey: `compra:${c.id}:costo:${p.id}`, userId, tipo: "inventario_costo", titulo: "Costo de producto actualizado",
          mensaje: `El costo de ${p.nombre} se actualizó desde la factura Nº ${c.numeroFactura}. Precio sugerido actualizado a ${formatDocumentMoney(prices.final, p.moneda, prefs.decimales)}`,
        }, tx);
      }
      await tx.update(compraItemsTable).set({ costoAnterior: p.costoUnitario, costoActualizado: updateCost })
        .where(and(eq(compraItemsTable.compraId, c.id), eq(compraItemsTable.productoId, p.id)));
    }
    const [saved] = await tx.update(comprasTable).set({ estado: "recibida", recibidaPor: userId, recibidaEn: new Date(), updatedAt: new Date() }).where(eq(comprasTable.id, c.id)).returning();
    return (await serializeCompras([saved], ctx, tx))[0];
  });
}
