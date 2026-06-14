import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const seguimientosCobranzaTable = pgTable("seguimientos_cobranza", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  tipo: text("tipo").notNull().$type<"email" | "whatsapp">(),
  notas: text("notas"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

export type SeguimientoCobranza = typeof seguimientosCobranzaTable.$inferSelect;
