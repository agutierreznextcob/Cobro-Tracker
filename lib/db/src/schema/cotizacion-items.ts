import { pgTable, serial, integer, text, numeric } from "drizzle-orm/pg-core";
import { cotizacionesTable } from "./cotizaciones";
import { productosTable } from "./productos";
import { createInsertSchema } from "drizzle-zod";

export const cotizacionItemsTable = pgTable("cotizacion_items", {
  id: serial("id").primaryKey(),
  cotizacionId: integer("cotizacion_id").notNull().references(() => cotizacionesTable.id, { onDelete: "cascade" }),
  productoId: integer("producto_id").references(() => productosTable.id, { onDelete: "restrict" }),
  descripcion: text("descripcion").notNull(),
  cantidad: numeric("cantidad", { precision: 12, scale: 3 }).notNull(),
  precioUnitario: numeric("precio_unitario", { precision: 12, scale: 2 }).notNull(),
  descuentoPorcentaje: numeric("descuento_porcentaje", { precision: 5, scale: 2 }).notNull().default("0"),
  subtotalLinea: numeric("subtotal_linea", { precision: 12, scale: 2 }).notNull(),
});
export const insertCotizacionItemSchema = createInsertSchema(cotizacionItemsTable).omit({ id: true });
export type CotizacionItem = typeof cotizacionItemsTable.$inferSelect;
