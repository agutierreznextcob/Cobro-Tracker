import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";

// Audit log of deleted cobros for internal control / fraud prevention. Cobros are
// HARD-deleted (row + children removed so they vanish from every report), so this
// table stores a self-contained SNAPSHOT with NO foreign keys to the cobro (which
// no longer exists). Surfaced only in the superadmin panel.
export const cobrosEliminadosTable = pgTable("cobros_eliminados", {
  id: serial("id").primaryKey(),
  // The id the cobro had before deletion (informational only, not an FK).
  cobroIdOriginal: integer("cobro_id_original").notNull(),
  monto: numeric("monto", { precision: 12, scale: 2 }).notNull(),
  montoACobrar: numeric("monto_a_cobrar", { precision: 12, scale: 2 }),
  estado: text("estado").notNull(),
  descripcion: text("descripcion"),
  clienteId: integer("cliente_id"),
  clienteNombre: text("cliente_nombre"),
  organizationId: integer("organization_id"),
  motivo: text("motivo"),
  eliminadoPorId: text("eliminado_por_id"),
  eliminadoPorNombre: text("eliminado_por_nombre"),
  eliminadoEn: timestamp("eliminado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type CobroEliminado = typeof cobrosEliminadosTable.$inferSelect;
