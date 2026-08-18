import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Auditoría de extensiones de trial hechas por el superadmin. Snapshot
// auto-contenido (sin FKs) para que el registro sobreviva a la eliminación
// del usuario. Visible solo en el panel superadmin.
export const trialExtensionesTable = pgTable("trial_extensiones", {
  id: serial("id").primaryKey(),
  usuarioId: text("usuario_id").notNull(),
  usuarioNombre: text("usuario_nombre"),
  usuarioEmail: text("usuario_email"),
  usuarioAccountId: text("usuario_account_id"),
  adminId: text("admin_id").notNull(),
  adminNombre: text("admin_nombre"),
  fechaAnterior: timestamp("fecha_anterior", { withTimezone: true }),
  fechaNueva: timestamp("fecha_nueva", { withTimezone: true }).notNull(),
  motivo: text("motivo"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type TrialExtension = typeof trialExtensionesTable.$inferSelect;
