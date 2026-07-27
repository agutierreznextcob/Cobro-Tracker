import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

// One-question satisfaction survey sent to the client when a cobro is paid.
// One survey per cobro (unique cobroId). Reachable publicly via `token`.
export const encuestasTable = pgTable(
  "encuestas_satisfaccion",
  {
    id: serial("id").primaryKey(),
    cobroId: integer("cobro_id")
      .notNull()
      .references(() => cobrosTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id"),
    userId: text("user_id"),
    clienteId: integer("cliente_id"),
    clienteNombre: text("cliente_nombre"),
    token: text("token").notNull(),
    // 1..5 satisfaction rating (null until the client answers).
    calificacion: integer("calificacion"),
    comentario: text("comentario"),
    respondidoEn: timestamp("respondido_en", { withTimezone: true }),
    // Deferred delivery: the survey email is sent ~1h after payment (so the
    // client isn't hit with receipt + survey at once). Sweep sends when due.
    enviarEn: timestamp("enviar_en", { withTimezone: true }).notNull().defaultNow(),
    // Set only on successful send (idempotency), claim timestamp guards retries.
    emailEnviadoEn: timestamp("email_enviado_en", { withTimezone: true }),
    emailIntentoEn: timestamp("email_intento_en", { withTimezone: true }),
    // Failed-send counter; the sweep gives up after a few attempts (or is set to
    // a terminal value when the survey should never be sent, e.g. refunded cobro).
    emailIntentos: integer("email_intentos").notNull().default(0),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_encuestas_cobro").on(table.cobroId),
    uniqueIndex("ux_encuestas_token").on(table.token),
  ],
);

export type Encuesta = typeof encuestasTable.$inferSelect;
