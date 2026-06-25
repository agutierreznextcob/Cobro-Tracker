import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientesTable = pgTable("clientes", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  rut: text("rut"),
  email: text("email"),
  telefono: text("telefono"),
  userId: text("user_id").notNull(),
  // Organization the cliente belongs to (denormalized for org-wide queries).
  organizationId: integer("organization_id"),
  // Unique token for the public debtor portal magic link (generated on demand).
  portalToken: text("portal_token").unique(),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
});

export const insertClienteSchema = createInsertSchema(clientesTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});

export type InsertCliente = z.infer<typeof insertClienteSchema>;
export type Cliente = typeof clientesTable.$inferSelect;
