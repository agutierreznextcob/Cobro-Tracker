import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const flowCredencialesTable = pgTable("flow_credenciales", {
  userId: text("user_id").primaryKey(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  apiKeyIv: text("api_key_iv").notNull(),
  apiKeyAuthTag: text("api_key_auth_tag").notNull(),
  secretKeyEncrypted: text("secret_key_encrypted").notNull(),
  secretKeyIv: text("secret_key_iv").notNull(),
  secretKeyAuthTag: text("secret_key_auth_tag").notNull(),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
});

export type FlowCredenciales = typeof flowCredencialesTable.$inferSelect;
