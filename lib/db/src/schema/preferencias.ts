import { pgTable, text, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const preferenciasTable = pgTable("preferencias", {
  scope: text("scope").primaryKey(),
  moneda: text("moneda").notNull().default("CLP"),
  decimales: integer("decimales").notNull().default(0),
  porcentajeIva: numeric("porcentaje_iva", { precision: 5, scale: 2 }).notNull().default("19"),
  formatoFecha: text("formato_fecha").notNull().default("DD/MM/YYYY"),
  prefijoCobro: text("prefijo_cobro").notNull().default("COB-"),
  prefijoCotizacion: text("prefijo_cotizacion").notNull().default("COT-"),
  googleReviewUrl: text("google_review_url").notNull().default(""),
  googleReviewEnabled: boolean("google_review_enabled").notNull().default(false),
});
export const insertPreferenciaSchema = createInsertSchema(preferenciasTable);
export type Preferencia = typeof preferenciasTable.$inferSelect;
