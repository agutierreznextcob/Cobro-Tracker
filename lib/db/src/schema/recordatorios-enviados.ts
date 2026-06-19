import { pgTable, serial, integer, text, timestamp, date } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";
import { recordatoriosTable } from "./recordatorios";

export const recordatoriosEnviadosTable = pgTable("recordatorios_enviados", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  recordatorioId: integer("recordatorio_id").references(() => recordatoriosTable.id, {
    onDelete: "set null",
  }),
  canal: text("canal").notNull().$type<"email" | "whatsapp">(),
  estado: text("estado").notNull().$type<"enviado" | "fallido" | "pendiente">(),
  detalle: text("detalle"),
  fecha: date("fecha", { mode: "string" }).notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type RecordatorioEnviado = typeof recordatoriosEnviadosTable.$inferSelect;
