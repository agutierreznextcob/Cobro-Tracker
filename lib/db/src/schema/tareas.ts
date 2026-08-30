import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

// Lightweight tasks assigned to an ejecutivo, created by workflow steps
// (origen "workflow") or manually. Consistent with the notifications pattern:
// scoped per assignee (userId), optionally linked to a cobro.
export const tareasTable = pgTable("tareas", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  userId: text("user_id").notNull(),
  cobroId: integer("cobro_id").references(() => cobrosTable.id, { onDelete: "set null" }),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  estado: text("estado").notNull().$type<"pendiente" | "completada" | "cancelada">().default("pendiente"),
  origen: text("origen").notNull().$type<"workflow" | "manual">().default("workflow"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  completadoEn: timestamp("completado_en", { withTimezone: true }),
  venceEn: timestamp("vence_en", { withTimezone: true }),
  canceladoEn: timestamp("cancelado_en", { withTimezone: true }),
});

export type Tarea = typeof tareasTable.$inferSelect;
