import { boolean, date, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { clientesTable } from "./clientes";

export const frecuenciaCobroRecurrenteEnum = pgEnum("frecuencia_cobro_recurrente", [
  "semanal",
  "quincenal",
  "mensual",
  "bimestral",
  "trimestral",
  "anual",
]);

// Stores the immutable charge template separately from each generated cobro.
// A sweep locks this row before emitting a cycle, which is the idempotency
// boundary even when two application instances sweep concurrently.
export const cobrosRecurrentesTable = pgTable("cobros_recurrentes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  responsableId: text("responsable_id").notNull(),
  responsableNombre: text("responsable_nombre"),
  clienteId: integer("cliente_id").references(() => clientesTable.id, { onDelete: "restrict" }).notNull(),
  clienteNombre: text("cliente_nombre").notNull(),
  emailPagador: text("email_pagador"),
  monto: text("monto").notNull(),
  montoNeto: text("monto_neto"),
  montoIva: text("monto_iva"),
  incluyeIva: boolean("incluye_iva").notNull().default(false),
  tipoDocumento: text("tipo_documento").notNull(),
  descripcion: text("descripcion").notNull(),
  referencia: text("referencia"),
  // Snapshot automation at schedule creation. Future children must not depend
  // on a client-side post-create mutation.
  automatizacion: text("automatizacion").notNull().default("ninguna").$type<"ninguna" | "simple" | "workflow">(),
  workflowId: integer("workflow_id"),
  recordatoriosSnapshot: jsonb("recordatorios_snapshot").$type<Array<{ canal: "email" | "whatsapp" | "ambos"; momento: "antes" | "dia" | "despues" | "recurrente"; diasOffset: number; activo: boolean }> | null>(),
  // Initial channels are part of the immutable schedule snapshot so that every
  // generated child can be delivered without relying on a request still being
  // in memory.
  canalesIniciales: jsonb("canales_iniciales").$type<Array<"email" | "whatsapp"> | null>(),
  creadorId: text("creador_id"),
  idempotencyKey: text("idempotency_key"),
  idempotencyPayloadHash: text("idempotency_payload_hash"),
  frecuencia: frecuenciaCobroRecurrenteEnum("frecuencia").notNull(),
  fechaInicio: date("fecha_inicio", { mode: "string" }).notNull(),
  fechaTermino: date("fecha_termino", { mode: "string" }),
  proximaGeneracion: date("proxima_generacion", { mode: "string" }).notNull(),
  // Number of completed periods from fechaInicio; preserves a Jan-31 anchor
  // across short months instead of drifting after a February clamp.
  ciclo: integer("ciclo").notNull().default(0),
  activo: boolean("activo").notNull().default(true),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_cobros_recurrentes_due").on(table.activo, table.proximaGeneracion),
  index("idx_cobros_recurrentes_org").on(table.organizationId),
  uniqueIndex("uq_cobros_recurrentes_idempotency").on(table.idempotencyKey),
]);

export type CobroRecurrente = typeof cobrosRecurrentesTable.$inferSelect;