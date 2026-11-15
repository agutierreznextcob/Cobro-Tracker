import { pgTable, serial, integer, text, numeric } from "drizzle-orm/pg-core";
import { guiasDespachoTable } from "./guias-despacho";
import { productosTable } from "./productos";
import { createInsertSchema } from "drizzle-zod";

export const guiaDespachoItemsTable = pgTable("guia_despacho_items", {
  id: serial("id").primaryKey(),
  guiaId: integer("guia_id").notNull().references(() => guiasDespachoTable.id, { onDelete: "cascade" }),
  productoId: integer("producto_id").references(() => productosTable.id, { onDelete: "restrict" }),
  descripcion: text("descripcion").notNull(),
  cantidad: numeric("cantidad", { precision: 12, scale: 3 }).notNull(),
  precioUnitario: numeric("precio_unitario", { precision: 12, scale: 2 }).notNull(),
  subtotalLinea: numeric("subtotal_linea", { precision: 12, scale: 2 }).notNull(),
});

export const insertGuiaDespachoItemSchema = createInsertSchema(guiaDespachoItemsTable).omit({ id: true });
export type GuiaDespachoItem = typeof guiaDespachoItemsTable.$inferSelect;
