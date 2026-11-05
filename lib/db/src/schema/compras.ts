import { pgTable, serial, text, integer, numeric, date, timestamp, index } from "drizzle-orm/pg-core";
import { proveedoresTable } from "./proveedores";
import { createInsertSchema } from "drizzle-zod";
export const comprasTable = pgTable("compras", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  usuarioId: text("usuario_id").notNull(),
  numeroFactura: text("numero_factura").notNull(),
  proveedorId: integer("proveedor_id").notNull().references(() => proveedoresTable.id, { onDelete: "restrict" }),
  proveedorNombre: text("proveedor_nombre").notNull(),
  fechaEmision: date("fecha_emision").notNull(),
  fechaRecepcion: date("fecha_recepcion").notNull(),
  estado: text("estado").$type<"borrador" | "recibida" | "contabilizada">().notNull().default("borrador"),
  moneda: text("moneda").notNull().default("CLP"),
  decimales: integer("decimales").notNull().default(0),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
  porcentajeIva: numeric("porcentaje_iva", { precision: 5, scale: 2 }).notNull().default("19"),
  montoIva: numeric("monto_iva", { precision: 14, scale: 2 }).notNull(),
  total: numeric("total", { precision: 14, scale: 2 }).notNull(),
  notas: text("notas").notNull().default(""),
  origen: text("origen").$type<"manual" | "sii">().notNull().default("manual"),
  siiFolio: text("sii_folio"),
  siiXml: text("sii_xml"),
  recibidaPor: text("recibida_por"),
  recibidaEn: timestamp("recibida_en", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("compras_org_fecha_idx").on(t.organizationId, t.fechaEmision), index("compras_proveedor_factura_idx").on(t.proveedorId, t.numeroFactura), index("compras_usuario_idx").on(t.usuarioId)]);
export const insertCompraSchema = createInsertSchema(comprasTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Compra = typeof comprasTable.$inferSelect;
