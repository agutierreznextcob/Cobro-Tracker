/**
 * Módulo de Contabilidad
 * Rutas para: Plan de Cuentas, Asientos Contables, Informes, Presupuesto, Libro SII
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  planCuentasTable,
  asientosContablesTable,
  asientoLineasTable,
  presupuestosTable,
  presupuestoItemsTable,
  libroSiiImportacionesTable,
  libroSiiDocumentosTable,
  cobrosTable,
  comprasTable,
  type InsertPlanCuenta,
  type InsertAsiento,
  type InsertAsientoLinea,
  type InsertPresupuesto,
  type InsertPresupuestoItem,
  type InsertLibroSiiImportacion,
  type InsertLibroSiiDocumento,
} from "@workspace/db";
import { eq, and, asc, desc, sql, inArray, gte, lte, sum, like, isNull, ne } from "drizzle-orm";
import { requireSubscription } from "../middlewares/requireSubscription";
import { z } from "zod/v4";
import { getOrgContext } from "../lib/org";

export const contabilidadRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function getScope(userId: string, orgId: string | null) {
  return orgId ? `org:${orgId}` : `user:${userId}`;
}

async function requireAuth(req: any, res: any): Promise<{ userId: string; scope: string } | null> {
  const userId = (req.user as { id: string } | undefined)?.id;
  if (!userId) {
    res.status(401).json({ error: "No autenticado" });
    return null;
  }
  const ctx = await getOrgContext(userId);
  const scope = getScope(userId, ctx.organizationId ?? null);
  return { userId, scope };
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAN DE CUENTAS
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/contabilidad/plan-cuentas — lista completa del plan de cuentas */
contabilidadRouter.get("/contabilidad/plan-cuentas", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const cuentas = await db
    .select()
    .from(planCuentasTable)
    .where(eq(planCuentasTable.scope, auth.scope))
    .orderBy(asc(planCuentasTable.codigo));

  res.json(cuentas);
});

/** GET /api/contabilidad/plan-cuentas/hojas — solo cuentas de movimiento (esHoja=true) */
contabilidadRouter.get("/contabilidad/plan-cuentas/hojas", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const cuentas = await db
    .select()
    .from(planCuentasTable)
    .where(and(eq(planCuentasTable.scope, auth.scope), eq(planCuentasTable.esHoja, true), eq(planCuentasTable.activa, true)))
    .orderBy(asc(planCuentasTable.codigo));

  res.json(cuentas);
});

/** POST /api/contabilidad/plan-cuentas — crear cuenta */
contabilidadRouter.post("/contabilidad/plan-cuentas", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const schema = z.object({
    codigo: z.string().min(1).max(20),
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
    tipo: z.enum(["activo", "pasivo", "patrimonio", "ingreso", "egreso", "orden"]),
    naturaleza: z.enum(["deudora", "acreedora"]),
    nivel: z.number().int().min(1).max(5).default(1),
    padreId: z.number().int().optional(),
    esHoja: z.boolean().default(true),
    activa: z.boolean().default(true),
    codigoSii: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const data = parsed.data;

  // Verificar que el código no existe en el scope
  const existing = await db
    .select({ id: planCuentasTable.id })
    .from(planCuentasTable)
    .where(and(eq(planCuentasTable.scope, auth.scope), eq(planCuentasTable.codigo, data.codigo)))
    .limit(1);

  if (existing.length > 0) {
    return res.status(409).json({ error: "Ya existe una cuenta con ese código" });
  }

  // Si tiene padre, desmarcar esHoja del padre
  if (data.padreId) {
    await db
      .update(planCuentasTable)
      .set({ esHoja: false })
      .where(eq(planCuentasTable.id, data.padreId));
  }

  const insert: InsertPlanCuenta = { ...data, scope: auth.scope };
  const [cuenta] = await db.insert(planCuentasTable).values(insert).returning();

  res.status(201).json(cuenta);
});

/** POST /api/contabilidad/plan-cuentas/seed-estandar — carga plan de cuentas chileno estándar si está vacío */
contabilidadRouter.post("/contabilidad/plan-cuentas/seed-estandar", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // Solo seed si no hay cuentas
  const existing = await db
    .select({ id: planCuentasTable.id })
    .from(planCuentasTable)
    .where(eq(planCuentasTable.scope, auth.scope))
    .limit(1);

  if (existing.length > 0) {
    return res.json({ seeded: false, message: "El plan de cuentas ya tiene datos" });
  }

  // Plan de cuentas estándar chileno (PCGCh simplificado)
  const PLAN_ESTANDAR = [
    // ── ACTIVOS ──
    { codigo: "1", nombre: "ACTIVOS", tipo: "activo", naturaleza: "deudora", nivel: 1, esHoja: false, codigoSii: null },
    { codigo: "1.1", nombre: "Activos Corrientes", tipo: "activo", naturaleza: "deudora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "1.1.01", nombre: "Efectivo y Equivalentes", tipo: "activo", naturaleza: "deudora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "1.1.01.001", nombre: "Caja", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.1.01.002", nombre: "Banco cuenta corriente", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.1.02", nombre: "Cuentas por Cobrar", tipo: "activo", naturaleza: "deudora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "1.1.02.001", nombre: "Clientes nacionales", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.1.02.002", nombre: "Documentos por cobrar", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.1.03", nombre: "IVA", tipo: "activo", naturaleza: "deudora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "1.1.03.001", nombre: "IVA Crédito Fiscal", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.1.03.002", nombre: "Remanente IVA CF", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.1.04", nombre: "Existencias / Inventario", tipo: "activo", naturaleza: "deudora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "1.1.04.001", nombre: "Mercaderías", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.1.05", nombre: "Impuestos por Recuperar", tipo: "activo", naturaleza: "deudora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "1.1.05.001", nombre: "PPM por recuperar", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.2", nombre: "Activos No Corrientes", tipo: "activo", naturaleza: "deudora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "1.2.01", nombre: "Propiedad, Planta y Equipo", tipo: "activo", naturaleza: "deudora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "1.2.01.001", nombre: "Maquinaria y equipos", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.2.01.002", nombre: "Muebles y útiles", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.2.01.003", nombre: "Equipos computacionales", tipo: "activo", naturaleza: "deudora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "1.2.01.090", nombre: "Depreciación acumulada", tipo: "activo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    // ── PASIVOS ──
    { codigo: "2", nombre: "PASIVOS", tipo: "pasivo", naturaleza: "acreedora", nivel: 1, esHoja: false, codigoSii: null },
    { codigo: "2.1", nombre: "Pasivos Corrientes", tipo: "pasivo", naturaleza: "acreedora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "2.1.01", nombre: "Cuentas por Pagar", tipo: "pasivo", naturaleza: "acreedora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "2.1.01.001", nombre: "Proveedores nacionales", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "2.1.01.002", nombre: "Documentos por pagar", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "2.1.02", nombre: "IVA Débito Fiscal", tipo: "pasivo", naturaleza: "acreedora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "2.1.02.001", nombre: "IVA Débito Fiscal", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "2.1.03", nombre: "Retenciones y Sueldos", tipo: "pasivo", naturaleza: "acreedora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "2.1.03.001", nombre: "Sueldos por pagar", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "2.1.03.002", nombre: "AFP por pagar", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "2.1.03.003", nombre: "Isapre/Fonasa por pagar", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "2.1.04", nombre: "Obligaciones Financieras CP", tipo: "pasivo", naturaleza: "acreedora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "2.1.04.001", nombre: "Préstamos bancarios CP", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    { codigo: "2.2", nombre: "Pasivos No Corrientes", tipo: "pasivo", naturaleza: "acreedora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "2.2.01", nombre: "Obligaciones Financieras LP", tipo: "pasivo", naturaleza: "acreedora", nivel: 3, esHoja: false, codigoSii: null },
    { codigo: "2.2.01.001", nombre: "Préstamos bancarios LP", tipo: "pasivo", naturaleza: "acreedora", nivel: 4, esHoja: true, codigoSii: null },
    // ── PATRIMONIO ──
    { codigo: "3", nombre: "PATRIMONIO", tipo: "patrimonio", naturaleza: "acreedora", nivel: 1, esHoja: false, codigoSii: null },
    { codigo: "3.1", nombre: "Capital", tipo: "patrimonio", naturaleza: "acreedora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "3.1.01", nombre: "Capital aportado", tipo: "patrimonio", naturaleza: "acreedora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "3.2", nombre: "Resultados", tipo: "patrimonio", naturaleza: "acreedora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "3.2.01", nombre: "Utilidades acumuladas", tipo: "patrimonio", naturaleza: "acreedora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "3.2.02", nombre: "Resultado del ejercicio", tipo: "patrimonio", naturaleza: "acreedora", nivel: 3, esHoja: true, codigoSii: null },
    // ── INGRESOS ──
    { codigo: "4", nombre: "INGRESOS", tipo: "ingreso", naturaleza: "acreedora", nivel: 1, esHoja: false, codigoSii: null },
    { codigo: "4.1", nombre: "Ingresos de Explotación", tipo: "ingreso", naturaleza: "acreedora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "4.1.01", nombre: "Ventas de productos", tipo: "ingreso", naturaleza: "acreedora", nivel: 3, esHoja: true, codigoSii: "91" },
    { codigo: "4.1.02", nombre: "Prestación de servicios", tipo: "ingreso", naturaleza: "acreedora", nivel: 3, esHoja: true, codigoSii: "91" },
    { codigo: "4.2", nombre: "Otros Ingresos", tipo: "ingreso", naturaleza: "acreedora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "4.2.01", nombre: "Ingresos financieros", tipo: "ingreso", naturaleza: "acreedora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "4.2.02", nombre: "Otros ingresos fuera de explotación", tipo: "ingreso", naturaleza: "acreedora", nivel: 3, esHoja: true, codigoSii: null },
    // ── EGRESOS ──
    { codigo: "5", nombre: "EGRESOS", tipo: "egreso", naturaleza: "deudora", nivel: 1, esHoja: false, codigoSii: null },
    { codigo: "5.1", nombre: "Costo de Ventas", tipo: "egreso", naturaleza: "deudora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "5.1.01", nombre: "Costo de ventas de mercaderías", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.1.02", nombre: "Costo de servicios prestados", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2", nombre: "Gastos de Administración y Ventas", tipo: "egreso", naturaleza: "deudora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "5.2.01", nombre: "Remuneraciones y honorarios", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.02", nombre: "Arriendos", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.03", nombre: "Servicios básicos", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.04", nombre: "Materiales y suministros", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.05", nombre: "Gastos de representación", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.06", nombre: "Publicidad y marketing", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.07", nombre: "Depreciación del ejercicio", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.08", nombre: "Seguros", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.2.09", nombre: "Mantención y reparaciones", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.3", nombre: "Gastos Financieros", tipo: "egreso", naturaleza: "deudora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "5.3.01", nombre: "Intereses bancarios", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.3.02", nombre: "Comisiones bancarias", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.4", nombre: "Gastos Tributarios", tipo: "egreso", naturaleza: "deudora", nivel: 2, esHoja: false, codigoSii: null },
    { codigo: "5.4.01", nombre: "Impuesto de primera categoría", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.4.02", nombre: "PPM mensual", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
    { codigo: "5.4.03", nombre: "Otros impuestos", tipo: "egreso", naturaleza: "deudora", nivel: 3, esHoja: true, codigoSii: null },
  ] as const;

  // Insertar en bloque
  const toInsert = PLAN_ESTANDAR.map((c) => ({
    scope: auth.scope,
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo as InsertPlanCuenta["tipo"],
    naturaleza: c.naturaleza as InsertPlanCuenta["naturaleza"],
    nivel: c.nivel,
    padreId: null as number | null,
    esHoja: c.esHoja,
    activa: true,
    esEstandar: true,
    codigoSii: c.codigoSii,
  }));

  // Insertar todas las cuentas primero sin padre
  const inserted = await db.insert(planCuentasTable).values(toInsert).returning();

  // Ahora actualizar padreId en base a código padre
  const codeToId = Object.fromEntries(inserted.map((c) => [c.codigo, c.id]));
  for (const c of inserted) {
    const parts = c.codigo.split(".");
    if (parts.length > 1) {
      const parentCode = parts.slice(0, -1).join(".");
      const parentId = codeToId[parentCode];
      if (parentId) {
        await db.update(planCuentasTable).set({ padreId: parentId }).where(eq(planCuentasTable.id, c.id));
      }
    }
  }

  res.json({ seeded: true, count: inserted.length });
});

/** PUT /api/contabilidad/plan-cuentas/:id — actualizar cuenta */
contabilidadRouter.put("/contabilidad/plan-cuentas/:id", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const cuenta = await db
    .select()
    .from(planCuentasTable)
    .where(and(eq(planCuentasTable.id, id), eq(planCuentasTable.scope, auth.scope)))
    .limit(1);

  if (cuenta.length === 0) return res.status(404).json({ error: "Cuenta no encontrada" });

  const schema = z.object({
    nombre: z.string().min(1).optional(),
    descripcion: z.string().optional(),
    activa: z.boolean().optional(),
    codigoSii: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const [updated] = await db
    .update(planCuentasTable)
    .set(parsed.data)
    .where(and(eq(planCuentasTable.id, id), eq(planCuentasTable.scope, auth.scope)))
    .returning();

  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════
// ASIENTOS CONTABLES
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/contabilidad/asientos — lista asientos con filtros */
contabilidadRouter.get("/contabilidad/asientos", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { periodo, estado, origen, fechaDesde, fechaHasta, page = "1", limit = "50" } = req.query as Record<string, string>;

  const conditions = [eq(asientosContablesTable.scope, auth.scope)];
  if (periodo) conditions.push(eq(asientosContablesTable.periodo, periodo));
  if (estado) conditions.push(eq(asientosContablesTable.estado, estado as any));
  if (origen) conditions.push(eq(asientosContablesTable.origen, origen as any));
  if (fechaDesde) conditions.push(gte(asientosContablesTable.fecha, fechaDesde));
  if (fechaHasta) conditions.push(lte(asientosContablesTable.fecha, fechaHasta));

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const asientos = await db
    .select()
    .from(asientosContablesTable)
    .where(and(...conditions))
    .orderBy(desc(asientosContablesTable.fecha), desc(asientosContablesTable.numero))
    .limit(parseInt(limit))
    .offset(offset);

  res.json(asientos);
});

/** GET /api/contabilidad/asientos/:id — asiento con líneas */
contabilidadRouter.get("/contabilidad/asientos/:id", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [asiento] = await db
    .select()
    .from(asientosContablesTable)
    .where(and(eq(asientosContablesTable.id, id), eq(asientosContablesTable.scope, auth.scope)))
    .limit(1);

  if (!asiento) return res.status(404).json({ error: "Asiento no encontrado" });

  const lineas = await db
    .select()
    .from(asientoLineasTable)
    .where(eq(asientoLineasTable.asientoId, id))
    .orderBy(asc(asientoLineasTable.orden));

  res.json({ ...asiento, lineas });
});

/** POST /api/contabilidad/asientos — crear asiento con líneas */
contabilidadRouter.post("/contabilidad/asientos", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const lineaSchema = z.object({
    cuentaId: z.number().int(),
    cuentaCodigo: z.string(),
    cuentaNombre: z.string(),
    debe: z.string().default("0"),
    haber: z.string().default("0"),
    descripcion: z.string().optional(),
    areaId: z.number().int().optional(),
    orden: z.number().int().default(0),
  });

  const schema = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodo: z.string().regex(/^\d{6}$/),
    descripcion: z.string().min(1),
    origen: z.enum(["manual", "cobro", "compra", "pago_parcial", "nota_credito", "nota_debito", "depreciacion", "ajuste", "apertura", "cierre", "sii_importacion"]).default("manual"),
    origenId: z.number().int().optional(),
    moneda: z.string().length(3).default("CLP"),
    tipoCambio: z.string().default("1"),
    notas: z.string().optional(),
    lineas: z.array(lineaSchema).min(2),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const { lineas, ...asientoData } = parsed.data;

  // Validar que debe = haber
  const totalDebe = lineas.reduce((s, l) => s + parseFloat(l.debe), 0);
  const totalHaber = lineas.reduce((s, l) => s + parseFloat(l.haber), 0);
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    return res.status(400).json({ error: `El asiento no cuadra: debe=${totalDebe}, haber=${totalHaber}` });
  }

  // Generar número correlativo
  const anio = asientoData.periodo.substring(0, 4);
  const count = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(asientosContablesTable)
    .where(and(eq(asientosContablesTable.scope, auth.scope), like(asientosContablesTable.numero, `${anio}-%`)));

  const nextNum = (count[0]?.cnt ?? 0) + 1;
  const numero = `${anio}-${String(nextNum).padStart(4, "0")}`;

  const insert: InsertAsiento = {
    ...asientoData,
    scope: auth.scope,
    numero,
    usuarioId: auth.userId,
    estado: "borrador",
  };

  const [asiento] = await db.insert(asientosContablesTable).values(insert).returning();

  const lineasInsert: InsertAsientoLinea[] = lineas.map((l, i) => ({
    ...l,
    asientoId: asiento.id,
    orden: l.orden ?? i,
  }));

  await db.insert(asientoLineasTable).values(lineasInsert);

  const lineasCreadas = await db
    .select()
    .from(asientoLineasTable)
    .where(eq(asientoLineasTable.asientoId, asiento.id))
    .orderBy(asc(asientoLineasTable.orden));

  res.status(201).json({ ...asiento, lineas: lineasCreadas });
});

/** POST /api/contabilidad/asientos/:id/contabilizar — validar y contabilizar asiento */
contabilidadRouter.post("/contabilidad/asientos/:id/contabilizar", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [asiento] = await db
    .select()
    .from(asientosContablesTable)
    .where(and(eq(asientosContablesTable.id, id), eq(asientosContablesTable.scope, auth.scope)))
    .limit(1);

  if (!asiento) return res.status(404).json({ error: "Asiento no encontrado" });
  if (asiento.estado !== "borrador") return res.status(400).json({ error: "Solo se pueden contabilizar asientos en estado borrador" });

  const lineas = await db.select().from(asientoLineasTable).where(eq(asientoLineasTable.asientoId, id));

  if (lineas.length < 2) return res.status(400).json({ error: "El asiento debe tener al menos 2 líneas" });

  const totalDebe = lineas.reduce((s, l) => s + parseFloat(l.debe ?? "0"), 0);
  const totalHaber = lineas.reduce((s, l) => s + parseFloat(l.haber ?? "0"), 0);

  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    return res.status(400).json({ error: `El asiento no cuadra: debe=${totalDebe}, haber=${totalHaber}` });
  }

  const [updated] = await db
    .update(asientosContablesTable)
    .set({ estado: "contabilizado" })
    .where(eq(asientosContablesTable.id, id))
    .returning();

  res.json(updated);
});

/** POST /api/contabilidad/asientos/:id/anular — anular asiento contabilizado */
contabilidadRouter.post("/contabilidad/asientos/:id/anular", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [asiento] = await db
    .select()
    .from(asientosContablesTable)
    .where(and(eq(asientosContablesTable.id, id), eq(asientosContablesTable.scope, auth.scope)))
    .limit(1);

  if (!asiento) return res.status(404).json({ error: "Asiento no encontrado" });
  if (asiento.estado === "anulado") return res.status(400).json({ error: "El asiento ya está anulado" });

  const [updated] = await db
    .update(asientosContablesTable)
    .set({ estado: "anulado" })
    .where(eq(asientosContablesTable.id, id))
    .returning();

  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════
// INFORMES CONTABLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/contabilidad/informes/balance-8col
 * Balance de 8 columnas: saldo anterior + movimientos + saldo final + estado resultado
 * Query params: periodoDesde, periodoHasta, moneda
 */
contabilidadRouter.get("/contabilidad/informes/balance-8col", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { periodoDesde, periodoHasta } = req.query as Record<string, string>;
  if (!periodoDesde || !periodoHasta) {
    return res.status(400).json({ error: "Se requieren periodoDesde y periodoHasta (AAAAMM)" });
  }

  // Obtener todas las cuentas del plan
  const cuentas = await db
    .select()
    .from(planCuentasTable)
    .where(and(eq(planCuentasTable.scope, auth.scope), eq(planCuentasTable.esHoja, true), eq(planCuentasTable.activa, true)))
    .orderBy(asc(planCuentasTable.codigo));

  if (cuentas.length === 0) return res.json([]);

  const cuentaIds = cuentas.map((c) => c.id);

  // Movimientos período anterior (saldo inicial acumulado hasta periodoDesde - 1)
  const anteriorRows = await db
    .select({
      cuentaId: asientoLineasTable.cuentaId,
      sumaDebe: sum(asientoLineasTable.debe).mapWith(Number),
      sumaHaber: sum(asientoLineasTable.haber).mapWith(Number),
    })
    .from(asientoLineasTable)
    .innerJoin(asientosContablesTable, eq(asientoLineasTable.asientoId, asientosContablesTable.id))
    .where(
      and(
        eq(asientosContablesTable.scope, auth.scope),
        eq(asientosContablesTable.estado, "contabilizado"),
        lte(asientosContablesTable.periodo, (parseInt(periodoDesde) - 1).toString()),
        inArray(asientoLineasTable.cuentaId, cuentaIds),
      ),
    )
    .groupBy(asientoLineasTable.cuentaId);

  // Movimientos del período
  const periodoRows = await db
    .select({
      cuentaId: asientoLineasTable.cuentaId,
      sumaDebe: sum(asientoLineasTable.debe).mapWith(Number),
      sumaHaber: sum(asientoLineasTable.haber).mapWith(Number),
    })
    .from(asientoLineasTable)
    .innerJoin(asientosContablesTable, eq(asientoLineasTable.asientoId, asientosContablesTable.id))
    .where(
      and(
        eq(asientosContablesTable.scope, auth.scope),
        eq(asientosContablesTable.estado, "contabilizado"),
        gte(asientosContablesTable.periodo, periodoDesde),
        lte(asientosContablesTable.periodo, periodoHasta),
        inArray(asientoLineasTable.cuentaId, cuentaIds),
      ),
    )
    .groupBy(asientoLineasTable.cuentaId);

  const anteriorMap = Object.fromEntries(anteriorRows.map((r) => [r.cuentaId, r]));
  const periodoMap = Object.fromEntries(periodoRows.map((r) => [r.cuentaId, r]));

  const resultado = cuentas.map((c) => {
    const ant = anteriorMap[c.id] ?? { sumaDebe: 0, sumaHaber: 0 };
    const per = periodoMap[c.id] ?? { sumaDebe: 0, sumaHaber: 0 };

    // Saldo inicial
    const saldoAntDebe = c.naturaleza === "deudora" ? Math.max(0, (ant.sumaDebe ?? 0) - (ant.sumaHaber ?? 0)) : 0;
    const saldoAntHaber = c.naturaleza === "acreedora" ? Math.max(0, (ant.sumaHaber ?? 0) - (ant.sumaDebe ?? 0)) : 0;

    // Movimientos período
    const movDebe = per.sumaDebe ?? 0;
    const movHaber = per.sumaHaber ?? 0;

    // Saldo final
    const totalDebe = saldoAntDebe + movDebe;
    const totalHaber = saldoAntHaber + movHaber;
    const saldoFinalDebe = c.naturaleza === "deudora" ? Math.max(0, totalDebe - totalHaber) : 0;
    const saldoFinalHaber = c.naturaleza === "acreedora" ? Math.max(0, totalHaber - totalDebe) : 0;

    return {
      cuentaId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      naturaleza: c.naturaleza,
      nivel: c.nivel,
      saldoAntDebe,
      saldoAntHaber,
      movDebe,
      movHaber,
      saldoFinalDebe,
      saldoFinalHaber,
    };
  });

  res.json(resultado);
});

/**
 * GET /api/contabilidad/informes/estado-resultado
 * Estado de resultados: ingresos y egresos del período
 */
contabilidadRouter.get("/contabilidad/informes/estado-resultado", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { periodoDesde, periodoHasta } = req.query as Record<string, string>;
  if (!periodoDesde || !periodoHasta) {
    return res.status(400).json({ error: "Se requieren periodoDesde y periodoHasta (AAAAMM)" });
  }

  const rows = await db
    .select({
      cuentaId: asientoLineasTable.cuentaId,
      cuentaCodigo: asientoLineasTable.cuentaCodigo,
      cuentaNombre: asientoLineasTable.cuentaNombre,
      sumaDebe: sum(asientoLineasTable.debe).mapWith(Number),
      sumaHaber: sum(asientoLineasTable.haber).mapWith(Number),
    })
    .from(asientoLineasTable)
    .innerJoin(asientosContablesTable, eq(asientoLineasTable.asientoId, asientosContablesTable.id))
    .innerJoin(planCuentasTable, eq(asientoLineasTable.cuentaId, planCuentasTable.id))
    .where(
      and(
        eq(asientosContablesTable.scope, auth.scope),
        eq(asientosContablesTable.estado, "contabilizado"),
        gte(asientosContablesTable.periodo, periodoDesde),
        lte(asientosContablesTable.periodo, periodoHasta),
        inArray(planCuentasTable.tipo, ["ingreso", "egreso"]),
      ),
    )
    .groupBy(asientoLineasTable.cuentaId, asientoLineasTable.cuentaCodigo, asientoLineasTable.cuentaNombre);

  // Enriquecer con tipo desde plan de cuentas
  const cuentaIds = [...new Set(rows.map((r) => r.cuentaId))];
  const cuentas = cuentaIds.length > 0
    ? await db.select().from(planCuentasTable).where(inArray(planCuentasTable.id, cuentaIds))
    : [];

  const cuentaMap = Object.fromEntries(cuentas.map((c) => [c.id, c]));

  const resultado = rows.map((r) => {
    const c = cuentaMap[r.cuentaId];
    const neto = c?.naturaleza === "acreedora"
      ? (r.sumaHaber ?? 0) - (r.sumaDebe ?? 0)
      : (r.sumaDebe ?? 0) - (r.sumaHaber ?? 0);

    return {
      cuentaId: r.cuentaId,
      codigo: r.cuentaCodigo,
      nombre: r.cuentaNombre,
      tipo: c?.tipo,
      neto,
    };
  });

  const totalIngresos = resultado.filter((r) => r.tipo === "ingreso").reduce((s, r) => s + r.neto, 0);
  const totalEgresos = resultado.filter((r) => r.tipo === "egreso").reduce((s, r) => s + r.neto, 0);

  res.json({
    lineas: resultado,
    totalIngresos,
    totalEgresos,
    utilidadNeta: totalIngresos - totalEgresos,
  });
});

/**
 * GET /api/contabilidad/informes/libro-diario
 * Libro diario: todos los asientos con sus líneas, ordenados por fecha
 */
contabilidadRouter.get("/contabilidad/informes/libro-diario", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { periodoDesde, periodoHasta, page = "1", limit = "50" } = req.query as Record<string, string>;
  if (!periodoDesde || !periodoHasta) {
    return res.status(400).json({ error: "Se requieren periodoDesde y periodoHasta" });
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const asientos = await db
    .select()
    .from(asientosContablesTable)
    .where(
      and(
        eq(asientosContablesTable.scope, auth.scope),
        eq(asientosContablesTable.estado, "contabilizado"),
        gte(asientosContablesTable.periodo, periodoDesde),
        lte(asientosContablesTable.periodo, periodoHasta),
      ),
    )
    .orderBy(asc(asientosContablesTable.fecha), asc(asientosContablesTable.numero))
    .limit(parseInt(limit))
    .offset(offset);

  if (asientos.length === 0) return res.json([]);

  const asientoIds = asientos.map((a) => a.id);
  const todasLineas = await db
    .select()
    .from(asientoLineasTable)
    .where(inArray(asientoLineasTable.asientoId, asientoIds))
    .orderBy(asc(asientoLineasTable.asientoId), asc(asientoLineasTable.orden));

  const lineasPorAsiento = todasLineas.reduce((acc, l) => {
    if (!acc[l.asientoId]) acc[l.asientoId] = [];
    acc[l.asientoId].push(l);
    return acc;
  }, {} as Record<number, typeof todasLineas>);

  const resultado = asientos.map((a) => ({
    ...a,
    lineas: lineasPorAsiento[a.id] ?? [],
  }));

  res.json(resultado);
});

/**
 * GET /api/contabilidad/informes/libro-mayor
 * Libro mayor: movimientos de una cuenta específica por período
 */
contabilidadRouter.get("/contabilidad/informes/libro-mayor", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { cuentaId, periodoDesde, periodoHasta } = req.query as Record<string, string>;
  if (!cuentaId || !periodoDesde || !periodoHasta) {
    return res.status(400).json({ error: "Se requieren cuentaId, periodoDesde y periodoHasta" });
  }

  const cuentaIdNum = parseInt(cuentaId);
  if (isNaN(cuentaIdNum)) return res.status(400).json({ error: "cuentaId inválido" });

  const [cuenta] = await db
    .select()
    .from(planCuentasTable)
    .where(and(eq(planCuentasTable.id, cuentaIdNum), eq(planCuentasTable.scope, auth.scope)))
    .limit(1);

  if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });

  // Saldo anterior
  const anteriorRows = await db
    .select({
      sumaDebe: sum(asientoLineasTable.debe).mapWith(Number),
      sumaHaber: sum(asientoLineasTable.haber).mapWith(Number),
    })
    .from(asientoLineasTable)
    .innerJoin(asientosContablesTable, eq(asientoLineasTable.asientoId, asientosContablesTable.id))
    .where(
      and(
        eq(asientosContablesTable.scope, auth.scope),
        eq(asientosContablesTable.estado, "contabilizado"),
        lte(asientosContablesTable.periodo, (parseInt(periodoDesde) - 1).toString()),
        eq(asientoLineasTable.cuentaId, cuentaIdNum),
      ),
    );

  const ant = anteriorRows[0] ?? { sumaDebe: 0, sumaHaber: 0 };
  let saldoAcumulado = cuenta.naturaleza === "deudora"
    ? (ant.sumaDebe ?? 0) - (ant.sumaHaber ?? 0)
    : (ant.sumaHaber ?? 0) - (ant.sumaDebe ?? 0);

  // Movimientos del período
  const lineas = await db
    .select({
      lineaId: asientoLineasTable.id,
      fecha: asientosContablesTable.fecha,
      numero: asientosContablesTable.numero,
      descripcionAsiento: asientosContablesTable.descripcion,
      descripcionLinea: asientoLineasTable.descripcion,
      debe: asientoLineasTable.debe,
      haber: asientoLineasTable.haber,
    })
    .from(asientoLineasTable)
    .innerJoin(asientosContablesTable, eq(asientoLineasTable.asientoId, asientosContablesTable.id))
    .where(
      and(
        eq(asientosContablesTable.scope, auth.scope),
        eq(asientosContablesTable.estado, "contabilizado"),
        gte(asientosContablesTable.periodo, periodoDesde),
        lte(asientosContablesTable.periodo, periodoHasta),
        eq(asientoLineasTable.cuentaId, cuentaIdNum),
      ),
    )
    .orderBy(asc(asientosContablesTable.fecha), asc(asientosContablesTable.numero));

  // Calcular saldo acumulado por línea
  const lineasConSaldo = lineas.map((l) => {
    const debe = parseFloat(l.debe ?? "0");
    const haber = parseFloat(l.haber ?? "0");

    if (cuenta.naturaleza === "deudora") {
      saldoAcumulado += debe - haber;
    } else {
      saldoAcumulado += haber - debe;
    }

    return { ...l, saldo: saldoAcumulado };
  });

  res.json({
    cuenta,
    saldoAnterior: cuenta.naturaleza === "deudora"
      ? (ant.sumaDebe ?? 0) - (ant.sumaHaber ?? 0)
      : (ant.sumaHaber ?? 0) - (ant.sumaDebe ?? 0),
    movimientos: lineasConSaldo,
  });
});

/**
 * GET /api/contabilidad/informes/balance-comparativo
 * Compara saldos por área, departamento o períodos
 */
contabilidadRouter.get("/contabilidad/informes/balance-comparativo", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { periodos, tipo = "tipo" } = req.query as Record<string, string>;
  if (!periodos) return res.status(400).json({ error: "Se requiere el parámetro periodos (ej: 202401,202402)" });

  const periodosArr = periodos.split(",").map((p) => p.trim()).filter((p) => /^\d{6}$/.test(p));
  if (periodosArr.length === 0) return res.status(400).json({ error: "Periodos inválidos" });

  const rows = await db
    .select({
      periodo: asientosContablesTable.periodo,
      cuentaId: asientoLineasTable.cuentaId,
      cuentaCodigo: asientoLineasTable.cuentaCodigo,
      cuentaNombre: asientoLineasTable.cuentaNombre,
      areaId: asientoLineasTable.areaId,
      sumaDebe: sum(asientoLineasTable.debe).mapWith(Number),
      sumaHaber: sum(asientoLineasTable.haber).mapWith(Number),
    })
    .from(asientoLineasTable)
    .innerJoin(asientosContablesTable, eq(asientoLineasTable.asientoId, asientosContablesTable.id))
    .innerJoin(planCuentasTable, eq(asientoLineasTable.cuentaId, planCuentasTable.id))
    .where(
      and(
        eq(asientosContablesTable.scope, auth.scope),
        eq(asientosContablesTable.estado, "contabilizado"),
        inArray(asientosContablesTable.periodo, periodosArr),
      ),
    )
    .groupBy(
      asientosContablesTable.periodo,
      asientoLineasTable.cuentaId,
      asientoLineasTable.cuentaCodigo,
      asientoLineasTable.cuentaNombre,
      asientoLineasTable.areaId,
    )
    .orderBy(asc(asientoLineasTable.cuentaCodigo), asc(asientosContablesTable.periodo));

  res.json({ periodos: periodosArr, movimientos: rows });
});

/**
 * GET /api/contabilidad/informes/calculo-iva
 * Cálculo de IVA para F29/F22/F50 basado en libro SII
 */
contabilidadRouter.get("/contabilidad/informes/calculo-iva", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { periodo } = req.query as Record<string, string>;
  if (!periodo) return res.status(400).json({ error: "Se requiere el parámetro periodo (AAAAMM)" });

  // Totales de compras (IVA crédito)
  const comprasRows = await db
    .select({
      totalNeto: sum(libroSiiDocumentosTable.montoNeto).mapWith(Number),
      totalIva: sum(libroSiiDocumentosTable.montoIva).mapWith(Number),
      totalExento: sum(libroSiiDocumentosTable.montoExento).mapWith(Number),
      totalBruto: sum(libroSiiDocumentosTable.montoTotal).mapWith(Number),
      ivaNoRecuperable: sum(libroSiiDocumentosTable.ivaNoRecuperable).mapWith(Number),
    })
    .from(libroSiiDocumentosTable)
    .innerJoin(libroSiiImportacionesTable, eq(libroSiiDocumentosTable.importacionId, libroSiiImportacionesTable.id))
    .where(
      and(
        eq(libroSiiImportacionesTable.scope, auth.scope),
        eq(libroSiiImportacionesTable.periodo, periodo),
        eq(libroSiiImportacionesTable.tipo, "compras"),
        eq(libroSiiDocumentosTable.estado, "vigente"),
      ),
    );

  // Totales de ventas (IVA débito)
  const ventasRows = await db
    .select({
      totalNeto: sum(libroSiiDocumentosTable.montoNeto).mapWith(Number),
      totalIva: sum(libroSiiDocumentosTable.montoIva).mapWith(Number),
      totalExento: sum(libroSiiDocumentosTable.montoExento).mapWith(Number),
      totalBruto: sum(libroSiiDocumentosTable.montoTotal).mapWith(Number),
    })
    .from(libroSiiDocumentosTable)
    .innerJoin(libroSiiImportacionesTable, eq(libroSiiDocumentosTable.importacionId, libroSiiImportacionesTable.id))
    .where(
      and(
        eq(libroSiiImportacionesTable.scope, auth.scope),
        eq(libroSiiImportacionesTable.periodo, periodo),
        eq(libroSiiImportacionesTable.tipo, "ventas"),
        eq(libroSiiDocumentosTable.estado, "vigente"),
      ),
    );

  const compras = comprasRows[0] ?? { totalNeto: 0, totalIva: 0, totalExento: 0, totalBruto: 0, ivaNoRecuperable: 0 };
  const ventas = ventasRows[0] ?? { totalNeto: 0, totalIva: 0, totalExento: 0, totalBruto: 0 };

  const ivaDebito = ventas.totalIva ?? 0;
  const ivaCredito = (compras.totalIva ?? 0) - (compras.ivaNoRecuperable ?? 0);
  const ivaDeterminar = ivaDebito - ivaCredito;

  res.json({
    periodo,
    // F29 — IVA mensual
    f29: {
      ventasNetas: ventas.totalNeto ?? 0,
      ventasExentas: ventas.totalExento ?? 0,
      ivaDebito,
      comprasNetas: compras.totalNeto ?? 0,
      ivaCredito,
      ivaNoRecuperable: compras.ivaNoRecuperable ?? 0,
      ivaDeterminar,
      situacion: ivaDeterminar > 0 ? "pago" : ivaDeterminar < 0 ? "remanente" : "cero",
    },
    resumen: {
      totalVentasBruto: ventas.totalBruto ?? 0,
      totalComprasBruto: compras.totalBruto ?? 0,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PRESUPUESTO
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/contabilidad/presupuestos */
contabilidadRouter.get("/contabilidad/presupuestos", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const presupuestos = await db
    .select()
    .from(presupuestosTable)
    .where(eq(presupuestosTable.scope, auth.scope))
    .orderBy(desc(presupuestosTable.anio));

  res.json(presupuestos);
});

/** GET /api/contabilidad/presupuestos/:id — presupuesto con ítems */
contabilidadRouter.get("/contabilidad/presupuestos/:id", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [pres] = await db
    .select()
    .from(presupuestosTable)
    .where(and(eq(presupuestosTable.id, id), eq(presupuestosTable.scope, auth.scope)))
    .limit(1);

  if (!pres) return res.status(404).json({ error: "Presupuesto no encontrado" });

  const items = await db
    .select()
    .from(presupuestoItemsTable)
    .where(eq(presupuestoItemsTable.presupuestoId, id))
    .orderBy(asc(presupuestoItemsTable.cuentaCodigo), asc(presupuestoItemsTable.mes));

  res.json({ ...pres, items });
});

/** POST /api/contabilidad/presupuestos */
contabilidadRouter.post("/contabilidad/presupuestos", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const schema = z.object({
    anio: z.number().int().min(2000).max(2100),
    nombre: z.string().min(1),
    notas: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const insert: InsertPresupuesto = {
    ...parsed.data,
    scope: auth.scope,
    usuarioId: auth.userId,
    estado: "borrador",
  };

  const [pres] = await db.insert(presupuestosTable).values(insert).returning();
  res.status(201).json(pres);
});

/** PUT /api/contabilidad/presupuestos/:id/items — guardar/actualizar ítems del presupuesto (upsert masivo) */
contabilidadRouter.put("/contabilidad/presupuestos/:id/items", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [pres] = await db
    .select()
    .from(presupuestosTable)
    .where(and(eq(presupuestosTable.id, id), eq(presupuestosTable.scope, auth.scope)))
    .limit(1);

  if (!pres) return res.status(404).json({ error: "Presupuesto no encontrado" });
  if (pres.estado === "cerrado") return res.status(400).json({ error: "El presupuesto está cerrado" });

  const itemSchema = z.object({
    cuentaId: z.number().int(),
    cuentaCodigo: z.string(),
    cuentaNombre: z.string(),
    mes: z.number().int().min(1).max(12),
    montoPres: z.string().default("0"),
    areaId: z.number().int().optional().nullable(),
    notas: z.string().optional(),
  });

  const parsed = z.array(itemSchema).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  // Eliminar ítems existentes y reinsertar
  await db.delete(presupuestoItemsTable).where(eq(presupuestoItemsTable.presupuestoId, id));

  if (parsed.data.length > 0) {
    const items: InsertPresupuestoItem[] = parsed.data.map((item) => ({
      ...item,
      presupuestoId: id,
    }));
    await db.insert(presupuestoItemsTable).values(items);
  }

  const itemsActualizados = await db
    .select()
    .from(presupuestoItemsTable)
    .where(eq(presupuestoItemsTable.presupuestoId, id))
    .orderBy(asc(presupuestoItemsTable.cuentaCodigo), asc(presupuestoItemsTable.mes));

  res.json(itemsActualizados);
});

/** POST /api/contabilidad/presupuestos/:id/aprobar */
contabilidadRouter.post("/contabilidad/presupuestos/:id/aprobar", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [updated] = await db
    .update(presupuestosTable)
    .set({ estado: "aprobado" })
    .where(and(eq(presupuestosTable.id, id), eq(presupuestosTable.scope, auth.scope)))
    .returning();

  if (!updated) return res.status(404).json({ error: "Presupuesto no encontrado" });
  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════
// LIBRO SII (IMPORTACIÓN COMPRA/VENTA)
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/contabilidad/libro-sii — lista de importaciones */
contabilidadRouter.get("/contabilidad/libro-sii", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { tipo, periodo } = req.query as Record<string, string>;

  const conditions = [eq(libroSiiImportacionesTable.scope, auth.scope)];
  if (tipo) conditions.push(eq(libroSiiImportacionesTable.tipo, tipo as any));
  if (periodo) conditions.push(eq(libroSiiImportacionesTable.periodo, periodo));

  const importaciones = await db
    .select()
    .from(libroSiiImportacionesTable)
    .where(and(...conditions))
    .orderBy(desc(libroSiiImportacionesTable.periodo), desc(libroSiiImportacionesTable.importadoEn));

  res.json(importaciones);
});

/** GET /api/contabilidad/libro-sii/:id/documentos — documentos de una importación */
contabilidadRouter.get("/contabilidad/libro-sii/:id/documentos", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [imp] = await db
    .select()
    .from(libroSiiImportacionesTable)
    .where(and(eq(libroSiiImportacionesTable.id, id), eq(libroSiiImportacionesTable.scope, auth.scope)))
    .limit(1);

  if (!imp) return res.status(404).json({ error: "Importación no encontrada" });

  const documentos = await db
    .select()
    .from(libroSiiDocumentosTable)
    .where(eq(libroSiiDocumentosTable.importacionId, id))
    .orderBy(asc(libroSiiDocumentosTable.fechaEmision), asc(libroSiiDocumentosTable.folio));

  res.json({ importacion: imp, documentos });
});

/** POST /api/contabilidad/libro-sii — importar libro manualmente */
contabilidadRouter.post("/contabilidad/libro-sii", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const docSchema = z.object({
    tipoDoc: z.number().int(),
    folio: z.number().int(),
    fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rutContraparte: z.string().optional(),
    razonSocial: z.string().optional(),
    montoNeto: z.string().default("0"),
    montoExento: z.string().default("0"),
    montoIva: z.string().default("0"),
    montoTotal: z.string().default("0"),
    ivaNoRecuperable: z.string().default("0"),
    ivaUsoComun: z.string().default("0"),
    estado: z.enum(["vigente", "anulado", "no_incluir", "pendiente_sii"]).default("vigente"),
    folioReferencia: z.number().int().optional(),
    tipoDocReferencia: z.number().int().optional(),
  });

  const schema = z.object({
    periodo: z.string().regex(/^\d{6}$/),
    tipo: z.enum(["compras", "ventas", "boletas"]),
    notas: z.string().optional(),
    documentos: z.array(docSchema).min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const { documentos, ...impData } = parsed.data;

  // Calcular totales
  const totalNeto = documentos.reduce((s, d) => s + parseFloat(d.montoNeto), 0).toFixed(2);
  const totalIva = documentos.reduce((s, d) => s + parseFloat(d.montoIva), 0).toFixed(2);
  const totalExento = documentos.reduce((s, d) => s + parseFloat(d.montoExento), 0).toFixed(2);
  const totalBruto = documentos.reduce((s, d) => s + parseFloat(d.montoTotal), 0).toFixed(2);

  const impInsert: InsertLibroSiiImportacion = {
    ...impData,
    scope: auth.scope,
    usuarioId: auth.userId,
    origenImportacion: "manual",
    totalNeto,
    totalIva,
    totalExento,
    totalBruto,
  };

  const [imp] = await db.insert(libroSiiImportacionesTable).values(impInsert).returning();

  const docsInsert: InsertLibroSiiDocumento[] = documentos.map((d) => ({
    ...d,
    importacionId: imp.id,
    scope: auth.scope,
  }));

  await db.insert(libroSiiDocumentosTable).values(docsInsert);

  const docsCreados = await db
    .select()
    .from(libroSiiDocumentosTable)
    .where(eq(libroSiiDocumentosTable.importacionId, imp.id))
    .orderBy(asc(libroSiiDocumentosTable.fechaEmision));

  res.status(201).json({ importacion: imp, documentos: docsCreados });
});

/** DELETE /api/contabilidad/libro-sii/:id — eliminar importación */
contabilidadRouter.delete("/contabilidad/libro-sii/:id", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

  const [imp] = await db
    .select({ id: libroSiiImportacionesTable.id })
    .from(libroSiiImportacionesTable)
    .where(and(eq(libroSiiImportacionesTable.id, id), eq(libroSiiImportacionesTable.scope, auth.scope)))
    .limit(1);

  if (!imp) return res.status(404).json({ error: "Importación no encontrada" });

  await db.delete(libroSiiImportacionesTable).where(eq(libroSiiImportacionesTable.id, id));

  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// INFORMES DESDE DATOS REALES (cobros + compras de la plataforma)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/contabilidad/informes/resumen-financiero
 * Resumen financiero: ingresos (cobros pagados) y gastos (compras) por período.
 * Query params: anio (obligatorio), mes (opcional, 1-12 para filtrar un mes)
 */
contabilidadRouter.get("/contabilidad/informes/resumen-financiero", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { anio, mes } = req.query as Record<string, string>;
  if (!anio || isNaN(parseInt(anio))) {
    return res.status(400).json({ error: "Se requiere el parámetro anio (ej: 2024)" });
  }

  const anioNum = parseInt(anio);
  const mesNum = mes ? parseInt(mes) : null;

  // Cobros pagados del año (ingresos). Filtramos por organizationId o usuarioId.
  const orgCtx = await getOrgContext(auth.userId);
  const orgId = orgCtx.organizationId ?? null;

  // Construir filtros de fecha
  const fechaDesde = mesNum
    ? `${anioNum}-${String(mesNum).padStart(2, "0")}-01`
    : `${anioNum}-01-01`;
  const ultimoDia = mesNum
    ? new Date(anioNum, mesNum, 0).getDate()
    : 31;
  const mesHasta = mesNum ?? 12;
  const fechaHasta = `${anioNum}-${String(mesHasta).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;

  // ── Ingresos por mes (cobros con estado pagado/parcial) ──
  const cobrosBase = db
    .select({
      mes: sql<string>`to_char(fecha_vencimiento::date, 'MM')`,
      totalMonto: sum(cobrosTable.monto).mapWith(Number),
      totalNeto: sum(cobrosTable.montoNeto).mapWith(Number),
      totalIva: sum(cobrosTable.montoIva).mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(cobrosTable)
    .where(
      and(
        orgId
          ? eq(cobrosTable.organizationId, orgId)
          : eq(cobrosTable.usuarioId, auth.userId),
        inArray(cobrosTable.estado, ["pagado", "pagado_parcial"]),
        gte(cobrosTable.fechaVencimiento, fechaDesde),
        lte(cobrosTable.fechaVencimiento, fechaHasta),
      ),
    )
    .groupBy(sql`to_char(fecha_vencimiento::date, 'MM')`)
    .orderBy(sql`to_char(fecha_vencimiento::date, 'MM')`);

  // ── Gastos por mes (compras recibidas/contabilizadas) ──
  const comprasBase = db
    .select({
      mes: sql<string>`to_char(fecha_emision::date, 'MM')`,
      totalSubtotal: sum(comprasTable.subtotal).mapWith(Number),
      totalIva: sum(comprasTable.montoIva).mapWith(Number),
      totalMonto: sum(comprasTable.total).mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(comprasTable)
    .where(
      and(
        orgId
          ? eq(comprasTable.organizationId, orgId)
          : eq(comprasTable.usuarioId, auth.userId),
        inArray(comprasTable.estado, ["recibida", "contabilizada"]),
        gte(comprasTable.fechaEmision, fechaDesde),
        lte(comprasTable.fechaEmision, fechaHasta),
      ),
    )
    .groupBy(sql`to_char(fecha_emision::date, 'MM')`)
    .orderBy(sql`to_char(fecha_emision::date, 'MM')`);

  const [cobrosRows, comprasRows] = await Promise.all([cobrosBase, comprasBase]);

  // Mapear por mes (1..12)
  const mesesLabels = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const meses = Array.from({ length: 12 }, (_, i) => i + 1);

  const ingresosPorMes: Record<number, { monto: number; neto: number; iva: number; count: number }> = {};
  const gastosPorMes: Record<number, { subtotal: number; iva: number; total: number; count: number }> = {};

  for (const r of cobrosRows) {
    const m = parseInt(r.mes);
    ingresosPorMes[m] = { monto: r.totalMonto ?? 0, neto: r.totalNeto ?? 0, iva: r.totalIva ?? 0, count: r.count ?? 0 };
  }
  for (const r of comprasRows) {
    const m = parseInt(r.mes);
    gastosPorMes[m] = { subtotal: r.totalSubtotal ?? 0, iva: r.totalIva ?? 0, total: r.totalMonto ?? 0, count: r.count ?? 0 };
  }

  const serie = (mesNum ? [mesNum] : meses).map((m) => {
    const ing = ingresosPorMes[m] ?? { monto: 0, neto: 0, iva: 0, count: 0 };
    const gas = gastosPorMes[m] ?? { subtotal: 0, iva: 0, total: 0, count: 0 };
    return {
      mes: m,
      label: mesesLabels[m - 1],
      ingresos: ing.monto,
      ingresosNeto: ing.neto,
      ingresosIva: ing.iva,
      cantidadCobros: ing.count,
      gastos: gas.total,
      gastosNeto: gas.subtotal,
      gastosIva: gas.iva,
      cantidadCompras: gas.count,
      resultado: ing.monto - gas.total,
    };
  });

  const totales = serie.reduce(
    (acc, s) => ({
      ingresos: acc.ingresos + s.ingresos,
      gastos: acc.gastos + s.gastos,
      resultado: acc.resultado + s.resultado,
    }),
    { ingresos: 0, gastos: 0, resultado: 0 },
  );

  res.json({ anio: anioNum, mes: mesNum, serie, totales });
});

/**
 * GET /api/contabilidad/informes/presupuesto-real
 * Proyección automática de presupuesto: promedio mensual de los últimos N meses
 * Query params: meses (default 6) — cuántos meses históricos usar para calcular.
 */
contabilidadRouter.get("/contabilidad/informes/presupuesto-real", requireSubscription, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { meses: mesesStr = "6" } = req.query as Record<string, string>;
  const mesesHistorico = Math.min(Math.max(parseInt(mesesStr) || 6, 1), 24);

  const orgCtx = await getOrgContext(auth.userId);

  const orgId = orgCtx.organizationId ?? null;

  // Rango: últimos N meses hasta hoy
  const hoy = new Date();
  const fechaHasta = hoy.toISOString().slice(0, 10);
  const fechaDesde = new Date(hoy.getFullYear(), hoy.getMonth() - mesesHistorico, 1)
    .toISOString()
    .slice(0, 10);

  // Cobros pagados agrupados por mes
  const cobrosRows = await db
    .select({
      anio: sql<number>`extract(year from fecha_vencimiento::date)`.mapWith(Number),
      mes: sql<number>`extract(month from fecha_vencimiento::date)`.mapWith(Number),
      total: sum(cobrosTable.monto).mapWith(Number),
    })
    .from(cobrosTable)
    .where(
      and(
        orgId ? eq(cobrosTable.organizationId, orgId) : eq(cobrosTable.usuarioId, auth.userId),
        inArray(cobrosTable.estado, ["pagado", "pagado_parcial"]),
        gte(cobrosTable.fechaVencimiento, fechaDesde),
        lte(cobrosTable.fechaVencimiento, fechaHasta),
      ),
    )
    .groupBy(sql`extract(year from fecha_vencimiento::date)`, sql`extract(month from fecha_vencimiento::date)`);

  // Compras agrupadas por mes
  const comprasRows = await db
    .select({
      anio: sql<number>`extract(year from fecha_emision::date)`.mapWith(Number),
      mes: sql<number>`extract(month from fecha_emision::date)`.mapWith(Number),
      total: sum(comprasTable.total).mapWith(Number),
    })
    .from(comprasTable)
    .where(
      and(
        orgId ? eq(comprasTable.organizationId, orgId) : eq(comprasTable.usuarioId, auth.userId),
        inArray(comprasTable.estado, ["recibida", "contabilizada"]),
        gte(comprasTable.fechaEmision, fechaDesde),
        lte(comprasTable.fechaEmision, fechaHasta),
      ),
    )
    .groupBy(sql`extract(year from fecha_emision::date)`, sql`extract(month from fecha_emision::date)`);

  const totalIngresos = cobrosRows.reduce((s, r) => s + (r.total ?? 0), 0);
  const totalGastos = comprasRows.reduce((s, r) => s + (r.total ?? 0), 0);

  const promedioIngresos = cobrosRows.length > 0 ? totalIngresos / mesesHistorico : 0;
  const promedioGastos = comprasRows.length > 0 ? totalGastos / mesesHistorico : 0;

  // Proyección para los próximos 12 meses
  const proyeccion = Array.from({ length: 12 }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i + 1, 1);
    const mesesLabels = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return {
      mes: fecha.getMonth() + 1,
      anio: fecha.getFullYear(),
      label: `${mesesLabels[fecha.getMonth()]} ${fecha.getFullYear()}`,
      ingresosProyectados: Math.round(promedioIngresos),
      gastosProyectados: Math.round(promedioGastos),
      resultadoProyectado: Math.round(promedioIngresos - promedioGastos),
    };
  });

  res.json({
    mesesHistorico,
    fechaDesde,
    fechaHasta,
    historico: {
      totalIngresos,
      totalGastos,
      promedioIngresos: Math.round(promedioIngresos),
      promedioGastos: Math.round(promedioGastos),
      mesesConIngresos: cobrosRows.length,
      mesesConGastos: comprasRows.length,
    },
    proyeccion,
  });
});
