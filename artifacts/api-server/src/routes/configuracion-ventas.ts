import { Router, type Request, type Response, type NextFunction } from "express";
import { db, documentosVentaTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getOrgContext } from "../lib/org";

// Asegurar que la tabla exista (puede no estar migrada en instancias legacy)
async function ensureDocumentosVentaTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS documentos_venta (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER,
        usuario_id TEXT NOT NULL,
        tipo_documento TEXT NOT NULL,
        nombre_personalizado TEXT,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        afecta_stock BOOLEAN NOT NULL DEFAULT FALSE,
        tipo_movimiento_stock TEXT DEFAULT 'rebaja',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (_e) { /* ignorar si ya existe */ }
}
void ensureDocumentosVentaTable();

const router = Router();

router.use("/configuracion/ventas", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
});

const action = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    void fn(req, res).catch(err => {
      res.status(500).json({ error: err instanceof Error ? err.message : "Error inesperado" });
    });
  };

// Tipos de documento con sus defaults
const DOCUMENTOS_DEFAULT = [
  { tipoDocumento: "boleta_manual", nombreDefault: "35 · Boleta Manual", afectaStockDefault: true, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "boleta_electronica", nombreDefault: "39 · Boleta Electrónica", afectaStockDefault: true, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "boleta_electronica_stock", nombreDefault: "39 · Boleta Electrónica Rebaja Stock", afectaStockDefault: true, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "factura_electronica", nombreDefault: "33 · Factura Electrónica", afectaStockDefault: true, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "factura_electronica_stock", nombreDefault: "33 · Factura Electrónica Rebaja Stock", afectaStockDefault: true, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "factura_no_afecta", nombreDefault: "34 · Factura NO Afecta o Exenta", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "liquidacion_factura", nombreDefault: "43 · Liquidación Factura", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "nota_credito", nombreDefault: "61 · Nota de Crédito Electrónica", afectaStockDefault: true, tipoMovimientoDefault: "aumenta" as const },
  { tipoDocumento: "nota_credito_exenta", nombreDefault: "61 · Nota de Crédito Exenta", afectaStockDefault: false, tipoMovimientoDefault: "aumenta" as const },
  { tipoDocumento: "nota_credito_stock", nombreDefault: "61 · Nota de Crédito Electrónica Aumenta Stock", afectaStockDefault: true, tipoMovimientoDefault: "aumenta" as const },
  { tipoDocumento: "nota_debito", nombreDefault: "56 · Nota de Débito Electrónica", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "nota_debito_exenta", nombreDefault: "56 · Nota de Débito Exenta", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "vale_comprobante", nombreDefault: "48 · Vale Comprobante de Pago RS", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "sin_documento", nombreDefault: "Sin documento / Cobro informal", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
  // legacy
  { tipoDocumento: "factura_afecta", nombreDefault: "Factura afecta", afectaStockDefault: true, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "factura_exenta", nombreDefault: "Factura exenta", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "boleta_afecta", nombreDefault: "Boleta afecta", afectaStockDefault: true, tipoMovimientoDefault: "rebaja" as const },
  { tipoDocumento: "boleta_exenta", nombreDefault: "Boleta exenta", afectaStockDefault: false, tipoMovimientoDefault: "rebaja" as const },
];

async function getScope(userId: string) {
  const ctx = await getOrgContext(userId);
  return ctx.organizationId
    ? eq(documentosVentaTable.organizationId, ctx.organizationId)
    : eq(documentosVentaTable.usuarioId, userId);
}

// GET /configuracion/ventas/documentos — lista todos con defaults si no existen
router.get("/configuracion/ventas/documentos", action(async (req, res) => {
  let rows: (typeof documentosVentaTable.$inferSelect)[] = [];
  try {
    const scope = await getScope(req.user!.id);
    rows = await db.select().from(documentosVentaTable).where(scope);
  } catch (_err) {
    // La tabla puede no existir aún en esta instancia — devolver defaults
    rows = [];
  }

  // Merge con defaults
  const result = DOCUMENTOS_DEFAULT.map(def => {
    const saved = rows.find(r => r.tipoDocumento === def.tipoDocumento);
    return saved ?? {
      id: null,
      tipoDocumento: def.tipoDocumento,
      nombrePersonalizado: null,
      nombreDefault: def.nombreDefault,
      activo: true,
      afectaStock: def.afectaStockDefault,
      tipoMovimientoStock: def.tipoMovimientoDefault,
    };
  }).map(r => ({
    ...r,
    nombreDefault: DOCUMENTOS_DEFAULT.find(d => d.tipoDocumento === r.tipoDocumento)?.nombreDefault ?? r.tipoDocumento,
  }));

  res.json(result);
}));

// PATCH /configuracion/ventas/documentos/:tipoDocumento — crea o actualiza config de un doc
router.patch("/configuracion/ventas/documentos/:tipoDocumento", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const { tipoDocumento } = req.params;
  const { nombrePersonalizado, activo, afectaStock, tipoMovimientoStock } = req.body;

  const scope = ctx.organizationId
    ? and(eq(documentosVentaTable.organizationId, ctx.organizationId), eq(documentosVentaTable.tipoDocumento, tipoDocumento))
    : and(eq(documentosVentaTable.usuarioId, req.user!.id), eq(documentosVentaTable.tipoDocumento, tipoDocumento));

  const [existing] = await db.select().from(documentosVentaTable).where(scope);

  const values: Record<string, unknown> = { actualizadoEn: new Date() };
  if (nombrePersonalizado !== undefined) values.nombrePersonalizado = nombrePersonalizado || null;
  if (activo !== undefined) values.activo = activo;
  if (afectaStock !== undefined) values.afectaStock = afectaStock;
  if (tipoMovimientoStock !== undefined) values.tipoMovimientoStock = tipoMovimientoStock;

  let row;
  if (existing) {
    const [updated] = await db.update(documentosVentaTable)
      .set(values)
      .where(eq(documentosVentaTable.id, existing.id))
      .returning();
    row = updated;
  } else {
    const def = DOCUMENTOS_DEFAULT.find(d => d.tipoDocumento === tipoDocumento);
    const [created] = await db.insert(documentosVentaTable).values({
      tipoDocumento,
      organizationId: ctx.organizationId ?? null,
      usuarioId: req.user!.id,
      nombrePersonalizado: nombrePersonalizado || null,
      activo: activo ?? true,
      afectaStock: afectaStock ?? (def?.afectaStockDefault ?? false),
      tipoMovimientoStock: tipoMovimientoStock ?? (def?.tipoMovimientoDefault ?? "rebaja"),
    }).returning();
    row = created;
  }

  res.json({ ...row, nombreDefault: DOCUMENTOS_DEFAULT.find(d => d.tipoDocumento === tipoDocumento)?.nombreDefault ?? tipoDocumento });
}));

export default router;
