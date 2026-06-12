import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const resultadoWebhookEnum = pgEnum("resultado_webhook", ["exitoso", "fallido"]);

export const webhookEventosTable = pgTable("webhook_eventos", {
  id: serial("id").primaryKey(),
  evento: text("evento").notNull(),
  cobroId: integer("cobro_id").references(() => cobrosTable.id, { onDelete: "set null" }),
  ipOrigen: text("ip_origen"),
  resultado: resultadoWebhookEnum("resultado").notNull(),
  exitoso: boolean("exitoso").notNull(),
  detalle: text("detalle"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

export type WebhookEvento = typeof webhookEventosTable.$inferSelect;
