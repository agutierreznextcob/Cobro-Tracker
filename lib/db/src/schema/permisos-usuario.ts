import { pgEnum, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Módulos disponibles en la plataforma que se pueden controlar con permisos.
export const moduloEnum = pgEnum("modulo_permiso", [
  "cobros",
  "clientes",
  "cotizaciones",
  "pedidos",
  "guias_despacho",
  "inventario",
  "compras",
  "proveedores",
  "informes",
  "workflows",
  "tareas",
  "configuracion",
]);

// Nivel de acceso para un módulo.
// - lectura: solo puede ver, no crear ni modificar
// - lectura_escritura: puede ver, crear y modificar
export const nivelPermisoEnum = pgEnum("nivel_permiso", ["lectura", "lectura_escritura"]);

// Permisos de acceso a módulos por usuario dentro de una organización.
// Si un usuario no tiene registro para un módulo, el comportamiento por
// defecto depende de su orgRole: admin_org tiene acceso completo a todo;
// supervisor y ejecutivo requieren permiso explícito.
export const permisosUsuarioTable = pgTable("permisos_usuario", {
  id: serial("id").primaryKey(),
  // Usuario al que se le asigna el permiso (users.id).
  userId: varchar("user_id").notNull(),
  // Organización a la que pertenece el permiso (organizaciones.id).
  organizationId: varchar("organization_id").notNull(),
  // Módulo al que aplica el permiso.
  modulo: moduloEnum("modulo").notNull(),
  // Nivel de acceso.
  nivel: nivelPermisoEnum("nivel").notNull().default("lectura"),
  // Quién asignó este permiso (users.id del admin_org).
  asignadoPor: varchar("asignado_por"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPermisoUsuarioSchema = createInsertSchema(permisosUsuarioTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});

export type InsertPermisoUsuario = z.infer<typeof insertPermisoUsuarioSchema>;
export type PermisoUsuario = typeof permisosUsuarioTable.$inferSelect;

export type ModuloPermiso = typeof moduloEnum.enumValues[number];
export type NivelPermiso = typeof nivelPermisoEnum.enumValues[number];
