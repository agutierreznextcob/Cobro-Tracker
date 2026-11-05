import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const localesTable = pgTable("locales", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  usuarioId: text("usuario_id").notNull(),
  nombre: text("nombre").notNull(),
  direccion: text("direccion").notNull().default(""),
  activo: boolean("activo").notNull().default(true),
  creadoEn: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("locales_org_idx").on(t.organizationId), index("locales_usuario_idx").on(t.usuarioId)]);
export const insertLocalSchema = createInsertSchema(localesTable).omit({ id: true, creadoEn: true });
export type Local = typeof localesTable.$inferSelect;
