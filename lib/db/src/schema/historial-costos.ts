import { pgTable, serial, integer, numeric, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { productosTable } from "./productos";
import { comprasTable } from "./compras";

export const historialCostosTable = pgTable("historial_costos", {
  id: serial("id").primaryKey(),
  productoId: integer("producto_id").notNull().references(() => productosTable.id, { onDelete: "restrict" }),
  costoAnterior: numeric("costo_anterior", { precision: 18, scale: 2 }),
  costoNuevo: numeric("costo_nuevo", { precision: 18, scale: 2 }).notNull(),
  origen: text("origen").$type<"manual" | "compra">().notNull(),
  compraId: integer("compra_id").references(() => comprasTable.id, { onDelete: "restrict" }),
  numeroFactura: text("numero_factura"),
  moneda: text("moneda").notNull(),
  decimales: integer("decimales").notNull(),
  usuarioId: text("usuario_id").notNull(),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("historial_costos_producto_fecha_idx").on(t.productoId, t.fecha)]);
export const insertHistorialCostoSchema = createInsertSchema(historialCostosTable).omit({ id: true, fecha: true });
export type HistorialCosto = typeof historialCostosTable.$inferSelect;
