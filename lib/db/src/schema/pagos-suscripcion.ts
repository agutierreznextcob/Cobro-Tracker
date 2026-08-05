import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  pgEnum,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Registro de pagos de suscripción de la plataforma (libro de ingresos de
// NextCob SpA). Una fila por intento/cargo de suscripción de cada cliente.
// Los montos son CLP enteros: montoNeto + montoIva = montoTotal (IVA 19%).
export const estadoPagoSuscripcionEnum = pgEnum("estado_pago_suscripcion", [
  "pagado",
  "pendiente",
  "fallido",
]);

export const pagosSuscripcionTable = pgTable("pagos_suscripcion", {
  id: serial("id").primaryKey(),
  // users.id del cliente (dueño de la cuenta que paga). Sin FK dura, por
  // convención del proyecto.
  userId: varchar("user_id").notNull(),
  // Fecha del pago (o del intento).
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  // Snapshot de la composición del plan al momento del cobro.
  usuariosAdicionales: integer("usuarios_adicionales").notNull().default(0),
  montoNeto: integer("monto_neto").notNull(),
  montoIva: integer("monto_iva").notNull(),
  montoTotal: integer("monto_total").notNull(),
  estado: estadoPagoSuscripcionEnum("estado").notNull().default("pendiente"),
  // Método de pago: "fintoc" cuando esté integrado; "flow" para cargos Flow.
  metodo: varchar("metodo").notNull().default("flow"),
  // Fin del período cubierto por este cargo; junto a userId permite
  // idempotencia (un cargo por período por usuario).
  periodoHasta: timestamp("periodo_hasta", { withTimezone: true }),
  detalle: text("detalle"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Idempotencia a nivel de BD: un cargo por usuario+período. Los webhooks de
  // Flow pueden reintentarse o llegar en paralelo; el insert usa
  // onConflictDoNothing sobre este índice. (Índice único agregado con la tabla
  // recién creada/vacía, así drizzle push no exige truncar.)
  uniqueIndex("pagos_suscripcion_user_periodo_uq").on(t.userId, t.periodoHasta),
]);

export type PagoSuscripcion = typeof pagosSuscripcionTable.$inferSelect;
export type NewPagoSuscripcion = typeof pagosSuscripcionTable.$inferInsert;
