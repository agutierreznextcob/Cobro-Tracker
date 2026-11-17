import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tipo de cuenta según clasificación IFRS / PCGCh
export const tipoCuentaEnum = pgEnum("tipo_cuenta", [
  "activo",          // Activos corrientes y no corrientes
  "pasivo",          // Pasivos corrientes y no corrientes
  "patrimonio",      // Capital, reservas, resultados acumulados
  "ingreso",         // Ingresos de explotación y otros ingresos
  "egreso",          // Costos, gastos de operación y otros egresos
  "orden",           // Cuentas de orden (contingencias, garantías)
]);

// Naturaleza de la cuenta: define en qué columna normalmente tiene saldo
export const naturalezaCuentaEnum = pgEnum("naturaleza_cuenta", [
  "deudora",   // Activos y gastos (saldo normal en DEBE)
  "acreedora", // Pasivos, patrimonio e ingresos (saldo normal en HABER)
]);

// Plan de cuentas contable. Soporta estructura jerárquica multinivel
// compatible con el Plan General de Cuentas de Chile (IFRS).
// Scope = "org:<orgId>" | "user:<userId>" para multi-tenant.
export const planCuentasTable = pgTable(
  "plan_cuentas",
  {
    id: serial("id").primaryKey(),
    // Multi-tenant: cuenta asociada a la organización/usuario
    scope: varchar("scope", { length: 64 }).notNull(),
    // Código de cuenta (ej: "1", "1.1", "1.1.01", "1.1.01.001")
    codigo: varchar("codigo", { length: 20 }).notNull(),
    // Nombre descriptivo de la cuenta
    nombre: text("nombre").notNull(),
    // Descripción opcional / ayuda contable
    descripcion: text("descripcion"),
    // Tipo contable según IFRS/PCGCh
    tipo: tipoCuentaEnum("tipo").notNull(),
    // Naturaleza (define saldo normal)
    naturaleza: naturalezaCuentaEnum("naturaleza").notNull(),
    // Nivel de profundidad (1=clase, 2=grupo, 3=subgrupo, 4=cuenta, 5=subcuenta)
    nivel: integer("nivel").notNull().default(1),
    // Referencia al padre para jerarquía
    padreId: integer("padre_id"),
    // Sólo las cuentas de nivel más bajo (hojas) admiten asientos
    esHoja: boolean("es_hoja").notNull().default(true),
    // Cuenta activa (permite inactivar sin eliminar)
    activa: boolean("activa").notNull().default(true),
    // ¿Viene del plan estándar IFRS/PCGCh? (false = cuenta personalizada)
    esEstandar: boolean("es_estandar").notNull().default(false),
    // Mapeo a código de cuenta SII para declaraciones
    codigoSii: varchar("codigo_sii", { length: 10 }),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("plan_cuentas_scope_idx").on(t.scope),
    index("plan_cuentas_codigo_scope_idx").on(t.scope, t.codigo),
  ],
);

export const insertPlanCuentaSchema = createInsertSchema(planCuentasTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});

export type InsertPlanCuenta = z.infer<typeof insertPlanCuentaSchema>;
export type PlanCuenta = typeof planCuentasTable.$inferSelect;
