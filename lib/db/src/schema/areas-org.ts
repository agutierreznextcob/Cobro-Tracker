import { pgEnum, pgTable, serial, text, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tipo de área organizacional.
// - area: área funcional (Comercial, Operaciones, Marketing, etc.)
// - departamento: subdivisión dentro de un área
// - centro_costo: unidad de control presupuestario
export const tipoAreaEnum = pgEnum("tipo_area", ["area", "departamento", "centro_costo"]);

// Áreas, departamentos y centros de costo dentro de una organización.
// Los usuarios se asocian a un área a través de users.areaId.
// Las áreas son creadas y nombradas libremente por el admin de la org.
export const areasOrgTable = pgTable("areas_org", {
  id: serial("id").primaryKey(),
  // Organización a la que pertenece el área.
  organizationId: integer("organization_id").notNull(),
  // Nombre del área, libre: "Gerencia Comercial", "Operaciones", etc.
  nombre: text("nombre").notNull(),
  // Tipo de clasificación organizacional.
  tipo: tipoAreaEnum("tipo").notNull().default("area"),
  // Área padre para jerarquía de áreas (opcional).
  // Permite que un departamento pertenezca a un área, etc.
  parentAreaId: integer("parent_area_id"),
  // Usuario responsable del área (admin o gerente). No es FK estricta.
  responsableId: varchar("responsable_id"),
  // Descripción opcional del área.
  descripcion: text("descripcion"),
  activa: varchar("activa").notNull().default("true"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAreaOrgSchema = createInsertSchema(areasOrgTable).omit({
  id: true,
  creadoEn: true,
  actualizadoEn: true,
});

export type InsertAreaOrg = z.infer<typeof insertAreaOrgSchema>;
export type AreaOrg = typeof areasOrgTable.$inferSelect;
