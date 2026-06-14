import { pgTable, serial, text, numeric, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";
import { clientesTable } from "./clientes";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const estadoCobroEnum = pgEnum("estado_cobro", [
  "pendiente",
  "pagado",
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
  flowOrdenId: text("flow_orden_id"),
  flowToken: text("flow_token"),
  flowLinkPago: text("flow_link_pago"),
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
