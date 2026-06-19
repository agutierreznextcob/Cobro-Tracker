import { pgTable, serial, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";
import { recordatorioCanalEnum, recordatorioMomentoEnum } from "./recordatorios";

export const recordatoriosDefaultTable = pgTable("recordatorios_default", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  canal: recordatorioCanalEnum("canal").notNull().default("email"),
  momento: recordatorioMomentoEnum("momento").notNull(),
  diasOffset: integer("dias_offset").notNull().default(0),
  activo: boolean("activo").notNull().default(true),
  orden: integer("orden").notNull().default(0),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type RecordatorioDefault = typeof recordatoriosDefaultTable.$inferSelect;
