import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { cobrosTable } from "./cobros";

export const estadoComprobanteTransferenciaEnum = pgEnum("estado_comprobante_transferencia", [
  "pendiente",
  "confirmado",
  "rechazado",
]);

/**
 * Comprobantes de transferencia subidos por el deudor desde el portal público.
 * El archivo se guarda como data URL (imagen o PDF en base64), igual que los
 * avatares de perfil. El ejecutivo responsable lo revisa y confirma el pago.
 */
export const comprobantesTransferenciaTable = pgTable("comprobantes_transferencia", {
  id: serial("id").primaryKey(),
  cobroId: integer("cobro_id")
    .notNull()
    .references(() => cobrosTable.id, { onDelete: "cascade" }),
  archivo: text("archivo").notNull(),
  nombreArchivo: text("nombre_archivo"),
  comentario: text("comentario"),
  estado: estadoComprobanteTransferenciaEnum("estado").notNull().default("pendiente"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  resueltoEn: timestamp("resuelto_en", { withTimezone: true }),
});

export type ComprobanteTransferencia = typeof comprobantesTransferenciaTable.$inferSelect;
