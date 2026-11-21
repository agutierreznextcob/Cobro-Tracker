import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * Configuración de documentos de venta por organización/usuario.
 * Permite personalizar nombre, activar/desactivar y controlar si rebaja o aumenta stock.
 */
export const documentosVentaTable = pgTable("documentos_venta", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  usuarioId: text("usuario_id").notNull(),
  // Valor del tipo de documento (igual que TIPO_DOCUMENTO_VALUES en frontend)
  tipoDocumento: text("tipo_documento").notNull(),
  // Nombre personalizado visible en la UI (ej: "Boleta Electrónica" → "Boleta")
  nombrePersonalizado: text("nombre_personalizado"),
  // Si el documento está activo (aparece en el selector de ventas)
  activo: boolean("activo").notNull().default(true),
  // Si actualiza stock al emitir este documento
  afectaStock: boolean("afecta_stock").notNull().default(false),
  // Tipo de movimiento: "rebaja" (venta normal) o "aumenta" (nota de crédito)
  tipoMovimientoStock: text("tipo_movimiento_stock")
    .$type<"rebaja" | "aumenta">()
    .default("rebaja"),
  creadoEn: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentoVentaSchema = createInsertSchema(documentosVentaTable).omit({
  id: true, creadoEn: true, actualizadoEn: true,
});

export type DocumentoVenta = typeof documentosVentaTable.$inferSelect;
