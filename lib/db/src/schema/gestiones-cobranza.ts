import { pgTable, serial, integer, varchar, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const gestionTipoEnum = pgEnum("gestion_tipo", [
  "llamada",
  "email",
  "whatsapp",
  "visita",
  "otro",
]);

export const gestionResultadoEnum = pgEnum("gestion_resultado", [
  "contactado_pagara",
  "contactado_no_pagara",
  "no_contesto",
  "numero_no_disponible",
  "acordo_pago_parcial",
  "acordo_fecha_pago",
  "disputa_reclamo",
]);

export const gestionesCobranzaTable = pgTable("gestiones_cobranza", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  usuarioId: varchar("usuario_id").notNull(),
  tipo: gestionTipoEnum("tipo").notNull(),
  resultado: gestionResultadoEnum("resultado").notNull(),
  nota: text("nota"),
  proximaGestionEn: timestamp("proxima_gestion_en", { withTimezone: true }),
  proximaGestionTipo: gestionTipoEnum("proxima_gestion_tipo"),
  proximaGestionCompletadaEn: timestamp("proxima_gestion_completada_en", { withTimezone: true }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type GestionCobranza = typeof gestionesCobranzaTable.$inferSelect;
