import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { localesTable } from "./locales";

export const bodegasTable = pgTable("bodegas", {
  id: serial("id").primaryKey(),
  localId: integer("local_id").notNull().references(() => localesTable.id, { onDelete: "restrict" }),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion").notNull().default(""),
  activo: boolean("activo").notNull().default(true),
  creadoEn: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("bodegas_local_idx").on(t.localId)]);
export const insertBodegaSchema = createInsertSchema(bodegasTable).omit({ id: true, creadoEn: true });
export type Bodega = typeof bodegasTable.$inferSelect;
