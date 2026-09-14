import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

// Transactional outbox for notifications requested when an advanced charge is
// created. A committed cobro is never lost merely because an email/WhatsApp
// provider or a post-commit lookup is temporarily unavailable.
export const cobroEntregasInicialesTable = pgTable("cobro_entregas_iniciales", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id").notNull().references(() => cobrosTable.id, { onDelete: "cascade" }),
  canal: text("canal").notNull().$type<"email" | "whatsapp">(),
  estado: text("estado").notNull().default("pendiente").$type<"pendiente" | "enviado" | "pendiente_manual" | "fallido">(),
  intentos: integer("intentos").notNull().default(0),
  ultimoError: text("ultimo_error"),
  proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }),
  fallbackWaUrl: text("fallback_wa_url"),
  fallbackMensaje: text("fallback_mensaje"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_cobro_entrega_inicial").on(table.cobroId, table.canal),
]);

export type CobroEntregaInicial = typeof cobroEntregasInicialesTable.$inferSelect;