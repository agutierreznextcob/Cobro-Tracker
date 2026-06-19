import { pgTable, serial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const recordatorioCanalEnum = pgEnum("recordatorio_canal", [
  "email",
  "whatsapp",
  "ambos",
]);

export const recordatorioMomentoEnum = pgEnum("recordatorio_momento", [
  "antes",
  "dia",
  "despues",
  "recurrente",
]);

export const recordatoriosTable = pgTable("recordatorios", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  canal: recordatorioCanalEnum("canal").notNull().default("email"),
  momento: recordatorioMomentoEnum("momento").notNull(),
  diasOffset: integer("dias_offset").notNull().default(0),
  activo: boolean("activo").notNull().default(true),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type Recordatorio = typeof recordatoriosTable.$inferSelect;
