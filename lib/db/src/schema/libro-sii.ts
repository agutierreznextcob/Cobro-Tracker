import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  pgEnum,
  varchar,
  date,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tipo de libro SII
export const tipoLibroSiiEnum = pgEnum("tipo_libro_sii", [
  "compras",  // Libro de compras (IVA crédito fiscal)
  "ventas",   // Libro de ventas (IVA débito fiscal)
  "boletas",  // Libro de boletas electrónicas
]);

// Estado del documento en el libro
export const estadoDocSiiEnum = pgEnum("estado_doc_sii", [
  "vigente",          // Documento válido
  "anulado",          // Anulado por nota de crédito o declaración
  "no_incluir",       // Excluido manualmente
  "pendiente_sii",    // Pendiente de acuse de recibo SII
]);

// Importaciones del libro de compra/venta desde SII o manualmente
export const libroSiiImportacionesTable = pgTable(
  "libro_sii_importaciones",
  {
    id: serial("id").primaryKey(),
    scope: varchar("scope", { length: 64 }).notNull(),
    // Período declarado AAAAMM
    periodo: varchar("periodo", { length: 6 }).notNull(),
    // Tipo de libro
    tipo: tipoLibroSiiEnum("tipo").notNull(),
    // Origen de la importación
    origenImportacion: varchar("origen_importacion", { length: 20 }).notNull().default("manual"),
    // Fecha de importación
    importadoEn: timestamp("importado_en", { withTimezone: true }).notNull().defaultNow(),
    // Usuario que importó
    usuarioId: varchar("usuario_id", { length: 64 }).notNull(),
    // Resumen: total débito, total crédito, total neto, total iva
    totalNeto: numeric("total_neto", { precision: 15, scale: 2 }).default("0"),
    totalIva: numeric("total_iva", { precision: 15, scale: 2 }).default("0"),
    totalExento: numeric("total_exento", { precision: 15, scale: 2 }).default("0"),
    totalBruto: numeric("total_bruto", { precision: 15, scale: 2 }).default("0"),
    // JSON con metadata adicional (token SII, número de folios, etc.)
    metadata: jsonb("metadata"),
    notas: text("notas"),
  },
  (t) => [
    index("libro_sii_scope_periodo_idx").on(t.scope, t.periodo),
    index("libro_sii_tipo_idx").on(t.tipo),
  ],
);

// Documentos individuales del libro (cada factura/boleta/nc/nd)
export const libroSiiDocumentosTable = pgTable(
  "libro_sii_documentos",
  {
    id: serial("id").primaryKey(),
    importacionId: integer("importacion_id")
      .notNull()
      .references(() => libroSiiImportacionesTable.id, { onDelete: "cascade" }),
    scope: varchar("scope", { length: 64 }).notNull(),
    // Tipo de documento SII (33=Factura Electrónica, 39=Boleta, 61=NC, etc.)
    tipoDoc: integer("tipo_doc").notNull(),
    // Folio del documento
    folio: integer("folio").notNull(),
    // Fecha de emisión
    fechaEmision: date("fecha_emision").notNull(),
    // RUT del emisor o receptor según sea libro compras o ventas
    rutContraparte: varchar("rut_contraparte", { length: 12 }),
    razonSocial: text("razon_social"),
    // Montos
    montoNeto: numeric("monto_neto", { precision: 15, scale: 2 }).default("0"),
    montoExento: numeric("monto_exento", { precision: 15, scale: 2 }).default("0"),
    montoIva: numeric("monto_iva", { precision: 15, scale: 2 }).default("0"),
    montoTotal: numeric("monto_total", { precision: 15, scale: 2 }).default("0"),
    // IVA no recuperable (Art. 23 N°5 D.L. 825)
    ivaNoRecuperable: numeric("iva_no_recuperable", { precision: 15, scale: 2 }).default("0"),
    // IVA de uso común
    ivaUsoComun: numeric("iva_uso_comun", { precision: 15, scale: 2 }).default("0"),
    // Estado del documento
    estado: estadoDocSiiEnum("estado").notNull().default("vigente"),
    // Folio de referencia (si es NC/ND)
    folioReferencia: integer("folio_referencia"),
    tipoDocReferencia: integer("tipo_doc_referencia"),
    // XML original del SII (opcional, para auditoría)
    xmlSii: text("xml_sii"),
    // ¿Ya fue incorporado en un asiento contable?
    contabilizado: boolean("contabilizado").notNull().default(false),
    asientoId: integer("asiento_id"),
  },
  (t) => [
    index("libro_docs_importacion_idx").on(t.importacionId),
    index("libro_docs_scope_idx").on(t.scope),
    index("libro_docs_folio_idx").on(t.scope, t.tipoDoc, t.folio),
  ],
);

export const insertLibroSiiImportacionSchema = createInsertSchema(libroSiiImportacionesTable).omit({
  id: true,
  importadoEn: true,
});
export const insertLibroSiiDocumentoSchema = createInsertSchema(libroSiiDocumentosTable).omit({ id: true });

export type InsertLibroSiiImportacion = z.infer<typeof insertLibroSiiImportacionSchema>;
export type LibroSiiImportacion = typeof libroSiiImportacionesTable.$inferSelect;
export type InsertLibroSiiDocumento = z.infer<typeof insertLibroSiiDocumentoSchema>;
export type LibroSiiDocumento = typeof libroSiiDocumentosTable.$inferSelect;
