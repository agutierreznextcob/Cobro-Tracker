import { Router } from "express";
import { db, localesTable, bodegasTable, stockPorBodegaTable, productosTable, movimientosStockTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { CreateLocalBody, CreateBodegaBody, UpdateStockCriticoBodegaBody } from "@workspace/api-zod";
import { enrichProductos, ensureStockRow, localScope, lockInventoryScope, scopedBodegas } from "../lib/inventario-bodegas";
import { inventarioScope } from "../lib/inventario";

const router = Router();
router.use(["/locales", "/bodegas"], (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription);
const validId = (value: unknown) => z.coerce.number().int().positive().safeParse(value);

async function listWarehouses(userId: string) {
  const rows = await scopedBodegas(userId);
  const stocks = rows.length ? await db.select().from(stockPorBodegaTable).where(inArray(stockPorBodegaTable.bodegaId, rows.map(r => r.bodega.id))) : [];
  return rows.map(({ bodega: b, local }) => ({
    ...b, creadoEn: b.creadoEn.toISOString(), localNombre: local.nombre,
    stockTotal: Math.round(stocks.filter(s => s.bodegaId === b.id).reduce((n, s) => n + Number(s.stockActual), 0) * 1000) / 1000,
  }));
}
async function listLocations(userId: string) {
  const { condition } = await localScope(userId);
  const rows = await db.select().from(localesTable).where(condition);
  const bodegas = await listWarehouses(userId);
  return rows.map(l => ({
    ...l, creadoEn: l.creadoEn.toISOString(), bodegas: bodegas.filter(b => b.localId === l.id),
    stockTotal: bodegas.filter(b => b.localId === l.id).reduce((n, b) => n + b.stockTotal, 0),
  }));
}
router.get("/locales", async (req, res) => { res.json(await listLocations(req.user!.id)); });
router.get("/locales/:id", async (req, res) => {
  const id = validId(req.params.id);
  const local = id.success ? (await listLocations(req.user!.id)).find(l => l.id === id.data) : null;
  if (!local) { res.status(404).json({ error: "Local no encontrado." }); return; }
  res.json(local);
});
router.post("/locales", async (req, res) => {
  const parsed = CreateLocalBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.nombre.trim()) { res.status(400).json({ error: "Indica un nombre de local válido." }); return; }
  const { ctx } = await localScope(req.user!.id);
  const [local] = await db.insert(localesTable).values({
    nombre: parsed.data.nombre.trim(), direccion: parsed.data.direccion?.trim() ?? "", organizationId: ctx.organizationId, usuarioId: req.user!.id,
  }).returning();
  res.status(201).json({ ...local, creadoEn: local.creadoEn.toISOString(), bodegas: [], stockTotal: 0 });
});
router.patch("/locales/:id", async (req, res) => {
  const id = validId(req.params.id);
  if (!id.success) { res.status(400).json({ error: "ID inválido" }); return; }
  const nombre = req.body?.nombre?.trim?.();
  const direccion = typeof req.body?.direccion === "string" ? req.body.direccion.trim() : undefined;
  if (!nombre) { res.status(400).json({ error: "Indica un nombre válido." }); return; }
  const { condition } = await localScope(req.user!.id);
  const [existing] = await db.select().from(localesTable).where(and(condition, eq(localesTable.id, id.data)));
  if (!existing) { res.status(404).json({ error: "Local no encontrado." }); return; }
  await db.update(localesTable).set({ nombre, ...(direccion !== undefined ? { direccion } : {}) }).where(eq(localesTable.id, id.data));
  const updated = (await listLocations(req.user!.id)).find(l => l.id === id.data);
  res.json(updated);
});
router.delete("/locales/:id", async (req, res) => {
  const id = validId(req.params.id);
  if (!id.success) { res.status(400).json({ error: "ID inválido" }); return; }
  const { condition } = await localScope(req.user!.id);
  const [existing] = await db.select().from(localesTable).where(and(condition, eq(localesTable.id, id.data)));
  if (!existing) { res.status(404).json({ error: "Local no encontrado." }); return; }
  const warehouses = await listWarehouses(req.user!.id);
  const localBodegas = warehouses.filter(b => b.localId === id.data);
  if (localBodegas.length > 0) {
    res.status(409).json({ error: "No se puede eliminar un local que tiene bodegas. Elimina primero sus bodegas." });
    return;
  }
  await db.delete(localesTable).where(eq(localesTable.id, id.data));
  req.log.info({ localId: id.data }, "Local deleted");
  res.status(204).send();
});
router.get("/bodegas", async (req, res) => { res.json(await listWarehouses(req.user!.id)); });
router.post("/bodegas", async (req, res) => {
  const parsed = CreateBodegaBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.nombre.trim()) { res.status(400).json({ error: "Indica nombre y local válidos." }); return; }
  const { condition, ctx } = await localScope(req.user!.id);
  const productScope = await inventarioScope(req.user!.id);
  try {
    const id = await db.transaction(async tx => {
      await lockInventoryScope(tx, ctx, req.user!.id);
      const [local] = await tx.select().from(localesTable).where(and(condition, eq(localesTable.id, parsed.data.localId), eq(localesTable.activo, true)));
      if (!local) return null;
      const existing = await scopedBodegas(req.user!.id, tx);
      // Lock before adding the first warehouse: payments either finish first or
      // see the fully migrated stock once this transaction commits.
      const products = !existing.length ? await tx.select().from(productosTable)
        .where(and(productScope.condition, eq(productosTable.tipo, "producto"))).orderBy(asc(productosTable.id)).for("update") : [];
      const [b] = await tx.insert(bodegasTable).values({
        nombre: parsed.data.nombre.trim(), descripcion: parsed.data.descripcion?.trim() ?? "", localId: local.id,
      }).returning();
      for (const p of products) {
        await tx.insert(stockPorBodegaTable).values({ productoId: p.id, bodegaId: b.id, stockActual: p.stockActual ?? "0", stockCritico: p.stockCritico });
        // Adjustment with both endpoints absent/present denotes general → warehouse;
        // no extra physical stock is introduced.
        await tx.insert(movimientosStockTable).values({
          productoId: p.id, tipo: "ajuste", cantidad: "0", motivo: "Asignación de stock general a primera bodega",
          bodegaDestinoId: b.id, usuarioId: req.user!.id,
        });
      }
      return b.id;
    });
    if (!id) { res.status(404).json({ error: "Local no encontrado." }); return; }
    res.status(201).json((await listWarehouses(req.user!.id)).find(b => b.id === id));
  } catch (err) {
    req.log.error({ err }, "Error creando bodega");
    res.status(400).json({ error: "No se pudo crear la bodega. Intenta nuevamente." });
  }
});
router.get("/bodegas/:id", async (req, res) => {
  const id = validId(req.params.id);
  const warehouse = id.success ? (await listWarehouses(req.user!.id)).find(b => b.id === id.data) : null;
  if (!warehouse) { res.status(404).json({ error: "Bodega no encontrada." }); return; }
  const { condition } = await inventarioScope(req.user!.id);
  const rows = await db.select({ producto: productosTable }).from(stockPorBodegaTable)
    .innerJoin(productosTable, eq(productosTable.id, stockPorBodegaTable.productoId))
    .where(and(condition, eq(stockPorBodegaTable.bodegaId, warehouse.id)));
  res.json({ ...warehouse, productos: await enrichProductos(rows.map(r => r.producto)) });
});
router.patch("/bodegas/:id", async (req, res) => {
  const id = validId(req.params.id);
  if (!id.success) { res.status(400).json({ error: "ID inválido" }); return; }
  const nombre = req.body?.nombre?.trim?.();
  const descripcion = typeof req.body?.descripcion === "string" ? req.body.descripcion.trim() : undefined;
  if (!nombre) { res.status(400).json({ error: "Indica un nombre válido." }); return; }
  const warehouses = await listWarehouses(req.user!.id);
  const existing = warehouses.find(b => b.id === id.data);
  if (!existing) { res.status(404).json({ error: "Bodega no encontrada." }); return; }
  await db.update(bodegasTable).set({ nombre, ...(descripcion !== undefined ? { descripcion } : {}) }).where(eq(bodegasTable.id, id.data));
  const updated = (await listWarehouses(req.user!.id)).find(b => b.id === id.data);
  res.json(updated);
});
router.delete("/bodegas/:id", async (req, res) => {
  const id = validId(req.params.id);
  if (!id.success) { res.status(400).json({ error: "ID inválido" }); return; }
  const warehouses = await listWarehouses(req.user!.id);
  const existing = warehouses.find(b => b.id === id.data);
  if (!existing) { res.status(404).json({ error: "Bodega no encontrada." }); return; }
  if (existing.stockTotal > 0) {
    res.status(409).json({ error: "No se puede eliminar una bodega que tiene stock. Transfiere el stock primero." });
    return;
  }
  await db.transaction(async tx => {
    await tx.delete(stockPorBodegaTable).where(eq(stockPorBodegaTable.bodegaId, id.data));
    await tx.delete(bodegasTable).where(eq(bodegasTable.id, id.data));
  });
  req.log.info({ bodegaId: id.data }, "Bodega deleted");
  res.status(204).send();
});
router.patch("/bodegas/:id/productos/:productoId", async (req, res) => {
  const id = validId(req.params.id), productId = validId(req.params.productoId);
  const body = UpdateStockCriticoBodegaBody.safeParse(req.body);
  if (!id.success || !productId.success || !body.success || !Number.isFinite(body.data.stockCritico) || body.data.stockCritico > 1e9 || Math.round(body.data.stockCritico * 1000) / 1000 !== body.data.stockCritico) {
    res.status(400).json({ error: "Indica un stock crítico válido (hasta tres decimales)." }); return;
  }
  const { condition, ctx } = await inventarioScope(req.user!.id);
  const p = await db.transaction(async tx => {
    await lockInventoryScope(tx, ctx, req.user!.id);
    const [product] = await tx.select().from(productosTable).where(and(condition, eq(productosTable.id, productId.data))).for("update");
    if (!product || product.tipo !== "producto") return null;
    const warehouses = await scopedBodegas(req.user!.id, tx);
    if (!warehouses.some(w => w.bodega.id === id.data)) return null;
    await ensureStockRow(tx, product, id.data);
    await tx.update(stockPorBodegaTable).set({ stockCritico: String(body.data.stockCritico), actualizadoEn: new Date() })
      .where(and(eq(stockPorBodegaTable.productoId, product.id), eq(stockPorBodegaTable.bodegaId, id.data)));
    return product;
  });
  if (!p) { res.status(404).json({ error: "Producto o bodega no encontrado." }); return; }
  res.json((await enrichProductos([p]))[0]);
});
export default router;
