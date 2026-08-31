import { integer, numeric, pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Payment receipts ("comprobantes de pago"). One per cobro (cobroId unique) so
// the auto-generation on a `pagado` transition is idempotent.
export const comprobantesTable = pgTable("comprobantes", {
  id: serial("id").primaryKey(),
  // The cobro this receipt belongs to. Unique → at most one receipt per cobro.
  cobroId: integer("cobro_id").notNull().unique(),
  // Human-readable unique receipt number, e.g. "CMP-2026-000123".
  numero: text("numero").notNull().unique(),
  metodoPago: text("metodo_pago").notNull(),
  montoPagado: numeric("monto_pagado").notNull(),
  montoNeto: numeric("monto_neto"),
  montoIva: numeric("monto_iva"),
  // Email the receipt was sent to (cobro.emailPagador || cliente.email).
  emailDestino: text("email_destino"),
  // Final success flag: true ONLY after the email was actually sent.
  emailEnviado: boolean("email_enviado").notNull().default(false),
  // Durable delivery time used by notification reconciliation and ordering.
  emailEnviadoEn: timestamp("email_enviado_en"),
  // Atomic send-claim timestamp. Set when a caller claims the send; cleared on
  // transient failure. A stale value (older than the TTL) is treated as an
  // orphaned/crashed attempt and may be reclaimed by a later trigger.
  emailIntentoEn: timestamp("email_intento_en"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

export const insertComprobanteSchema = createInsertSchema(comprobantesTable).omit({
  id: true,
  creadoEn: true,
  emailEnviadoEn: true,
});

export type InsertComprobante = z.infer<typeof insertComprobanteSchema>;
export type Comprobante = typeof comprobantesTable.$inferSelect;
