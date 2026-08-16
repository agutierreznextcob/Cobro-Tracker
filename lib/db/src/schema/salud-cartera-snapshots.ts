import { pgTable, serial, varchar, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Daily snapshot of the "Salud de cartera" traffic-light blocks, per user.
// Each row captures what THAT user's scoped dashboard (admin=org, supervisor=
// team, ejecutivo=own) showed at the Santiago-day `fecha`. Written by the
// daily sweep; read by GET /dashboard/salud-cartera to compute exact
// week-over-week trends (with fallback to the reconstruction when absent).
export const saludCarteraSnapshotsTable = pgTable(
  "salud_cartera_snapshots",
  {
    id: serial("id").primaryKey(),
    usuarioId: varchar("usuario_id").notNull(),
    // Santiago-local day (YYYY-MM-DD) the snapshot represents.
    fecha: varchar("fecha", { length: 10 }).notNull(),
    sanaMonto: numeric("sana_monto", { precision: 14, scale: 2 }).notNull(),
    sanaCantidad: integer("sana_cantidad").notNull(),
    riesgoMonto: numeric("riesgo_monto", { precision: 14, scale: 2 }).notNull(),
    riesgoCantidad: integer("riesgo_cantidad").notNull(),
    criticaMonto: numeric("critica_monto", { precision: 14, scale: 2 }).notNull(),
    criticaCantidad: integer("critica_cantidad").notNull(),
    // Sum of days-overdue across critical cobros (avg = suma / cantidad).
    criticaSumaMora: integer("critica_suma_mora").notNull().default(0),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One snapshot per user per day; makes the sweep idempotent (ON CONFLICT
    // DO NOTHING). New table, so the unique constraint is safe to push.
    uniqueIndex("salud_cartera_snapshots_usuario_fecha_idx").on(t.usuarioId, t.fecha),
  ],
);

export type SaludCarteraSnapshot = typeof saludCarteraSnapshotsTable.$inferSelect;
