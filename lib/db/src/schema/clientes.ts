import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientesTable = pgTable("clientes", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  // Optional company/organization the contact belongs to.
  empresa: text("empresa"),
  rut: text("rut"),
  email: text("email"),
  telefono: text("telefono"),
  userId: text("user_id").notNull(),
  // Organization the cliente belongs to (denormalized for org-wide queries).
  organizationId: integer("organization_id"),
  // Unique token for the public debtor portal magic link (generated on demand).
  portalToken: text("portal_token").unique(),
  // When the current portal token was generated/rotated (to detect stale links).
  portalTokenGeneradoEn: timestamp("portal_token_generado_en"),
  // Last successful portal-link send: when and through which channel(s).
  portalEnviadoEn: timestamp("portal_enviado_en"),
  portalEnviadoCanal: text("portal_enviado_canal"),
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
