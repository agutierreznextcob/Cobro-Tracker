import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const mpCredencialesTable = pgTable("mp_credenciales", {
  userId: text("user_id").primaryKey(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  accessTokenIv: text("access_token_iv").notNull(),
  accessTokenAuthTag: text("access_token_auth_tag").notNull(),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
});

export type MpCredenciales = typeof mpCredencialesTable.$inferSelect;
