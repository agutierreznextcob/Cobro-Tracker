import { Router } from "express";
import { db, productosTable, movimientosStockTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireSubscription } from "../middlewares/requireSubscription";
import { inventarioScope, productoBody, productoValues, serializeProducto, movimientoBody } from "../lib/inventario";

const router = Router();
router.use("/inventario", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription);

router.get("/inventario", async (req, res) => {
  const { condition } = await inventarioScope(req.user!.id);
  const rows = await db.select().from(productosTable).where(condition).orderBy(desc(productosTable.id));
  res.json(rows.map(serializeProducto));
});
router.get("/inventario/resumen", async (req, res) => {
  const { condition } = await inventarioScope(req.user!.id);
  const rows = await db.select().from(productosTable).where(and(condition, eq(productosTable.activo, true)));
  res.json({
    productos: rows.filter(p => p.tipo === "producto").length,
    servicios: rows.filter(p => p.tipo === "servicio").length,
    criticos: rows.filter(p => p.stockActual != null && Number(p.stockActual) <= Number(p.stockCritico)).length,
    agotados: rows.filter(p => p.stockActual != null && Number(p.stockActual) <= 0).length,
  });
});
router.post("/inventario", async (req, res) => {
  const parsed = productoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(" ") }); return; }
  try {
    const { ctx } = await inventarioScope(req.user!.id);
    const values = productoValues(parsed.data);
    const p = await db.transaction(async tx => {
      const [p] = await tx.insert(productosTable).values({ ...values, organizationId: ctx.organizationId, usuarioId: req.user!.id }).returning();
      if (p.tipo === "producto" && Number(p.stockActual) > 0) {
        await tx.insert(movimientosStockTable).values({ productoId: p.id, tipo: "entrada", cantidad: p.stockActual!, motivo: "Stock inicial", usuarioId: req.user!.id });
      }
      return p;
    });
    res.status(201).json(serializeProducto(p));
  } catch (err) {
    req.log.error({ err }, "Error al crear producto");
    res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo crear el producto." });
  }
});
router.get("/inventario/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  const { condition } = await inventarioScope(req.user!.id);
  const [p] = await db.select().from(productosTable).where(and(condition, eq(productosTable.id, id)));
  if (!p) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json(serializeProducto(p));
});
router.patch("/inventario/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = productoBody.safeParse(req.body);
  if (!parsed.success || !Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Datos del producto inválidos." }); return; }
  const { condition } = await inventarioScope(req.user!.id);
  try {
    const p = await db.transaction(async tx => {
      const [current] = await tx.select().from(productosTable).where(and(condition, eq(productosTable.id, id))).for("update");
      if (!current) return null;
      if (current.tipo !== parsed.data.tipo) throw new Error("No se puede cambiar el tipo de un registro existente.");
      const { stockActual: _ignored, ...values } = productoValues(parsed.data);
      const [updated] = await tx.update(productosTable).set({ ...values, actualizadoEn: new Date() }).where(eq(productosTable.id, id)).returning();
      return updated;
    });
    if (!p) { res.status(404).json({ error: "Producto no encontrado" }); return; }
    res.json(serializeProducto(p));
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo editar." }); }
});
router.get("/inventario/:id/movimientos", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  const { condition } = await inventarioScope(req.user!.id);
  const [p] = await db.select().from(productosTable).where(and(condition, eq(productosTable.id, id)));
  if (!p) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  const rows = await db.select().from(movimientosStockTable).where(eq(movimientosStockTable.productoId, id)).orderBy(desc(movimientosStockTable.id));
  res.json(rows.map(m => ({ ...m, cantidad: Number(m.cantidad), creadoEn: m.creadoEn.toISOString() })));
});
router.post("/inventario/:id/movimientos", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = movimientoBody.safeParse(req.body);
  if (!parsed.success || !Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Indica cantidad válida y motivo del movimiento." }); return; }
  const { condition } = await inventarioScope(req.user!.id);
  try {
    const updated = await db.transaction(async tx => {
      const [p] = await tx.select().from(productosTable).where(and(condition, eq(productosTable.id, id))).for("update");
      if (!p) return null;
      if (p.tipo !== "producto") throw new Error("Los servicios no tienen movimientos de stock.");
      const d = parsed.data, current = Number(p.stockActual);
      const delta = d.tipo === "ajuste" ? d.cantidad - current : d.tipo === "salida" ? -d.cantidad : d.cantidad;
      const next = Math.round((current + delta) * 1000) / 1000;
      if (d.tipo === "salida" && next < 0) throw new Error("Stock insuficiente para esta salida manual.");
      await tx.insert(movimientosStockTable).values({ productoId: id, tipo: d.tipo, cantidad: String(d.tipo === "ajuste" ? delta : d.cantidad), motivo: d.motivo, usuarioId: req.user!.id });
      const [row] = await tx.update(productosTable).set({ stockActual: String(next), actualizadoEn: new Date() }).where(eq(productosTable.id, id)).returning();
      return row;
    });
    if (!updated) { res.status(404).json({ error: "Producto no encontrado" }); return; }
    res.status(201).json(serializeProducto(updated));
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo registrar el movimiento." }); }
});
export default router;
