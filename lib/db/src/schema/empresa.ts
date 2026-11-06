import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const empresasTable = pgTable("empresas", {
  scope: text("scope").primaryKey(),
  perfil: jsonb("perfil").$type<Record<string, unknown>>().notNull().default({}),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});
export const empresaUploadsTable = pgTable("empresa_uploads", {
  // Logo-only lifecycle ledger: temporary uploads and normalized versions.
  // creadoEn is refreshed on reuse/retirement to start the cleanup grace period.
  // Historical normalized objects without a ledger entry are intentionally kept.
  objectPath: text("object_path").primaryKey(),
  scope: text("scope").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});
export const insertEmpresaSchema = createInsertSchema(empresasTable);
