import { pgTable, serial, text, numeric, timestamp, pgEnum, integer, date } from "drizzle-orm/pg-core";
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

export const cobrosTable = pgTable("cobros", {
  id: serial("id").primaryKey(),
  monto: numeric("monto", { precision: 12, scale: 2 }).notNull(),
  descripcion: text("descripcion").notNull(),
  estado: estadoCobroEnum("estado").notNull().default("pendiente"),
  referencia: text("referencia"),
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
