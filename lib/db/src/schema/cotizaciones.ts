import { pgTable, serial, text, integer, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import { clientesTable } from "./clientes";
import { createInsertSchema } from "drizzle-zod";

export const cotizacionesTable = pgTable("cotizaciones", {
  id: serial("id").primaryKey(),
  numeroCotizacion: text("numero_cotizacion").notNull(),
  organizationId: integer("organization_id"),
  responsableId: text("responsable_id").notNull(),
  clienteId: integer("cliente_id").notNull().references(() => clientesTable.id, { onDelete: "restrict" }),
  clienteNombre: text("cliente_nombre").notNull(),
  clienteRut: text("cliente_rut"),
  clienteEmail: text("cliente_email"),
  clienteDireccion: text("cliente_direccion"),
  clienteGiro: text("cliente_giro").notNull().default(""),
  formaPago: text("forma_pago").notNull().default(""),
  tiempoEntrega: text("tiempo_entrega").notNull().default(""),
  validezDias: integer("validez_dias").notNull().default(30),
  fechaEmision: date("fecha_emision").notNull(),
  fechaVencimiento: date("fecha_vencimiento").notNull(),
  estado: text("estado").$type<"borrador" | "enviada" | "aceptada" | "rechazada" | "vencida">().notNull().default("borrador"),
  moneda: text("moneda").notNull().default("CLP"),
  decimales: integer("decimales").notNull().default(0),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  porcentajeIva: numeric("porcentaje_iva", { precision: 5, scale: 2 }).notNull().default("19"),
  montoIva: numeric("monto_iva", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  notas: text("notas").notNull().default(""),
  cobroId: integer("cobro_id"),
  enviadoEn: timestamp("enviado_en", { withTimezone: true }),
  envioEnCurso: timestamp("envio_en_curso", { withTimezone: true }),
  envioPdf: jsonb("envio_pdf").$type<{
    path: string; sha256: string; bytes: number; scope: string; preparedAt: string;
    providerId?: string;
    retry?: { key: string; authorizedAt: string };
    audit?: { at: string; actor: string; action: string; key: string; reason: string; evidence: string; providerId?: string }[];
    message?: { from: string; replyTo?: string; to: string[]; subject: string; html: string };
    email: { id: number; version: string; numero: string; email: string; cliente: string;
      total: number; moneda: string; decimales: number; vencimiento: string;
      remitente: { nombre?: string | null; email?: string | null } };
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertCotizacionSchema = createInsertSchema(cotizacionesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Cotizacion = typeof cotizacionesTable.$inferSelect;
