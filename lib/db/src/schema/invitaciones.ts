import { integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { orgRoleEnum } from "./organizaciones";

export const invitacionEstadoEnum = pgEnum("invitacion_estado", [
  "pendiente",
  "aceptada",
  "cancelada",
  "expirada",
]);

export const invitacionesTable = pgTable("invitaciones", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  email: varchar("email").notNull(),
  orgRole: orgRoleEnum("org_role").notNull().default("ejecutivo"),
  token: varchar("token").notNull().unique(),
  estado: invitacionEstadoEnum("estado").notNull().default("pendiente"),
  // User id + cached name of the admin who sent the invitation.
  invitadoPorId: varchar("invitado_por_id"),
  invitadoPorNombre: text("invitado_por_nombre"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  expiraEn: timestamp("expira_en", { withTimezone: true }),
  aceptadaEn: timestamp("aceptada_en", { withTimezone: true }),
});

export const insertInvitacionSchema = createInsertSchema(invitacionesTable).omit({
  id: true,
  creadoEn: true,
});

export type InsertInvitacion = z.infer<typeof insertInvitacionSchema>;
export type Invitacion = typeof invitacionesTable.$inferSelect;
