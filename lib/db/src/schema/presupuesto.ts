import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  pgEnum,
  varchar,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { planCuentasTable } from "./plan-cuentas";

// Estado del presupuesto
export const estadoPresupuestoEnum = pgEnum("estado_presupuesto", [
  "borrador",   // En edición
  "aprobado",   // Aprobado y vigente
  "cerrado",    // Período cerrado, solo lectura
]);

// Presupuesto por año: agrupa todos los ítems de un año fiscal
export const presupuestosTable = pgTable(
  "presupuestos",
  {
    id: serial("id").primaryKey(),
    scope: varchar("scope", { length: 64 }).notNull(),
    // Año fiscal (ej: 2024, 2025)
    anio: integer("anio").notNull(),
    // Nombre descriptivo (ej: "Presupuesto Anual 2025")
    nombre: text("nombre").notNull(),
    // Estado del presupuesto
    estado: estadoPresupuestoEnum("estado").notNull().default("borrador"),
    // Notas generales del presupuesto
    notas: text("notas"),
    // Usuario que creó el presupuesto
    usuarioId: varchar("usuario_id", { length: 64 }).notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("presupuestos_scope_idx").on(t.scope),
    uniqueIndex("presupuestos_scope_anio_idx").on(t.scope, t.anio),
  ],
);

// Ítems de presupuesto: monto mensual por cuenta contable
// Un ítem por (presupuesto, cuenta, mes): permite análisis real vs presupuestado
export const presupuestoItemsTable = pgTable(
  "presupuesto_items",
  {
    id: serial("id").primaryKey(),
    presupuestoId: integer("presupuesto_id")
      .notNull()
      .references(() => presupuestosTable.id, { onDelete: "cascade" }),
    // Cuenta contable asociada
    cuentaId: integer("cuenta_id")
      .notNull()
      .references(() => planCuentasTable.id),
    // Código desnormalizado para rendimiento
    cuentaCodigo: varchar("cuenta_codigo", { length: 20 }).notNull(),
    cuentaNombre: text("cuenta_nombre").notNull(),
    // Mes 1-12
    mes: integer("mes").notNull(),
    // Monto presupuestado para ese mes en esa cuenta
    montoPres: numeric("monto_pres", { precision: 15, scale: 2 }).notNull().default("0"),
    // Área/departamento/centro de costo (opcional)
    areaId: integer("area_id"),
    // Notas del ítem
    notas: text("notas"),
  },
  (t) => [
    index("pres_items_presupuesto_idx").on(t.presupuestoId),
    index("pres_items_cuenta_idx").on(t.cuentaId),
    uniqueIndex("pres_items_unique_idx").on(t.presupuestoId, t.cuentaId, t.mes, t.areaId),
  ],
);

export const insertPresupuestoSchema = createInsertSchema(presupuestosTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});
export const insertPresupuestoItemSchema = createInsertSchema(presupuestoItemsTable).omit({ id: true });

export type InsertPresupuesto = z.infer<typeof insertPresupuestoSchema>;
export type Presupuesto = typeof presupuestosTable.$inferSelect;
export type InsertPresupuestoItem = z.infer<typeof insertPresupuestoItemSchema>;
export type PresupuestoItem = typeof presupuestoItemsTable.$inferSelect;
