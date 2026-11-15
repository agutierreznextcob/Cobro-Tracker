import { pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Role of a user WITHIN their organization. Distinct from the platform-level
// users.role (user|admin). admin_org sees and manages everything in the org;
// supervisor sees/manages only the cobros and clientes of the ejecutivos
// assigned to them (users.supervisorId) plus their own; ejecutivo only sees
// and manages what is assigned to them.
// admin_org: dueño/admin de la org, ve y gestiona todo.
// gerente: ve a sus supervisores y los ejecutivos de esos supervisores.
// supervisor: ve a sus ejecutivos asignados (via supervisorId).
// ejecutivo: solo ve sus propios registros.
export const orgRoleEnum = pgEnum("org_role", ["admin_org", "gerente", "subgerente", "supervisor", "ejecutivo"]);

export const organizacionesTable = pgTable("organizaciones", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  // User id (users.id) of the admin who created/owns the organization.
  // No hard FK by convention (matches cobros.responsableId / clientes.userId).
  ownerId: varchar("owner_id").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertOrganizacionSchema = createInsertSchema(organizacionesTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});

export type InsertOrganizacion = z.infer<typeof insertOrganizacionSchema>;
export type Organizacion = typeof organizacionesTable.$inferSelect;
