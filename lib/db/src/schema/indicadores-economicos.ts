import { pgTable, serial, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const indicadoresEconomicosTable = pgTable("indicadores_economicos", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  valor: numeric("valor", { precision: 18, scale: 6 }).notNull(),
  fecha: date("fecha").notNull(),
  valorAnterior: numeric("valor_anterior", { precision: 18, scale: 6 }),
  fechaAnterior: date("fecha_anterior"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertIndicadorEconomicoSchema = createInsertSchema(indicadoresEconomicosTable).omit({ id: true });
export type IndicadorEconomico = typeof indicadoresEconomicosTable.$inferSelect;
