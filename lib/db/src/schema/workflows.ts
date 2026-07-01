import { pgTable, serial, text, integer, boolean, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

// When the workflow starts acting on a cobro (the "anchor" for step delays):
//   cobro_creado       — anchor = fecha de creación del cobro
//   proximo_vencer     — anchor = fechaVencimiento - triggerDias
//   vencido            — anchor = fechaVencimiento
//   dias_mora          — anchor = fechaVencimiento + triggerDias
//   no_pagado_despues  — anchor = fecha de creación + triggerDias
//   marcado_parcial    — anchor = fecha en que el cobro pasó a parcial (aprox. actualizadoEn)
//   email_no_abierto   — best-effort: sin open-tracking real se trata como no abierto
export const workflowTriggerEnum = pgEnum("workflow_trigger", [
  "cobro_creado",
  "proximo_vencer",
  "vencido",
  "dias_mora",
  "no_pagado_despues",
  "marcado_parcial",
  "email_no_abierto",
]);

export const workflowsTable = pgTable("workflows", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  userId: text("user_id").notNull(),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  activo: boolean("activo").notNull().default(true),
  // Identifies the predefined template this workflow was instantiated from
  // (null for fully custom workflows). Also marks the seeded template rows.
  plantillaKey: text("plantilla_key"),
  triggerTipo: workflowTriggerEnum("trigger_tipo").notNull().default("vencido"),
  triggerDias: integer("trigger_dias").notNull().default(0),
  // Optional conditions gating whether the workflow acts on a given cobro:
  // { montoMin?, montoMax?, scores?: string[], tiposDocumento?: string[],
  //   clienteIds?: number[], responsableIds?: string[] }
  condiciones: jsonb("condiciones").$type<WorkflowCondiciones | null>(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

export interface WorkflowCondiciones {
  montoMin?: number | null;
  montoMax?: number | null;
  scores?: string[] | null;
  tiposDocumento?: string[] | null;
  clienteIds?: number[] | null;
  responsableIds?: string[] | null;
}

export type Workflow = typeof workflowsTable.$inferSelect;
