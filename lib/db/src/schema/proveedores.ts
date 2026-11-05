import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const proveedoresTable = pgTable("proveedores", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  usuarioId: text("usuario_id").notNull(),
  razonSocial: text("razon_social").notNull(),
  rut: text("rut").notNull(),
  giro: text("giro").notNull().default(""),
  direccion: text("direccion").notNull().default(""),
  email: text("email").notNull().default(""),
  telefono: text("telefono").notNull().default(""),
  contactoNombre: text("contacto_nombre").notNull().default(""),
  activo: boolean("activo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("proveedores_org_rut_idx").on(t.organizationId, t.rut), index("proveedores_usuario_idx").on(t.usuarioId)]);
export const insertProveedorSchema = createInsertSchema(proveedoresTable).omit({ id: true, createdAt: true });
export type Proveedor = typeof proveedoresTable.$inferSelect;
