import { pgTable, serial, integer, text, timestamp, date, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

// History + idempotency log for workflow step executions. Mirrors the
// recordatorios_enviados claim/unique-index race-safety pattern, but a workflow
// step runs ONCE per cobro (not per day): the unique index is on (cobroId,
// stepId). Rows with a null stepId (e.g. "al pagar" survey/comprobante logs) are
// deduped elsewhere (encuestas/comprobantes tables) — Postgres treats NULLs as
// distinct so they don't collide here.
export const workflowEjecucionesTable = pgTable(
  "workflow_ejecuciones",
  {
    id: serial("id").primaryKey(),
    cobroId: integer("cobro_id")
      .notNull()
      .references(() => cobrosTable.id, { onDelete: "cascade" }),
    workflowId: integer("workflow_id").notNull(),
    stepId: integer("step_id"),
    accionTipo: text("accion_tipo").notNull(),
    estado: text("estado").notNull().$type<"enviado" | "fallido" | "pendiente" | "omitido">(),
    detalle: text("detalle"),
    resultado: jsonb("resultado"),
    fecha: date("fecha", { mode: "string" }).notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_workflow_ejecuciones_step").on(table.cobroId, table.stepId)],
);

export type WorkflowEjecucion = typeof workflowEjecucionesTable.$inferSelect;
