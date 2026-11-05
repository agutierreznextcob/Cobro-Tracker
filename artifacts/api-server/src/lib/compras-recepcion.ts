import { db, comprasTable, compraItemsTable, productosTable, stockPorBodegaTable, movimientosStockTable } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { compraPorId, CompraError, exigirRecepcion, serializeCompras } from "./compras";
import { inventarioScope } from "./inventario";
import { lockInventoryScope, scopedBodegas, ensureStockRow, type InventoryTx } from "./inventario-bodegas";
import { roundMoney } from "./preferencias";

const recepcionInput = z.object({
  updatedAt: z.string(),
  decisiones: z.array(z.object({
    productoId: z.number().int().positive(), actualizar: z.boolean(), costoAnterior: z.number().finite().min(0),
  })).max(200),
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
  return db.transaction(async tx => {
    const { c, ctx, items, products, changes } = await contextoRecepcion(tx, userId, id);
    // Repeat delivery is success, never another stock movement or cost update.
    if (c.estado !== "borrador") return (await serializeCompras([c], ctx, tx))[0];
    if (c.updatedAt.toISOString() !== d.updatedAt) throw new CompraError("La compra cambió. Revisa nuevamente la recepción.", 409);
    if (new Set(d.decisiones.map(d => d.productoId)).size !== d.decisiones.length) throw new CompraError("Decisiones duplicadas.");
    for (const change of changes) {
      const decision = d.decisiones.find(d => d.productoId === change.productoId);
      if (!decision || decision.costoAnterior !== change.costoAnterior) throw new CompraError("El costo cambió o falta tu decisión. Revisa nuevamente la recepción.", 409);
    }
    for (const decision of d.decisiones) {
      const product = products.find(p => p.id === decision.productoId);
      if (!product || Number(product.costoUnitario) !== decision.costoAnterior) throw new CompraError("Los costos cambiaron. Revisa nuevamente la recepción.", 409);
    }
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
            referenciaCompraId: c.id, bodegaDestinoId: item.bodegaDestinoId, usuarioId: userId,
          });
        }
      }
      if (p.tipo === "producto") {
        const [total] = await tx.select({ cantidad: sql<string>`coalesce(sum(${stockPorBodegaTable.stockActual}),0)::text` }).from(stockPorBodegaTable).where(eq(stockPorBodegaTable.productoId, p.id));
        await tx.update(productosTable).set({ stockActual: total.cantidad, actualizadoEn: new Date() }).where(eq(productosTable.id, p.id));
      }
      const change = changes.find(x => x.productoId === p.id);
      const updateCost = !!change && !!d.decisiones.find(d => d.productoId === p.id)?.actualizar;
      if (updateCost) {
        const margin = Number(p.margenPorcentaje), cost = change!.costoNuevo;
        const suggested = p.tipo === "servicio" ? cost * Number(p.factorFactibilidad ?? 1)
          : p.metodoCalculo === "margen" ? cost / (1 - margin / 100) : cost * (1 + margin / 100);
        if (!Number.isFinite(suggested) || suggested < 0 || suggested >= 1e12) throw new CompraError(`Precio sugerido fuera de rango para ${p.nombre}.`);
        await tx.update(productosTable).set({ costoUnitario: String(cost), precioCalculado: String(roundMoney(suggested, c.decimales)), actualizadoEn: new Date() }).where(eq(productosTable.id, p.id));
      }
      await tx.update(compraItemsTable).set({ costoAnterior: p.costoUnitario, costoActualizado: updateCost })
        .where(and(eq(compraItemsTable.compraId, c.id), eq(compraItemsTable.productoId, p.id)));
    }
    const [saved] = await tx.update(comprasTable).set({ estado: "recibida", recibidaPor: userId, recibidaEn: new Date(), updatedAt: new Date() }).where(eq(comprasTable.id, c.id)).returning();
    return (await serializeCompras([saved], ctx, tx))[0];
  });
}
