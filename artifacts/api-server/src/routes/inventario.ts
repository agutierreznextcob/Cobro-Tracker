import { Router } from "express";
import { db, productosTable, movimientosStockTable, stockPorBodegaTable, historialCostosTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireSubscription } from "../middlewares/requireSubscription";
import { inventarioScope, productoBody, productoValues, movimientoBody, validarUnidad } from "../lib/inventario";
import { enrichProductos, lockInventoryScope, scopedBodegas, validateInternalCode } from "../lib/inventario-bodegas";
import { registrarMovimiento } from "../lib/inventario-movimientos";
import { getPreferenciasNegocio } from "../lib/preferencias";
import { registrarCosto } from "../lib/inventario-costos";

const router = Router();
router.use("/inventario", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription);

router.get("/inventario", async (req, res) => {
  const { condition } = await inventarioScope(req.user!.id);
  const rows = await db.select().from(productosTable).where(condition).orderBy(desc(productosTable.id));
  res.json(await enrichProductos(rows));
});
router.get("/inventario/resumen", async (req, res) => {
  const { condition } = await inventarioScope(req.user!.id);
  const rows = await db.select().from(productosTable).where(and(condition, eq(productosTable.activo, true)));
  const enriched = await enrichProductos(rows);
  res.json({
    productos: rows.filter(p => p.tipo === "producto").length,
    servicios: rows.filter(p => p.tipo === "servicio").length,
    criticos: enriched.filter(p => p.ubicaciones.length ? p.ubicaciones.some(s => s.stockActual <= s.stockCritico) : p.stockActual != null && p.stockActual <= p.stockCritico).length,
    agotados: enriched.filter(p => p.stockActual != null && p.stockActual <= 0).length,
  });
});
router.post("/inventario", async (req, res) => {
  const parsed = productoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(" ") }); return; }
  try {
    const { ctx, condition } = await inventarioScope(req.user!.id);
    validarUnidad(parsed.data.tipo, parsed.data.unidadMedida);
    const prefs = await getPreferenciasNegocio(req.user!.id);
    const values = productoValues({ ...parsed.data, porcentajeIvaPrecio: parsed.data.porcentajeIvaPrecio ?? prefs.porcentajeIva }, prefs.decimales);
    const moneda = parsed.data.moneda ?? prefs.moneda;
    const p = await db.transaction(async tx => {
      await lockInventoryScope(tx, ctx, req.user!.id);
      const warehouses = await scopedBodegas(req.user!.id, tx);
      const bodegaId = parsed.data.bodegaId ?? null;
      if (values.tipo === "producto" && warehouses.length && !warehouses.some(w => w.bodega.id === bodegaId)) throw new Error("Selecciona una bodega válida para el stock inicial.");
      if (bodegaId && (values.tipo !== "producto" || !warehouses.some(w => w.bodega.id === bodegaId))) throw new Error("Bodega no válida.");
      const [p] = await tx.insert(productosTable).values({ ...values, moneda, organizationId: ctx.organizationId, usuarioId: req.user!.id }).returning();
      const code = parsed.data.codigoInterno || `PROD-${String(p.id).padStart(4, "0")}`;
      await validateInternalCode(tx, condition, code, p.id);
      await tx.update(productosTable).set({ codigoInterno: code }).where(eq(productosTable.id, p.id));
      p.codigoInterno = code;
      await registrarCosto(tx, { productoId: p.id, anterior: null, nuevo: Number(p.costoUnitario), usuarioId: req.user!.id, moneda: p.moneda, decimales: prefs.decimales });
      if (bodegaId) await tx.insert(stockPorBodegaTable).values({ productoId: p.id, bodegaId, stockActual: p.stockActual!, stockCritico: p.stockCritico });
      if (p.tipo === "producto" && Number(p.stockActual) > 0) {
        await tx.insert(movimientosStockTable).values({ productoId: p.id, tipo: "entrada", cantidad: p.stockActual!, motivo: "Parte de entrada", usuarioId: req.user!.id, bodegaDestinoId: bodegaId });
      }
      return p;
    });
    res.status(201).json((await enrichProductos([p]))[0]);
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
  res.json((await enrichProductos([p]))[0]);
});
router.patch("/inventario/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = productoBody.safeParse(req.body);
  if (!parsed.success || !Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Datos del producto inválidos." }); return; }
  const { condition, ctx } = await inventarioScope(req.user!.id);
  try {
    const prefs = await getPreferenciasNegocio(req.user!.id);
    const p = await db.transaction(async tx => {
      await lockInventoryScope(tx, ctx, req.user!.id);
      const [current] = await tx.select().from(productosTable).where(and(condition, eq(productosTable.id, id))).for("update");
      if (!current) return null;
      if (parsed.data.actualizadoEn && parsed.data.actualizadoEn !== current.actualizadoEn.toISOString()) {
        const conflict = new Error("El producto cambió desde que lo abriste. Recarga los costos antes de guardar.") as Error & { status: number };
        conflict.status = 409; throw conflict;
      }
      if (parsed.data.moneda && parsed.data.moneda !== current.moneda) throw new Error("No puedes cambiar la moneda de un producto existente.");
      if (current.tipo !== parsed.data.tipo) throw new Error("No se puede cambiar el tipo de un registro existente.");
      validarUnidad(parsed.data.tipo, parsed.data.unidadMedida, current.unidadMedida);
      const unchangedService = current.tipo === "servicio"
        && parsed.data.tarifaHora === Number(current.tarifaHora)
        && parsed.data.tiempoEstimadoHoras === Number(current.tiempoEstimadoHoras);
      const { stockActual: _ignored, ...values } = productoValues({
        ...parsed.data,
        incluyeIvaPrecio: parsed.data.incluyeIvaPrecio ?? current.incluyeIvaPrecio,
        porcentajeIvaPrecio: parsed.data.porcentajeIvaPrecio ?? Number(current.porcentajeIvaPrecio),
        pvpProveedor: parsed.data.pvpProveedor === undefined ? current.pvpProveedor == null ? null : Number(current.pvpProveedor) : parsed.data.pvpProveedor,
        pvpIncluyeIva: parsed.data.pvpIncluyeIva ?? current.pvpIncluyeIva,
      }, prefs.decimales, unchangedService ? Number(current.costoUnitario) : undefined);
      if (req.body.stockCritico === undefined) values.stockCritico = current.stockCritico;
      const code = parsed.data.codigoInterno || current.codigoInterno || `PROD-${String(id).padStart(4, "0")}`;
      await validateInternalCode(tx, condition, code, id);
      const [updated] = await tx.update(productosTable).set({ ...values, codigoInterno: code, actualizadoEn: new Date(Math.max(Date.now(), current.actualizadoEn.getTime() + 1)) }).where(eq(productosTable.id, id)).returning();
      await registrarCosto(tx, { productoId: id, anterior: Number(current.costoUnitario), nuevo: Number(updated.costoUnitario), usuarioId: req.user!.id, moneda: updated.moneda, decimales: prefs.decimales });
      return updated;
    });
    if (!p) { res.status(404).json({ error: "Producto no encontrado" }); return; }
    res.json((await enrichProductos([p]))[0]);
  } catch (err) { res.status((err as { status?: number }).status ?? 400).json({ error: err instanceof Error ? err.message : "No se pudo editar." }); }
});
router.delete("/inventario/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  try {
    const { condition } = await inventarioScope(req.user!.id);
    const [p] = await db.select().from(productosTable).where(and(condition, eq(productosTable.id, id)));
    if (!p) { res.status(404).json({ error: "Producto no encontrado" }); return; }
    // Delete all related stock and movement records before deleting the product
    await db.transaction(async tx => {
      await tx.delete(stockPorBodegaTable).where(eq(stockPorBodegaTable.productoId, id));
      await tx.delete(movimientosStockTable).where(eq(movimientosStockTable.productoId, id));
      await tx.delete(historialCostosTable).where(eq(historialCostosTable.productoId, id));
      await tx.delete(productosTable).where(eq(productosTable.id, id));
    });
    req.log.info({ productoId: id }, "Producto deleted");
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting producto");
    res.status(500).json({ error: "Error interno" });
  }
});
router.get("/inventario/:id/costos", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  const { condition } = await inventarioScope(req.user!.id);
  const [p] = await db.select().from(productosTable).where(and(condition, eq(productosTable.id, id)));
  if (!p) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  const rows = await db.select().from(historialCostosTable).where(eq(historialCostosTable.productoId, id)).orderBy(desc(historialCostosTable.id));
  res.json(rows.map(({ usuarioId: _, ...r }) => ({
    ...r, fecha: r.fecha.toISOString(), costoAnterior: r.costoAnterior == null ? null : Number(r.costoAnterior), costoNuevo: Number(r.costoNuevo),
  })));
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
  try {
    const updated = await registrarMovimiento(req.user!.id, id, parsed.data);
    if (!updated) { res.status(404).json({ error: "Producto no encontrado" }); return; }
    res.status(201).json((await enrichProductos([updated]))[0]);
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo registrar el movimiento." }); }
});
export default router;
