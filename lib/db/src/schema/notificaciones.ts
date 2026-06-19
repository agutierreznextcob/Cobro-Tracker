import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const notificacionesTable = pgTable("notificaciones", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  cobroId: integer("cobro_id").references(() => cobrosTable.id, { onDelete: "cascade" }),
  tipo: text("tipo").notNull().default("whatsapp"),
  titulo: text("titulo").notNull(),
  mensaje: text("mensaje"),
  waUrl: text("wa_url"),
  leida: boolean("leida").notNull().default(false),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type Notificacion = typeof notificacionesTable.$inferSelect;
