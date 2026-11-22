import { Router, type Request, type Response, type NextFunction } from "express";
import { db, comprasTable, proveedoresTable } from "@workspace/db";
import { CreateCompraBody, UpdateCompraBody, CreateProveedorBody, UpdateProveedorBody, RecibirCompraBody } from "@workspace/api-zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { getOrgContext } from "../lib/org";
import { hoySantiago } from "../lib/preferencias";
import { lockInventoryScope } from "../lib/inventario-bodegas";
import { CompraError, compraPorId, compraScope, exigirRecepcion, guardarCompra, proveedorInput, proveedorPorId, proveedorScope, purchaseDate, serializeCompras, serializeProveedor } from "../lib/compras";
import { previewRecepcion, recibirCompra } from "../lib/compras-recepcion";
import { generarAsientoCompra } from "../lib/contabilidad-auto";
import { devolverCompra, listDevoluciones } from "../lib/compras-devoluciones";

const router = Router();
const requireLogin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
};
router.use("/compras", requireLogin, requireSubscription);
router.use("/proveedores", requireLogin, requireSubscription);
function route(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, _next: NextFunction) => { void fn(req, res).catch(err => {
    if (err instanceof CompraError) { res.status(err.status).json({ error: err.message }); return; }
    if (err?.name === "ZodError") { res.status(400).json({ error: err.issues?.map((i: { message: string }) => i.message).join("; ") || "Datos inválidos" }); return; }
    req.log.error({ err }, "Error en Compras");
    res.status(500).json({ error: "No pudimos completar la operación de compra." });
  }); };
}
const idOf = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);
router.get("/proveedores", route(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  res.json((await db.select().from(proveedoresTable).where(proveedorScope(ctx, req.user!.id)).orderBy(desc(proveedoresTable.id))).map(serializeProveedor));
}));
async function saveProveedor(userId: string, input: unknown, id?: number) {
  const d = proveedorInput.parse(input), ctx = await getOrgContext(userId);
  return db.transaction(async tx => {
    await lockInventoryScope(tx, ctx, userId);
    if (id) await proveedorPorId(userId, id, tx);
    const duplicates = await tx.select().from(proveedoresTable).where(and(proveedorScope(ctx, userId), eq(proveedoresTable.rut, d.rut)));
    if (duplicates.some(p => p.id !== id)) throw new CompraError("Ya existe un proveedor con ese RUT.", 409);
    const [p] = id ? await tx.update(proveedoresTable).set(d).where(eq(proveedoresTable.id, id)).returning()
      : await tx.insert(proveedoresTable).values({ ...d, organizationId: ctx.organizationId, usuarioId: userId }).returning();
    return serializeProveedor(p);
  });
}
router.post("/proveedores", route(async (req, res) => { res.status(201).json(await saveProveedor(req.user!.id, CreateProveedorBody.parse(req.body))); }));
router.patch("/proveedores/:id", route(async (req, res) => { res.json(await saveProveedor(req.user!.id, UpdateProveedorBody.parse(req.body), idOf(req))); }));
router.get("/proveedores/:id", route(async (req, res) => {
  const userId = req.user!.id, id = idOf(req), ctx = await getOrgContext(userId);
  const p = await proveedorPorId(userId, id);
  const rows = await db.select().from(comprasTable).where(and(compraScope(ctx, userId), eq(comprasTable.proveedorId, id))).orderBy(desc(comprasTable.id));
  const compras = await serializeCompras(rows, ctx);
  const stats = new Map<string, { moneda: string; decimales: number; mesActual: number; acumulado: number }>();
  const products = new Map<number, { productoId: number; descripcion: string; cantidad: number }>();
  const month = hoySantiago().slice(0, 7);
  for (const c of compras.filter(c => c.estado !== "borrador")) {
    const stat = stats.get(c.moneda) ?? { moneda: c.moneda, decimales: c.decimales, mesActual: 0, acumulado: 0 };
    stat.decimales = Math.max(stat.decimales, c.decimales);
    stat.acumulado = Math.round((stat.acumulado + c.total) * 100) / 100;
    if (c.fechaRecepcion.startsWith(month)) stat.mesActual = Math.round((stat.mesActual + c.total) * 100) / 100;
    stats.set(c.moneda, stat);
    for (const i of c.items) if (i.productoId) {
      const row = products.get(i.productoId) ?? { productoId: i.productoId, descripcion: i.descripcion, cantidad: 0 };
      row.cantidad = Math.round((row.cantidad + i.cantidad) * 1000) / 1000;
      products.set(i.productoId, row);
    }
  }
  res.json({ ...serializeProveedor(p), compras, totales: [...stats.values()], productosMasComprados: [...products.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10) });
}));
router.get("/compras", route(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const filters = [compraScope(ctx, req.user!.id)];
  if (req.query.proveedorId) filters.push(eq(comprasTable.proveedorId, z.coerce.number().int().positive().parse(req.query.proveedorId)));
  if (req.query.estado) filters.push(eq(comprasTable.estado, z.enum(["borrador", "recibida", "contabilizada"]).parse(req.query.estado)));
  if (req.query.desde) filters.push(gte(comprasTable.fechaEmision, purchaseDate.parse(req.query.desde)));
  if (req.query.hasta) filters.push(lte(comprasTable.fechaEmision, purchaseDate.parse(req.query.hasta)));
  res.json(await serializeCompras(await db.select().from(comprasTable).where(and(...filters)).orderBy(desc(comprasTable.id)), ctx));
}));
router.post("/compras", route(async (req, res) => { res.status(201).json(await guardarCompra(req.user!.id, CreateCompraBody.parse(req.body))); }));
router.get("/compras/:id", route(async (req, res) => {
  const { c, ctx } = await compraPorId(req.user!.id, idOf(req)); res.json((await serializeCompras([c], ctx))[0]);
}));
router.patch("/compras/:id", route(async (req, res) => { res.json(await guardarCompra(req.user!.id, UpdateCompraBody.parse(req.body), idOf(req))); }));
router.delete("/compras/:id", route(async (req, res) => {
  await db.transaction(async tx => {
    const ctx = await getOrgContext(req.user!.id);
    await lockInventoryScope(tx, ctx, req.user!.id);
    const { c } = await compraPorId(req.user!.id, idOf(req), tx, true);
    if (c.estado !== "borrador") throw new CompraError("Solo puedes eliminar borradores.", 409);
    await tx.delete(comprasTable).where(eq(comprasTable.id, c.id));
  });
  res.sendStatus(204);
}));
router.get("/compras/:id/recepcion", route(async (req, res) => { res.json(await previewRecepcion(req.user!.id, idOf(req))); }));
router.get("/compras/:id/devoluciones", route(async (req, res) => { res.json(await listDevoluciones(req.user!.id, idOf(req))); }));
router.post("/compras/:id/devoluciones", route(async (req, res) => { res.json(await devolverCompra(req.user!.id, idOf(req), req.body)); }));
router.post("/compras/:id/recepcion", route(async (req, res) => {
  const compraId = idOf(req);
  const userId = req.user!.id;
  const result = await recibirCompra(userId, compraId, RecibirCompraBody.parse(req.body));
  // Generar asiento contable automáticamente al recibir la compra
  const orgCtx = await getOrgContext(userId);
  const scope = orgCtx.organizationId ? `org:${orgCtx.organizationId}` : `user:${userId}`;
  void generarAsientoCompra(scope, userId, compraId).catch((err) =>
    req.log.warn({ err, compraId }, "No se pudo generar asiento contable para compra recibida"),
  );
  res.json(result);
}));
router.post("/compras/:id/contabilizar", route(async (req, res) => {
  const compraId = idOf(req);
  const userId = req.user!.id;
  const result = await db.transaction(async tx => {
    const { c, ctx } = await compraPorId(userId, compraId, tx, true);
    exigirRecepcion(ctx);
    if (c.estado === "borrador") throw new CompraError("Confirma primero la recepción.", 409);
    const [saved] = c.estado === "contabilizada" ? [c] : await tx.update(comprasTable).set({ estado: "contabilizada", updatedAt: new Date() }).where(eq(comprasTable.id, c.id)).returning();
    return (await serializeCompras([saved], ctx, tx))[0];
  });
  // Generar asiento contable automáticamente al contabilizar
  const orgCtx = await getOrgContext(userId);
  const scope = orgCtx.organizationId ? `org:${orgCtx.organizationId}` : `user:${userId}`;
  void generarAsientoCompra(scope, userId, compraId).catch((err) =>
    req.log.warn({ err, compraId }, "No se pudo generar asiento contable para compra contabilizada"),
  );
  res.json(result);
}));
export default router;
