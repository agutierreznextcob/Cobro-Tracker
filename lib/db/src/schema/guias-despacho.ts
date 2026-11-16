import { pgTable, serial, text, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { clientesTable } from "./clientes";
import { pedidosTable } from "./pedidos";
import { createInsertSchema } from "drizzle-zod";

export const guiasDespachoTable = pgTable("guias_despacho", {
  id: serial("id").primaryKey(),
  numeroGuia: text("numero_guia").notNull(),
  organizationId: integer("organization_id"),
  responsableId: text("responsable_id").notNull(),
  clienteId: integer("cliente_id").notNull().references(() => clientesTable.id, { onDelete: "restrict" }),
  clienteNombre: text("cliente_nombre").notNull(),
  clienteRut: text("cliente_rut"),
  clienteDireccion: text("cliente_direccion"),
  pedidoId: integer("pedido_id").references(() => pedidosTable.id, { onDelete: "set null" }),
  cobroId: integer("cobro_id"),
  estado: text("estado")
    .$type<"emitida" | "en_despacho" | "entregada" | "anulada">()
    .notNull()
    .default("emitida"),
  fechaEmision: date("fecha_emision").notNull(),
  transportista: text("transportista").notNull().default(""),
  patenteVehiculo: text("patente_vehiculo").notNull().default(""),
  chofer: text("chofer").notNull().default(""),
  direccionOrigen: text("direccion_origen").notNull().default(""),
  direccionDestino: text("direccion_destino").notNull().default(""),
  moneda: text("moneda").notNull().default("CLP"),
  decimales: integer("decimales").notNull().default(0),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  porcentajeIva: numeric("porcentaje_iva", { precision: 5, scale: 2 }).notNull().default("19"),
  montoIva: numeric("monto_iva", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  observaciones: text("observaciones").notNull().default(""),
  areaId: integer("area_id"),
  creadoEn: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGuiaDespachoSchema = createInsertSchema(guiasDespachoTable).omit({ id: true, creadoEn: true, actualizadoEn: true });
export type GuiaDespacho = typeof guiasDespachoTable.$inferSelect;
