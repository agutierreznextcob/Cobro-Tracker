import { pgTable, serial, integer, text, numeric, boolean, index } from "drizzle-orm/pg-core";
import { comprasTable } from "./compras";
import { productosTable } from "./productos";
import { bodegasTable } from "./bodegas";
import { createInsertSchema } from "drizzle-zod";
export const compraItemsTable = pgTable("compra_items", {
  id: serial("id").primaryKey(),
  compraId: integer("compra_id").notNull().references(() => comprasTable.id, { onDelete: "cascade" }),
  productoId: integer("producto_id").references(() => productosTable.id, { onDelete: "restrict" }),
  descripcion: text("descripcion").notNull(),
  cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),
  precioUnitario: numeric("precio_unitario", { precision: 14, scale: 2 }).notNull(),
  subtotalLinea: numeric("subtotal_linea", { precision: 14, scale: 2 }).notNull(),
  bodegaDestinoId: integer("bodega_destino_id").references(() => bodegasTable.id, { onDelete: "restrict" }),
  costoAnterior: numeric("costo_anterior", { precision: 18, scale: 2 }),
  costoActualizado: boolean("costo_actualizado").notNull().default(false),
}, t => [index("compra_items_compra_idx").on(t.compraId)]);
export const insertCompraItemSchema = createInsertSchema(compraItemsTable).omit({ id: true });
export type CompraItem = typeof compraItemsTable.$inferSelect;
