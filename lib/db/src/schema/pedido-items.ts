import { pgTable, serial, integer, text, numeric } from "drizzle-orm/pg-core";
import { pedidosTable } from "./pedidos";
import { productosTable } from "./productos";
import { createInsertSchema } from "drizzle-zod";

export const pedidoItemsTable = pgTable("pedido_items", {
  id: serial("id").primaryKey(),
  pedidoId: integer("pedido_id").notNull().references(() => pedidosTable.id, { onDelete: "cascade" }),
  productoId: integer("producto_id").references(() => productosTable.id, { onDelete: "restrict" }),
  descripcion: text("descripcion").notNull(),
  cantidad: numeric("cantidad", { precision: 12, scale: 3 }).notNull(),
  precioUnitario: numeric("precio_unitario", { precision: 12, scale: 2 }).notNull(),
  subtotalLinea: numeric("subtotal_linea", { precision: 12, scale: 2 }).notNull(),
});

export const insertPedidoItemSchema = createInsertSchema(pedidoItemsTable).omit({ id: true });
export type PedidoItem = typeof pedidoItemsTable.$inferSelect;
