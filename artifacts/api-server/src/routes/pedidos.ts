import { Router, type Request, type Response, type NextFunction } from "express";
import { db, pedidosTable, pedidoItemsTable, cotizacionesTable, cotizacionItemsTable, clientesTable, documentosVentaTable, productosTable, movimientosStockTable, stockPorBodegaTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { getOrgContext } from "../lib/org";
import { getPreferenciasNegocio } from "../lib/preferencias";

const router = Router();
router.use("/pedidos", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
});

class PedidoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const action = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    void fn(req, res).catch(err => {
      req.log?.error({ err }, "Operación de pedido fallida");
      const isDev = process.env.NODE_ENV !== "production";
      res.status(err instanceof PedidoError ? err.status : 500).json({
        error: err instanceof PedidoError ? err.message : "No se pudo completar la operación. Intenta nuevamente.",
        ...(isDev && !(err instanceof PedidoError) ? { detail: String(err?.message ?? err) } : {}),
      });
    });
  };

async function getScopedPedido(userId: string, pedidoId: number) {
  const ctx = await getOrgContext(userId);
  const condition = ctx.organizationId
    ? and(eq(pedidosTable.id, pedidoId), eq(pedidosTable.organizationId, ctx.organizationId))
    : and(eq(pedidosTable.id, pedidoId), eq(pedidosTable.responsableId, userId));
  const [pedido] = await db.select().from(pedidosTable).where(condition);
  if (!pedido) throw new PedidoError("Pedido no encontrado.", 404);
  return { pedido, condition, ctx };
}

async function pedidoScope(userId: string) {
  const ctx = await getOrgContext(userId);
  return ctx.organizationId
    ? eq(pedidosTable.organizationId, ctx.organizationId)
    : eq(pedidosTable.responsableId, userId);
}

async function serializePedido(pedido: typeof pedidosTable.$inferSelect) {
  const items = await db.select().from(pedidoItemsTable).where(eq(pedidoItemsTable.pedidoId, pedido.id));
  return { ...pedido, items };
}

// GET /pedidos
router.get("/pedidos", action(async (req, res) => {
  const scope = await pedidoScope(req.user!.id);
  const rows = await db.select().from(pedidosTable).where(scope).orderBy(desc(pedidosTable.id));
  res.json(rows);
}));

// POST /pedidos
router.post("/pedidos", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const { items = [], ...body } = req.body;

  const pedido = await db.transaction(async tx => {
    const [created] = await tx.insert(pedidosTable).values({
      ...body,
      organizationId: ctx.organizationId ?? null,
      responsableId: req.user!.id,
      numeroPedido: "",
    }).returning();
    const prefijo = prefs.prefijoCotizacion?.replace(/COT/i, "PED") ?? "PED-";
    const [numbered] = await tx.update(pedidosTable)
      .set({ numeroPedido: `${prefijo}${String(created.id).padStart(4, "0")}` })
      .where(eq(pedidosTable.id, created.id))
      .returning();
    if (items.length > 0) {
      await tx.insert(pedidoItemsTable).values(items.map((i: Record<string, unknown>) => ({ ...i, pedidoId: created.id })));
    }
    return numbered;
  });

  res.status(201).json(await serializePedido(pedido));
}));

// POST /pedidos/from-cotizacion/:cotizacionId — convierte cotización en pedido
router.post("/pedidos/from-cotizacion/:cotizacionId", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const cotizacionId = Number(req.params.cotizacionId);

  // Buscar cotización del mismo scope
  const cotScope = ctx.organizationId
    ? and(eq(cotizacionesTable.id, cotizacionId), eq(cotizacionesTable.organizationId, ctx.organizationId))
    : and(eq(cotizacionesTable.id, cotizacionId), eq(cotizacionesTable.responsableId, req.user!.id));
  const [cot] = await db.select().from(cotizacionesTable).where(cotScope);
  if (!cot) throw new PedidoError("Cotización no encontrada.", 404);

  const cotItems = await db.select().from(cotizacionItemsTable).where(eq(cotizacionItemsTable.cotizacionId, cot.id));

  const pedido = await db.transaction(async tx => {
    const [created] = await tx.insert(pedidosTable).values({
      organizationId: ctx.organizationId ?? null,
      areaId: cot.areaId ?? null,
      responsableId: req.user!.id,
      numeroPedido: "",
      clienteId: cot.clienteId!,
      clienteNombre: cot.clienteNombre,
      clienteRut: cot.clienteRut ?? null,
      clienteEmail: cot.clienteEmail ?? null,
      clienteDireccion: cot.clienteDireccion ?? null,
      cotizacionId: cot.id,
      estado: "pendiente",
      moneda: cot.moneda,
      decimales: cot.decimales,
      subtotal: cot.subtotal,
      porcentajeIva: cot.porcentajeIva,
      montoIva: cot.montoIva,
      total: cot.total,
      notas: cot.clienteGiro ?? "",
    }).returning();

    const prefijo = prefs.prefijoCotizacion?.replace(/COT/i, "PED") ?? "PED-";
    const [numbered] = await tx.update(pedidosTable)
      .set({ numeroPedido: `${prefijo}${String(created.id).padStart(4, "0")}` })
      .where(eq(pedidosTable.id, created.id))
      .returning();

    if (cotItems.length > 0) {
      await tx.insert(pedidoItemsTable).values(cotItems.map(i => ({
        pedidoId: created.id,
        productoId: i.productoId ?? null,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        subtotalLinea: i.subtotalLinea,
      })));
    }

    return numbered;
  });

  res.status(201).json(await serializePedido(pedido));
}));

// GET /pedidos/:id
router.get("/pedidos/:id", action(async (req, res) => {
  const { pedido } = await getScopedPedido(req.user!.id, Number(req.params.id));
  res.json(await serializePedido(pedido));
}));

// PATCH /pedidos/:id — editar pedido (solo pendiente)
router.patch("/pedidos/:id", action(async (req, res) => {
  const { condition } = await getScopedPedido(req.user!.id, Number(req.params.id));
  const { items, ...body } = req.body;

  const pedido = await db.transaction(async tx => {
    const [current] = await tx.select().from(pedidosTable).where(condition).for("update");
    if (!current) throw new PedidoError("Pedido no encontrado.", 404);
    if (current.estado !== "pendiente") throw new PedidoError("Solo se puede editar un pedido pendiente.");

    const [updated] = await tx.update(pedidosTable)
      .set({ ...body, actualizadoEn: new Date() })
      .where(condition)
      .returning();

    if (Array.isArray(items)) {
      await tx.delete(pedidoItemsTable).where(eq(pedidoItemsTable.pedidoId, current.id));
      if (items.length > 0) {
        await tx.insert(pedidoItemsTable).values(items.map((i: Record<string, unknown>) => ({ ...i, pedidoId: current.id })));
      }
    }
    return updated;
  });

  res.json(await serializePedido(pedido));
}));

// ─── Helper: bajar stock al despachar un pedido ──────────────────────────────
async function descontarStockPedido(pedidoId: number, userId: string, ctx: Awaited<ReturnType<typeof getOrgContext>>) {
  const items = await db.select().from(pedidoItemsTable).where(eq(pedidoItemsTable.pedidoId, pedidoId));

  for (const item of items) {
    if (!item.productoId) continue;
    const cantidad = Number(item.cantidad);
    if (cantidad <= 0) continue;

    // Verificar que el producto existe y es de tipo producto (no servicio)
    const [producto] = await db.select().from(productosTable).where(eq(productosTable.id, item.productoId));
    if (!producto || producto.tipo !== "producto") continue;

    // ¿Tiene bodegas?
    const stockRows = await db.select().from(stockPorBodegaTable).where(eq(stockPorBodegaTable.productoId, item.productoId));

    if (stockRows.length > 0) {
      // Rebajar del primer stock disponible (bodega con stock)
      const bodegaConStock = stockRows.find(s => Number(s.stockActual) >= cantidad) ?? stockRows[0];
      const nuevoStock = Math.max(0, Math.round((Number(bodegaConStock.stockActual) - cantidad) * 1000) / 1000);
      await db.update(stockPorBodegaTable)
        .set({ stockActual: String(nuevoStock), actualizadoEn: new Date() })
        .where(eq(stockPorBodegaTable.id, bodegaConStock.id));

      // Recalcular total
      const updatedRows = await db.select().from(stockPorBodegaTable).where(eq(stockPorBodegaTable.productoId, item.productoId));
      const total = updatedRows.reduce((n, s) => n + Number(s.stockActual), 0);
      await db.update(productosTable)
        .set({ stockActual: String(Math.round(total * 1000) / 1000), actualizadoEn: new Date() })
        .where(eq(productosTable.id, item.productoId));

      await db.insert(movimientosStockTable).values({
        productoId: item.productoId,
        tipo: "salida",
        cantidad: String(cantidad),
        motivo: `Venta / Pedido #${pedidoId}`,
        usuarioId: userId,
        bodegaOrigenId: bodegaConStock.bodegaId,
        areaId: null,
      });
    } else {
      // Sin bodegas: rebajar del stock global
      const stockActual = Number(producto.stockActual ?? 0);
      const nuevoStock = Math.max(0, Math.round((stockActual - cantidad) * 1000) / 1000);
      await db.update(productosTable)
        .set({ stockActual: String(nuevoStock), actualizadoEn: new Date() })
        .where(eq(productosTable.id, item.productoId));

      await db.insert(movimientosStockTable).values({
        productoId: item.productoId,
        tipo: "salida",
        cantidad: String(cantidad),
        motivo: `Venta / Pedido #${pedidoId}`,
        usuarioId: userId,
        bodegaOrigenId: null,
        areaId: null,
      });
    }
  }
}

// PATCH /pedidos/:id/estado — cambio de estado
router.patch("/pedidos/:id/estado", action(async (req, res) => {
  const { condition } = await getScopedPedido(req.user!.id, Number(req.params.id));
  const { estado, notasLogistica } = req.body as { estado: string; notasLogistica?: string };

  const estadosValidos = ["pendiente", "aprobado", "despachado", "cancelado"];
  if (!estadosValidos.includes(estado)) throw new PedidoError("Estado inválido.");

  const pedido = await db.transaction(async tx => {
    const [current] = await tx.select().from(pedidosTable).where(condition).for("update");
    if (!current) throw new PedidoError("Pedido no encontrado.", 404);

    const transicionesValidas: Record<string, string[]> = {
      pendiente: ["aprobado", "cancelado"],
      aprobado: ["despachado", "cancelado"],
      despachado: [],
      cancelado: [],
    };
    if (!transicionesValidas[current.estado]?.includes(estado)) {
      throw new PedidoError(`No se puede cambiar de '${current.estado}' a '${estado}'.`, 409);
    }

    const extra: Record<string, unknown> = { actualizadoEn: new Date() };
    if (estado === "aprobado") { extra.aprobadoPor = req.user!.id; extra.aprobadoEn = new Date(); }
    if (estado === "despachado") { extra.despachadorId = req.user!.id; extra.despachadoEn = new Date(); }
    if (notasLogistica !== undefined) extra.notasLogistica = notasLogistica;

    const [updated] = await tx.update(pedidosTable)
      .set({ estado: estado as "pendiente" | "aprobado" | "despachado" | "entregado" | "cancelado", ...extra })
      .where(condition)
      .returning();
    return updated;
  });

  // Descontar stock al despachar (fuera de la transacción principal para no bloquearla)
  if (estado === "despachado") {
    const ctx = await getOrgContext(req.user!.id);
    try {
      await descontarStockPedido(pedido.id, req.user!.id, ctx);
    } catch (err) {
      // No fallar la operación por error de stock — solo registrar
      req.log?.warn({ err, pedidoId: pedido.id }, "No se pudo descontar stock al despachar pedido");
    }
  }

  res.json(await serializePedido(pedido));
}));

export default router;
