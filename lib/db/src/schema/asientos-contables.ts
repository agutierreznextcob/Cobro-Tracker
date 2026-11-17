import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  pgEnum,
  varchar,
  date,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { planCuentasTable } from "./plan-cuentas";

// Estado del asiento contable
export const estadoAsientoEnum = pgEnum("estado_asiento", [
  "borrador",    // En construcción, no impacta saldos
  "contabilizado", // Validado y cuadrado (debe = haber), impacta saldos
  "anulado",     // Reversado/anulado, no impacta saldos
]);

// Origen del asiento (para trazabilidad)
export const origenAsientoEnum = pgEnum("origen_asiento", [
  "manual",         // Ingresado manualmente por el usuario
  "cobro",          // Generado automáticamente desde un cobro/venta
  "compra",         // Generado automáticamente desde una compra
  "pago_parcial",   // Generado desde un pago parcial
  "nota_credito",   // Nota de crédito
  "nota_debito",    // Nota de débito
  "depreciacion",   // Asiento de depreciación de activos
  "ajuste",         // Ajuste contable de período
  "apertura",       // Asiento de apertura de período
  "cierre",         // Asiento de cierre de período
  "sii_importacion", // Importado desde SII
]);

// Cabecera del asiento contable (documento que agrupa líneas)
export const asientosContablesTable = pgTable(
  "asientos_contables",
  {
    id: serial("id").primaryKey(),
    // Multi-tenant
    scope: varchar("scope", { length: 64 }).notNull(),
    // Número correlativo por scope/período (ej: "2024-001", "2024-002")
    numero: varchar("numero", { length: 20 }).notNull(),
    // Fecha contable del asiento (puede diferir de la fecha de registro)
    fecha: date("fecha").notNull(),
    // Período contable AAAAMM (ej: "202401" para enero 2024)
    periodo: varchar("periodo", { length: 6 }).notNull(),
    // Descripción/glosa del asiento
    descripcion: text("descripcion").notNull(),
    // Estado
    estado: estadoAsientoEnum("estado").notNull().default("borrador"),
    // Origen del asiento
    origen: origenAsientoEnum("origen").notNull().default("manual"),
    // Referencia al documento origen (id de cobro, compra, etc.)
    origenId: integer("origen_id"),
    // Moneda (CLP por defecto, puede ser USD, EUR, etc.)
    moneda: varchar("moneda", { length: 3 }).notNull().default("CLP"),
    // Tipo de cambio respecto a CLP si moneda != CLP
    tipoCambio: numeric("tipo_cambio", { precision: 15, scale: 6 }).default("1"),
    // Usuario que registró el asiento
    usuarioId: varchar("usuario_id", { length: 64 }).notNull(),
    // Notas adicionales
    notas: text("notas"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("asientos_scope_idx").on(t.scope),
    index("asientos_periodo_idx").on(t.scope, t.periodo),
    index("asientos_fecha_idx").on(t.scope, t.fecha),
    index("asientos_origen_idx").on(t.origenId, t.origen),
  ],
);

// Líneas del asiento contable (partidas dobles: cada asiento tiene ≥2 líneas)
export const asientoLineasTable = pgTable(
  "asiento_lineas",
  {
    id: serial("id").primaryKey(),
    asientoId: integer("asiento_id")
      .notNull()
      .references(() => asientosContablesTable.id, { onDelete: "cascade" }),
    // Cuenta contable (FK al plan de cuentas)
    cuentaId: integer("cuenta_id")
      .notNull()
      .references(() => planCuentasTable.id),
    // Código de cuenta (desnormalizado para rendimiento y auditoría)
    cuentaCodigo: varchar("cuenta_codigo", { length: 20 }).notNull(),
    // Nombre de cuenta (desnormalizado)
    cuentaNombre: text("cuenta_nombre").notNull(),
    // Monto en DEBE (0 si es HABER)
    debe: numeric("debe", { precision: 15, scale: 2 }).notNull().default("0"),
    // Monto en HABER (0 si es DEBE)
    haber: numeric("haber", { precision: 15, scale: 2 }).notNull().default("0"),
    // Glosa de la línea (complementa la del asiento)
    descripcion: text("descripcion"),
    // Referencia a área/departamento/centro de costo
    areaId: integer("area_id"),
    // Número de línea (orden dentro del asiento)
    orden: integer("orden").notNull().default(0),
  },
  (t) => [
    index("asiento_lineas_asiento_idx").on(t.asientoId),
    index("asiento_lineas_cuenta_idx").on(t.cuentaId),
  ],
);

export const insertAsientoSchema = createInsertSchema(asientosContablesTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});
export const insertAsientoLineaSchema = createInsertSchema(asientoLineasTable).omit({ id: true });

export type InsertAsiento = z.infer<typeof insertAsientoSchema>;
export type Asiento = typeof asientosContablesTable.$inferSelect;
export type InsertAsientoLinea = z.infer<typeof insertAsientoLineaSchema>;
export type AsientoLinea = typeof asientoLineasTable.$inferSelect;
