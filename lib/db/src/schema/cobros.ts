import { pgTable, serial, text, numeric, timestamp, pgEnum, integer, date, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
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
  // Intelligent collections workflow assigned to this cobro (null = none). When
  // set, the workflow engine drives this cobro and the simple-reminder path is
  // skipped for it. Plain integer (no FK) to keep the column back-compatible and
  // avoid a schema import cycle; unassignment on workflow delete is handled in app code.
  workflowId: integer("workflow_id"),
  workflowIniciadoEn: timestamp("workflow_iniciado_en", { withTimezone: true }),
  flowOrdenId: text("flow_orden_id"),
  flowToken: text("flow_token"),
  flowLinkPago: text("flow_link_pago"),
  mpPreferenceId: text("mp_preference_id"),
  mpPaymentLinkUrl: text("mp_payment_link_url"),
  // When the cobro was confirmed as fully paid (webhook, recalc or manual).
  // Used for accurate revenue-by-period reporting; null until paid.
  pagadoEn: timestamp("pagado_en", { withTimezone: true }),
  // Durable provenance prevents an abono recalculation from downgrading a
  // payment confirmed through another source. Null legacy paid rows are
  // treated conservatively as non-abono payments.
  pagadoOrigen: text("pagado_origen").$type<"abonos" | "pago_completo">(),
  // Provenance for advanced creation flows. The batch id is intentionally an
  // opaque internal value: it is never included in customer notifications.
  loteId: text("lote_id"),
  // Actor-scoped idempotency metadata for advanced bulk creation. Keeping the
  // request fingerprint lets the API reject a reused key with a different body.
  idempotencyPayloadHash: text("idempotency_payload_hash"),
  recurrenteProgramacionId: integer("recurrente_programacion_id"),
  // The generation date is separate from the due date: a recurring charge is
  // generated on the previous due date and itself falls due next period.
  recurrenteFechaCiclo: date("recurrente_fecha_ciclo", { mode: "string" }),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
}, (table) => [
  index("idx_cobros_lote_id").on(table.loteId),
  uniqueIndex("uq_cobros_lote_cliente").on(table.loteId, table.clienteId),
  index("idx_cobros_recurrente_programacion").on(table.recurrenteProgramacionId),
  uniqueIndex("uq_cobros_recurrente_ciclo").on(table.recurrenteProgramacionId, table.recurrenteFechaCiclo),
]);

export const insertCobroSchema = createInsertSchema(cobrosTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});

export type InsertCobro = z.infer<typeof insertCobroSchema>;
export type Cobro = typeof cobrosTable.$inferSelect;
