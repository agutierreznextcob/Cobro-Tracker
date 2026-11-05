import { pgTable, serial, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { productosTable } from "./productos";
import { bodegasTable } from "./bodegas";

export const stockPorBodegaTable = pgTable("stock_por_bodega", {
  id: serial("id").primaryKey(),
  productoId: integer("producto_id").notNull().references(() => productosTable.id, { onDelete: "restrict" }),
  bodegaId: integer("bodega_id").notNull().references(() => bodegasTable.id, { onDelete: "restrict" }),
  stockActual: numeric("stock_actual", { precision: 18, scale: 3 }).notNull().default("0"),
  stockCritico: numeric("stock_critico", { precision: 18, scale: 3 }).notNull().default("0"),
  actualizadoEn: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("stock_producto_bodega_idx").on(t.productoId, t.bodegaId)]);
export const insertStockPorBodegaSchema = createInsertSchema(stockPorBodegaTable).omit({ id: true, actualizadoEn: true });
export type StockPorBodega = typeof stockPorBodegaTable.$inferSelect;
