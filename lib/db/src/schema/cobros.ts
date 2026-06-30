import { pgTable, serial, text, numeric, timestamp, pgEnum, integer, date, boolean } from "drizzle-orm/pg-core";
import { clientesTable } from "./clientes";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const estadoCobroEnum = pgEnum("estado_cobro", [
  "pendiente",
  "pagado",
  "parcial",
  "fallido",
  "cancelado",
]);

// Chilean electronic tax document type (DTE). "afecta" documents allow IVA;
// "exenta" documents never carry IVA; "sin_documento" is an informal charge.
export const tipoDocumentoEnum = pgEnum("tipo_documento", [
  "factura_afecta",
  "factura_exenta",
  "boleta_afecta",
  "boleta_exenta",
  "sin_documento",
]);

export const cobrosTable = pgTable("cobros", {
  id: serial("id").primaryKey(),
  monto: numeric("monto", { precision: 12, scale: 2 }).notNull(),
  montoDescuento: numeric("monto_descuento", { precision: 12, scale: 2 }),
  // IVA (Chilean VAT 19%). When incluyeIva is true, `monto` holds the total
  // charged amount (neto + iva), and montoNeto/montoIva keep the breakdown.
  // When false, montoNeto/montoIva are null and `monto` is the final charge.
  incluyeIva: boolean("incluye_iva").notNull().default(false),
  montoNeto: numeric("monto_neto", { precision: 12, scale: 2 }),
  montoIva: numeric("monto_iva", { precision: 12, scale: 2 }),
  // Chilean DTE document type for this charge. Defaults to informal so legacy
  // rows backfill cleanly. "exenta"/"sin_documento" never carry IVA.
  tipoDocumento: tipoDocumentoEnum("tipo_documento").notNull().default("sin_documento"),
  descripcion: text("descripcion").notNull(),
  estado: estadoCobroEnum("estado").notNull().default("pendiente"),
  referencia: text("referencia"),
  // Organization the cobro belongs to (denormalized for fast org-wide queries).
  organizationId: integer("organization_id"),
  // The user (ejecutivo or admin) the cobro is assigned to / responsible for.
  responsableId: text("responsable_id"),
  responsableNombre: text("responsable_nombre"),
  clienteId: integer("cliente_id").references(() => clientesTable.id, { onDelete: "set null" }),
  clienteNombre: text("cliente_nombre"),
  emailPagador: text("email_pagador"),
  fechaVencimiento: date("fecha_vencimiento", { mode: "string" }),
  flowOrdenId: text("flow_orden_id"),
  flowToken: text("flow_token"),
  flowLinkPago: text("flow_link_pago"),
  mpPreferenceId: text("mp_preference_id"),
  mpPaymentLinkUrl: text("mp_payment_link_url"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
});

export const insertCobroSchema = createInsertSchema(cobrosTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});

export type InsertCobro = z.infer<typeof insertCobroSchema>;
export type Cobro = typeof cobrosTable.$inferSelect;
