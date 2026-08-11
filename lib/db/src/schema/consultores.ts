import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  pgEnum,
  text,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// Acceso de consultores de soporte NextCob (Ley 21.719): credenciales
// independientes del login de clientes y del superadmin. Un consultor ingresa
// por /consultor con el account ID del cliente + su contraseña de consultor y
// ve la plataforma como ese cliente, con restricciones (sin credenciales de
// pago, sin datos bancarios, sin cambio de contraseña ni eliminación de
// cuenta). Toda sesión y acción queda auditada.
export const consultorTipoEnum = pgEnum("consultor_tipo", ["soporte", "admin"]);

export const consultoresTable = pgTable("consultores", {
  id: serial("id").primaryKey(),
  nombre: varchar("nombre").notNull(),
  tipo: consultorTipoEnum("tipo").notNull().default("soporte"),
  // bcrypt. La contraseña se genera en el servidor y se muestra UNA sola vez.
  passwordHash: varchar("password_hash").notNull(),
  activo: boolean("activo").notNull().default(true),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

// Registro de auditoría: una fila por sesión de consultor sobre una cuenta.
export const consultorSesionesTable = pgTable(
  "consultor_sesiones",
  {
    id: serial("id").primaryKey(),
    consultorId: integer("consultor_id").notNull(),
    // Snapshot del nombre (el consultor puede renombrarse o borrarse después).
    consultorNombre: varchar("consultor_nombre").notNull(),
    // Cuenta visitada (users.id + snapshot del account ID público).
    userId: varchar("user_id").notNull(),
    accountId: varchar("account_id"),
    inicioEn: timestamp("inicio_en", { withTimezone: true }).notNull().defaultNow(),
    // null mientras la sesión está abierta; se fija al cerrar sesión o al
    // expirar la sesión del lado del servidor.
    finEn: timestamp("fin_en", { withTimezone: true }),
  },
  (t) => [index("consultor_sesiones_user_idx").on(t.userId)],
);

// Acciones realizadas dentro de una sesión de consultor (mutaciones y vistas
// de cobros). Detalle legible para el superadmin y el cliente.
export const consultorAccionesTable = pgTable(
  "consultor_acciones",
  {
    id: serial("id").primaryKey(),
    sesionId: integer("sesion_id").notNull(),
    metodo: varchar("metodo").notNull(),
    ruta: varchar("ruta").notNull(),
    detalle: text("detalle"),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consultor_acciones_sesion_idx").on(t.sesionId)],
);
