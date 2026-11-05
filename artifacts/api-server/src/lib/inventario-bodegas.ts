import { db, localesTable, bodegasTable, stockPorBodegaTable, productosTable, type Producto } from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getOrgContext } from "./org";
import { serializeProducto } from "./inventario";

export type InventoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function localScope(userId: string) {
  const ctx = await getOrgContext(userId);
  const condition = ctx.organizationId != null ? eq(localesTable.organizationId, ctx.organizationId)
    : and(isNull(localesTable.organizationId), eq(localesTable.usuarioId, userId))!;
  return { ctx, condition };
}
export async function lockInventoryScope(tx: InventoryTx, ctx: { organizationId: number | null }, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory:${ctx.organizationId == null ? `user:${userId}` : `org:${ctx.organizationId}`}`}))`);
}
export async function scopedBodegas(userId: string, executor: InventoryTx | typeof db = db) {
  const { condition } = await localScope(userId);
  return executor.select({ bodega: bodegasTable, local: localesTable }).from(bodegasTable)
    .innerJoin(localesTable, eq(localesTable.id, bodegasTable.localId))
    .where(and(condition, eq(localesTable.activo, true), eq(bodegasTable.activo, true)));
}
export async function enrichProductos(rows: Producto[]) {
  if (!rows.length) return [];
  const stocks = await db.select({
    productoId: stockPorBodegaTable.productoId,
    bodegaId: bodegasTable.id, bodegaNombre: bodegasTable.nombre,
    localId: localesTable.id, localNombre: localesTable.nombre,
    stockActual: stockPorBodegaTable.stockActual, stockCritico: stockPorBodegaTable.stockCritico,
  }).from(stockPorBodegaTable)
    .innerJoin(bodegasTable, eq(bodegasTable.id, stockPorBodegaTable.bodegaId))
    .innerJoin(localesTable, eq(localesTable.id, bodegasTable.localId))
    .where(inArray(stockPorBodegaTable.productoId, rows.map(p => p.id)));
  return rows.map(p => {
    const ubicaciones = stocks.filter(s => s.productoId === p.id).map(({ productoId: _, ...s }) => ({
      ...s, stockActual: Number(s.stockActual), stockCritico: Number(s.stockCritico),
    }));
    const result = serializeProducto(p);
    if (ubicaciones.length) {
      result.stockActual = Math.round(ubicaciones.reduce((n, s) => n + s.stockActual, 0) * 1000) / 1000;
      result.estadoStock = result.stockActual <= 0 ? "agotado"
        : ubicaciones.some(s => s.stockActual <= s.stockCritico) ? "critico" : "normal";
    }
    return { ...result, ubicaciones };
  });
}
export async function ensureStockRow(tx: InventoryTx, p: Producto, bodegaId: number) {
  await tx.insert(stockPorBodegaTable).values({ productoId: p.id, bodegaId, stockActual: "0", stockCritico: p.stockCritico })
    .onConflictDoNothing();
}
export async function validateInternalCode(tx: InventoryTx, condition: ReturnType<typeof eq> | undefined, code: string, id: number) {
  const duplicates = await tx.select({ id: productosTable.id }).from(productosTable)
    .where(and(condition, sql`lower(${productosTable.codigoInterno}) = lower(${code})`));
  if (duplicates.some(p => p.id !== id)) throw new Error("El código interno ya está en uso en este negocio.");
}
