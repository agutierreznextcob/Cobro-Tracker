import { sql } from "drizzle-orm";
import { pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

// Lista de espera del plan Pro ("Próximamente"). Un email por fila; el UNIQUE
// deduplica reintentos (la tabla nace vacía, así que el constraint es seguro).
export const proWaitlistTable = pgTable("pro_waitlist", {
  id: serial("id").primaryKey(),
  email: varchar("email").notNull().unique(),
  // users.id si el interesado estaba autenticado (sin FK dura, por convención).
  userId: varchar("user_id"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().default(sql`now()`),
});
