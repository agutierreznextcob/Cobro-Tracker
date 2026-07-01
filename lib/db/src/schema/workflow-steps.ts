import { pgTable, serial, integer, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { workflowsTable } from "./workflows";

export const workflowAccionEnum = pgEnum("workflow_accion", [
  "enviar_email",
  "enviar_whatsapp",
  "crear_tarea",
  "notificar_admin",
  "aplicar_descuento",
  "cambiar_estado",
  "enviar_comprobante",
  "enviar_encuesta",
]);

export const workflowStepsTable = pgTable("workflow_steps", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id")
    .notNull()
    .references(() => workflowsTable.id, { onDelete: "cascade" }),
  orden: integer("orden").notNull().default(0),
  // Days after the workflow anchor when this step becomes due.
  delayDias: integer("delay_dias").notNull().default(0),
  accionTipo: workflowAccionEnum("accion_tipo").notNull(),
  // Action-specific configuration:
  // { asunto?, mensaje?, tareaTitulo?, descuentoTipo?, descuentoValor?, nuevoEstado? }
  config: jsonb("config").$type<WorkflowStepConfig | null>(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export interface WorkflowStepConfig {
  asunto?: string | null;
  mensaje?: string | null;
  tareaTitulo?: string | null;
  descuentoTipo?: "porcentaje" | "monto" | null;
  descuentoValor?: number | null;
  nuevoEstado?: "pendiente" | "pagado" | "parcial" | "fallido" | "cancelado" | null;
}

export type WorkflowStep = typeof workflowStepsTable.$inferSelect;
