import { pgTable, serial, text, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { clientesTable } from "./clientes";
import { cotizacionesTable } from "./cotizaciones";
import { createInsertSchema } from "drizzle-zod";

export const pedidosTable = pgTable("pedidos", {
  id: serial("id").primaryKey(),
  numeroPedido: text("numero_pedido").notNull(),
  organizationId: integer("organization_id"),
  responsableId: text("responsable_id").notNull(),
  clienteId: integer("cliente_id").notNull().references(() => clientesTable.id, { onDelete: "restrict" }),
  clienteNombre: text("cliente_nombre").notNull(),
  clienteRut: text("cliente_rut"),
  clienteEmail: text("cliente_email"),
  clienteDireccion: text("cliente_direccion"),
  cotizacionId: integer("cotizacion_id").references(() => cotizacionesTable.id, { onDelete: "set null" }),
  estado: text("estado")
    .$type<"pendiente" | "aprobado" | "despachado" | "cancelado">()
    .notNull()
    .default("pendiente"),
  moneda: text("moneda").notNull().default("CLP"),
  decimales: integer("decimales").notNull().default(0),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  porcentajeIva: numeric("porcentaje_iva", { precision: 5, scale: 2 }).notNull().default("19"),
  montoIva: numeric("monto_iva", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  notas: text("notas").notNull().default(""),
  notasLogistica: text("notas_logistica").notNull().default(""),
  aprobadoPor: text("aprobado_por"),
  aprobadoEn: timestamp("aprobado_en", { withTimezone: true }),
  despachadorId: text("despachador_id"),
  despachadoEn: timestamp("despachado_en", { withTimezone: true }),
  guiaDespachoId: integer("guia_despacho_id"),
  creadoEn: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPedidoSchema = createInsertSchema(pedidosTable).omit({ id: true, creadoEn: true, actualizadoEn: true });
export type Pedido = typeof pedidosTable.$inferSelect;
