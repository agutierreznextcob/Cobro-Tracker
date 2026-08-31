import { pgTable, serial, integer, text, numeric, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const estadoAbonoEnum = pgEnum("estado_abono", [
  "pendiente",
  "confirmado",
  "fallido",
]);

export const metodoPagoAbonoEnum = pgEnum("metodo_pago_abono", [
  "flow",
  "mp",
  "manual",
]);

export const pagosParciales = pgTable("pagos_parciales", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  monto: numeric("monto", { precision: 12, scale: 2 }).notNull(),
  metodo: metodoPagoAbonoEnum("metodo").notNull(),
  estado: estadoAbonoEnum("estado").notNull().default("pendiente"),
  linkPago: text("link_pago"),
  flowToken: text("flow_token"),
  flowOrdenId: text("flow_orden_id"),
  mpPreferenceId: text("mp_preference_id"),
  mpPaymentId: text("mp_payment_id"),
  notas: text("notas"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  confirmadoEn: timestamp("confirmado_en"),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
  estadoVerificadoEn: timestamp("estado_verificado_en"),
});

export type PagoParcial = typeof pagosParciales.$inferSelect;
