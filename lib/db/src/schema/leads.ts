import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Sales leads captured from the public landing-page contact form. These are
// global platform prospects (not tied to any organization), so access is
// restricted to platform admins.
export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  telefono: text("telefono").notNull(),
  email: text("email").notNull(),
  mensaje: text("mensaje"),
  // nuevo | contactado | en_proceso | cerrado | descartado
  estado: text("estado").notNull().default("nuevo"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Lead = typeof leadsTable.$inferSelect;
