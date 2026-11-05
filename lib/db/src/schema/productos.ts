import { pgTable, serial, text, numeric, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export type ItemInventarioSnapshot = {
  productoId: number; nombre: string; tipo: "producto" | "servicio";
  cantidad: number; precioUnitario: number;
};

export const productosTable = pgTable("productos", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  usuarioId: text("usuario_id").notNull(),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion").notNull().default(""),
  tipo: text("tipo").$type<"producto" | "servicio">().notNull(),
  costoUnitario: numeric("costo_unitario", { precision: 18, scale: 2 }).notNull(),
  precioUnitario: numeric("precio_unitario", { precision: 18, scale: 2 }).notNull(),
  margenPorcentaje: numeric("margen_porcentaje", { precision: 12, scale: 4 }).notNull().default("0"),
  metodoCalculo: text("metodo_calculo").$type<"margen" | "recargo">().notNull().default("margen"),
  stockActual: numeric("stock_actual", { precision: 18, scale: 3 }),
  stockCritico: numeric("stock_critico", { precision: 18, scale: 3 }).notNull().default("0"),
  unidadMedida: text("unidad_medida").notNull().default("unidad"),
  activo: boolean("activo").notNull().default(true),
  tarifaHora: numeric("tarifa_hora", { precision: 18, scale: 2 }),
  tiempoEstimadoHoras: numeric("tiempo_estimado_horas", { precision: 12, scale: 3 }),
  factorFactibilidad: numeric("factor_factibilidad", { precision: 4, scale: 3 }),
  precioCalculado: numeric("precio_calculado", { precision: 18, scale: 2 }),
  creadoEn: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("productos_org_idx").on(t.organizationId), index("productos_usuario_idx").on(t.usuarioId)]);

export const insertProductoSchema = createInsertSchema(productosTable).omit({ id: true, creadoEn: true, actualizadoEn: true });
export type Producto = typeof productosTable.$inferSelect;
