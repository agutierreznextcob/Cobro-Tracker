import { db, compraItemsTable, movimientosStockTable, productosTable, stockPorBodegaTable } from "@workspace/db";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { compraPorId, CompraError, exigirRecepcion } from "./compras";
import { inventarioScope } from "./inventario";
import { lockInventoryScope, type InventoryTx } from "./inventario-bodegas";

const inputSchema = z.object({
  clave: z.string().uuid(), motivo: z.string().trim().min(1).max(500),
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    cantidad: z.number().finite().positive().max(1e8)
      .refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-5, "Máximo 3 decimales"),
  })).min(1).max(200),
});
const units = (n: string | number) => Math.round(Number(n) * 1000);
async function history(id: number, tx: InventoryTx | typeof db) {
  const rows = await tx.select().from(movimientosStockTable).where(and(
    eq(movimientosStockTable.referenciaCompraId, id), isNotNull(movimientosStockTable.devolucionClave),
  )).orderBy(asc(movimientosStockTable.id));
  return rows.map(r => ({
    id: r.id, itemId: r.referenciaCompraItemId!, cantidad: Number(r.cantidad),
    bodegaId: r.bodegaOrigenId!, motivo: r.motivo, usuarioId: r.usuarioId,
    creadoEn: r.creadoEn.toISOString(), clave: r.devolucionClave!,
  }));
}
export async function listDevoluciones(userId: string, id: number) {
  await compraPorId(userId, id);
  return history(id, db);
}
export async function devolverCompra(userId: string, id: number, input: unknown) {
  const d = inputSchema.parse(input);
  if (new Set(d.items.map(i => i.itemId)).size !== d.items.length) throw new CompraError("Ítems duplicados.");
  const { ctx, condition } = await inventarioScope(userId);
  exigirRecepcion(ctx);
  return db.transaction(async tx => {
    // Same lock order as receipts/manual inventory; product locks also serialize payments.
    await lockInventoryScope(tx, ctx, userId);
    const { c } = await compraPorId(userId, id, tx, true);
    if (c.estado === "borrador") throw new CompraError("Primero confirma la recepción.", 409);
    const previous = await history(id, tx);
    const replay = previous.filter(r => r.clave === d.clave);
    if (replay.length) {
      if (replay.length !== d.items.length || replay.some(r => r.motivo !== d.motivo ||
        !d.items.some(i => i.itemId === r.itemId && units(i.cantidad) === units(r.cantidad))))
        throw new CompraError("Esta clave ya se usó con otra devolución.", 409);
      return previous;
    }
    const items = await tx.select().from(compraItemsTable).where(eq(compraItemsTable.compraId, id));
    const selected = d.items.map(line => {
      const item = items.find(i => i.id === line.itemId);
      if (!item?.productoId || !item.bodegaDestinoId) throw new CompraError("El ítem no corresponde a stock recibido de esta compra.");
      const returned = previous.filter(r => r.itemId === item.id).reduce((sum, r) => sum + units(r.cantidad), 0);
      if (units(line.cantidad) > units(item.cantidad) - returned) throw new CompraError(`Cantidad superior a la retornable: ${item.descripcion}.`, 409);
      return { item, cantidad: (units(line.cantidad) / 1000).toFixed(3) };
    });
    const ids = [...new Set(selected.map(s => s.item.productoId!))].sort((a, b) => a - b);
    const products = await tx.select().from(productosTable).where(and(condition, inArray(productosTable.id, ids)))
      .orderBy(asc(productosTable.id)).for("update");
    if (products.length !== ids.length) throw new CompraError("Producto no disponible.", 409);
    for (const { item, cantidad } of selected) {
      // Origin is the immutable receipt destination, never a client-supplied warehouse.
      const changed = await tx.update(stockPorBodegaTable).set({
        stockActual: sql`${stockPorBodegaTable.stockActual} - ${cantidad}::numeric`, actualizadoEn: new Date(),
      }).where(and(eq(stockPorBodegaTable.productoId, item.productoId!), eq(stockPorBodegaTable.bodegaId, item.bodegaDestinoId!),
        sql`${stockPorBodegaTable.stockActual} >= ${cantidad}::numeric`)).returning();
      if (!changed.length) throw new CompraError(`Stock insuficiente en la bodega de recepción: ${item.descripcion}.`, 409);
      await tx.update(productosTable).set({
        stockActual: sql`${productosTable.stockActual} - ${cantidad}::numeric`, actualizadoEn: new Date(),
      }).where(eq(productosTable.id, item.productoId!));
      await tx.insert(movimientosStockTable).values({
        productoId: item.productoId!, tipo: "salida", cantidad, motivo: d.motivo,
        referenciaCompraId: id, referenciaCompraItemId: item.id, devolucionClave: d.clave,
        bodegaOrigenId: item.bodegaDestinoId!, usuarioId: userId,
      });
    }
    return history(id, tx);
  });
}
