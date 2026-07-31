import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Prepaid platform-subscription purchases: the user pays N months (1/3/6/12)
// upfront through a one-off Flow payment (platform Flow account). When Flow
// confirms the payment, subscription_period_end is extended by `meses` months.
export const prepagosTable = pgTable("prepagos_suscripcion", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  meses: integer("meses").notNull(),
  // Snapshot of the charged amounts (CLP) at purchase time.
  usuariosAdicionales: integer("usuarios_adicionales").notNull().default(0),
  montoNeto: integer("monto_neto").notNull(),
  montoIva: integer("monto_iva").notNull(),
  montoTotal: integer("monto_total").notNull(),
  // Flow one-off payment identifiers.
  commerceOrder: text("commerce_order").notNull().unique(),
  flowToken: text("flow_token"),
  // pendiente → pagado (period extended) | rechazado. The pendiente→pagado
  // transition is claimed atomically so a duplicate webhook can't double-extend.
  estado: text("estado").notNull().default("pendiente"),
  pagadoEn: timestamp("pagado_en", { withTimezone: true }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type Prepago = typeof prepagosTable.$inferSelect;
