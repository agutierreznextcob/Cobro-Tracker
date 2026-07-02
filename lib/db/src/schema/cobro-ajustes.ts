import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

// Audit history of TOTAL-amount adjustments made to a cobro that already has
// confirmed partial payments (abonos). Every such change is recorded here with
// an obligatory reason, so there is a permanent trail of who lowered a charge and
// why. Discounts on the pending balance live in `cobro_descuentos`; this table is
// specifically for changing the cobro's `monto` (total) under partial payments.
export const cobroAjustesTable = pgTable("cobro_ajustes", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  montoOriginal: numeric("monto_original", { precision: 12, scale: 2 }).notNull(),
  montoNuevo: numeric("monto_nuevo", { precision: 12, scale: 2 }).notNull(),
  motivo: text("motivo").notNull(),
  ajustadoPorId: text("ajustado_por_id"),
  ajustadoPorNombre: text("ajustado_por_nombre"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type CobroAjuste = typeof cobroAjustesTable.$inferSelect;
