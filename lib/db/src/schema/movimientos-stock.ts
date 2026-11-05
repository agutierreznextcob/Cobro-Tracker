import { comprasTable } from "./compras";
import { pgTable, serial, integer, text, numeric, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { productosTable } from "./productos";
import { createInsertSchema } from "drizzle-zod";
import { bodegasTable } from "./bodegas";

export const movimientosStockTable = pgTable("movimientos_stock", {
  referenciaCompraId: integer("referencia_compra_id").references(() => comprasTable.id, { onDelete: "restrict" }),
  id: serial("id").primaryKey(),
  productoId: integer("producto_id").notNull().references(() => productosTable.id, { onDelete: "restrict" }),
  tipo: text("tipo").$type<"entrada" | "salida" | "ajuste">().notNull(),
  cantidad: numeric("cantidad", { precision: 18, scale: 3 }).notNull(),
  motivo: text("motivo").notNull(),
  // Keep the historical charge id even if an administrative purge deletes it.
  referenciaCobroId: integer("referencia_cobro_id"),
  bodegaOrigenId: integer("bodega_origen_id").references(() => bodegasTable.id, { onDelete: "restrict" }),
  bodegaDestinoId: integer("bodega_destino_id").references(() => bodegasTable.id, { onDelete: "restrict" }),
  usuarioId: text("usuario_id").notNull(),
  creadoEn: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("movimientos_stock_producto_idx").on(t.productoId),
  uniqueIndex("stock_venta_unica_idx").on(t.referenciaCobroId, t.productoId),
]);
export const insertMovimientoStockSchema = createInsertSchema(movimientosStockTable).omit({ id: true, creadoEn: true });
