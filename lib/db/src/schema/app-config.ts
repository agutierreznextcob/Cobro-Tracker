import { pgTable, varchar, timestamp } from "drizzle-orm/pg-core";

// Pequeño almacén clave/valor para configuración de la plataforma generada en
// runtime (p. ej. el id del plan creado automáticamente en Reveniu). No es para
// secretos — esos viven en Replit Secrets.
export const appConfigTable = pgTable("app_config", {
  clave: varchar("clave").primaryKey(),
  valor: varchar("valor").notNull(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AppConfig = typeof appConfigTable.$inferSelect;
