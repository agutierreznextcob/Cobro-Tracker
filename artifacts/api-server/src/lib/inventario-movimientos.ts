import { db, productosTable, movimientosStockTable, stockPorBodegaTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inventarioScope, movimientoBody } from "./inventario";
import { ensureStockRow, lockInventoryScope, scopedBodegas } from "./inventario-bodegas";

export async function registrarMovimiento(userId: string, id: number, d: z.infer<typeof movimientoBody>) {
  const { condition, ctx } = await inventarioScope(userId);
  return db.transaction(async tx => {
    await lockInventoryScope(tx, ctx, userId);
    const [p] = await tx.select().from(productosTable).where(and(condition, eq(productosTable.id, id))).for("update");
    if (!p) return null;
    if (p.tipo !== "producto") throw new Error("Los servicios no tienen movimientos de stock.");
    const warehouses = await scopedBodegas(userId, tx);
    const transfer = d.motivo === "Movimiento entre bodegas";
    const origin = d.bodegaOrigenId ?? null, destination = d.bodegaDestinoId ?? null;
    if ([origin, destination].some(id => id != null && !warehouses.some(w => w.bodega.id === id))) throw new Error("Bodega no disponible.");
    if (!transfer && ((d.tipo === "salida" && destination) || (d.tipo !== "salida" && origin))) {
      throw new Error("Indica solo la bodega correspondiente al tipo de movimiento.");
    }
    const targetId = d.tipo === "salida" ? origin : destination;
    if (warehouses.length && !targetId && !transfer) throw new Error("Selecciona la bodega del movimiento.");
    let quantity = d.cantidad;
    if (warehouses.length) {
      const ids = transfer ? [origin!, destination!] : [targetId!];
      for (const bodegaId of [...new Set(ids)].sort((a, b) => a - b)) await ensureStockRow(tx, p, bodegaId);
      const stockRows = await tx.select().from(stockPorBodegaTable).where(eq(stockPorBodegaTable.productoId, id)).for("update");
      const apply = async (bodegaId: number, delta: number, forbidNegative: boolean) => {
        const row = stockRows.find(s => s.bodegaId === bodegaId)!;
        const next = Math.round((Number(row.stockActual) + delta) * 1000) / 1000;
        if (forbidNegative && next < 0) throw new Error("Stock insuficiente en la bodega de origen.");
        await tx.update(stockPorBodegaTable).set({ stockActual: String(next), actualizadoEn: new Date() }).where(eq(stockPorBodegaTable.id, row.id));
      };
      if (transfer) {
        await apply(origin!, -d.cantidad, true);
        await apply(destination!, d.cantidad, false);
      } else {
        const current = Number(stockRows.find(s => s.bodegaId === targetId)!.stockActual);
        const delta = d.tipo === "ajuste" ? d.cantidad - current : d.tipo === "salida" ? -d.cantidad : d.cantidad;
        if (d.tipo === "ajuste") quantity = delta;
        await apply(targetId!, delta, d.tipo === "salida");
      }
      // Aggregate cache for legacy readers; stock rows are authoritative.
      const updatedStocks = await tx.select().from(stockPorBodegaTable).where(eq(stockPorBodegaTable.productoId, id));
      const total = updatedStocks.reduce((n, s) => n + Number(s.stockActual), 0);
      await tx.update(productosTable).set({ stockActual: String(Math.round(total * 1000) / 1000), actualizadoEn: new Date() }).where(eq(productosTable.id, id));
    } else {
      if (origin || destination || transfer) throw new Error("Configura las bodegas antes de realizar un traslado.");
      const current = Number(p.stockActual);
      const delta = d.tipo === "ajuste" ? d.cantidad - current : d.tipo === "salida" ? -d.cantidad : d.cantidad;
      const next = Math.round((current + delta) * 1000) / 1000;
      if (d.tipo === "salida" && next < 0) throw new Error("Stock insuficiente para esta salida manual.");
      if (d.tipo === "ajuste") quantity = delta;
      await tx.update(productosTable).set({ stockActual: String(next), actualizadoEn: new Date() }).where(eq(productosTable.id, id));
    }
    await tx.insert(movimientosStockTable).values({
      productoId: id, tipo: transfer ? "salida" : d.tipo, cantidad: String(quantity), motivo: d.motivo,
      usuarioId: userId, bodegaOrigenId: origin, bodegaDestinoId: destination,
    });
    const [updated] = await tx.select().from(productosTable).where(eq(productosTable.id, id));
    return updated;
  });
}
