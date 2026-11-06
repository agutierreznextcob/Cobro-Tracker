import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const empresasTable = pgTable("empresas", {
  scope: text("scope").primaryKey(),
  perfil: jsonb("perfil").$type<Record<string, unknown>>().notNull().default({}),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});
export const empresaUploadsTable = pgTable("empresa_uploads", {
  objectPath: text("object_path").primaryKey(),
  scope: text("scope").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});
export const insertEmpresaSchema = createInsertSchema(empresasTable);
