import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Datos bancarios del usuario para cobranza manual por transferencia.
 * El número de cuenta se guarda encriptado (AES-256-GCM, mismo esquema que
 * las credenciales de Flow/MP).
 */
export const datosBancariosTable = pgTable("datos_bancarios", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  banco: text("banco").notNull(),
  tipoCuenta: text("tipo_cuenta").notNull(),
  numeroCuentaEncrypted: text("numero_cuenta_encrypted").notNull(),
  numeroCuentaIv: text("numero_cuenta_iv").notNull(),
  numeroCuentaAuthTag: text("numero_cuenta_auth_tag").notNull(),
  titularNombre: text("titular_nombre").notNull(),
  titularRut: text("titular_rut").notNull(),
  emailComprobantes: text("email_comprobantes").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

export type DatosBancarios = typeof datosBancariosTable.$inferSelect;
