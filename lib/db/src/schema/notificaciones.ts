import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const notificacionesTable = pgTable(
  "notificaciones",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    cobroId: integer("cobro_id").references(() => cobrosTable.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull().default("whatsapp"),
    titulo: text("titulo").notNull(),
    mensaje: text("mensaje"),
    waUrl: text("wa_url"),
    leida: boolean("leida").notNull().default(false),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_notificaciones_user_reciente").on(table.userId, table.creadoEn)],
);

// This is deliberately separate from the display table. Notification rows are
// pruned, while event claims are permanent idempotency evidence.
export const notificacionEventosTable = pgTable("notificacion_eventos", {
  eventoKey: text("evento_key").primaryKey(),
  userId: text("user_id").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

// One resumable historical-backfill claim per user. Normal GET requests only
// claim this tiny row; the expensive historical scan runs in the background.
export const notificacionBackfillsTable = pgTable("notificacion_backfills", {
  userId: text("user_id").primaryKey(),
  intentoEn: timestamp("intento_en", { withTimezone: true }).notNull().defaultNow(),
  completadoEn: timestamp("completado_en", { withTimezone: true }),
});

// Durable read cursor used to make "mark all" race-safe with historical rows
// being inserted by a background worker on another API process.
export const notificacionLecturasTable = pgTable("notificacion_lecturas", {
  userId: text("user_id").primaryKey(),
  leidoHastaEn: timestamp("leido_hasta_en", { withTimezone: true }).notNull(),
});

export type Notificacion = typeof notificacionesTable.$inferSelect;
