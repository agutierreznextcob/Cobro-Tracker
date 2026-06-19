import { pgTable, serial, integer, numeric, text, date, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const descuentoTipoEnum = pgEnum("descuento_tipo", ["porcentaje", "fijo"]);

export const cobroDescuentosTable = pgTable("cobro_descuentos", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  tipo: descuentoTipoEnum("tipo").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  montoDescuento: numeric("monto_descuento", { precision: 12, scale: 2 }).notNull(),
  montoOriginal: numeric("monto_original", { precision: 12, scale: 2 }).notNull(),
  montoFinal: numeric("monto_final", { precision: 12, scale: 2 }).notNull(),
  motivo: text("motivo").notNull(),
  fechaVigencia: date("fecha_vigencia", { mode: "string" }),
  aplicadoPorId: text("aplicado_por_id"),
  aplicadoPorNombre: text("aplicado_por_nombre"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type CobroDescuento = typeof cobroDescuentosTable.$inferSelect;
