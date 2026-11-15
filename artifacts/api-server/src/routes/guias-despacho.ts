import { Router, type Request, type Response, type NextFunction } from "express";
import { db, guiasDespachoTable, guiaDespachoItemsTable, pedidosTable, pedidoItemsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { getOrgContext } from "../lib/org";
import { getPreferenciasNegocio } from "../lib/preferencias";

const router = Router();
router.use("/guias-despacho", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
});

class GuiaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const action = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    void fn(req, res).catch(err => {
      req.log?.error({ err }, "Operación de guía de despacho fallida");
      res.status(err instanceof GuiaError ? err.status : 500).json({
        error: err instanceof GuiaError ? err.message : "No se pudo completar la operación. Intenta nuevamente.",
      });
    });
  };

async function getScopedGuia(userId: string, guiaId: number) {
  const ctx = await getOrgContext(userId);
  const condition = ctx.organizationId
    ? and(eq(guiasDespachoTable.id, guiaId), eq(guiasDespachoTable.organizationId, ctx.organizationId))
    : and(eq(guiasDespachoTable.id, guiaId), eq(guiasDespachoTable.responsableId, userId));
  const [guia] = await db.select().from(guiasDespachoTable).where(condition);
  if (!guia) throw new GuiaError("Guía de despacho no encontrada.", 404);
  return { guia, condition, ctx };
}

async function guiaScope(userId: string) {
  const ctx = await getOrgContext(userId);
  return ctx.organizationId
    ? eq(guiasDespachoTable.organizationId, ctx.organizationId)
    : eq(guiasDespachoTable.responsableId, userId);
}

async function serializeGuia(guia: typeof guiasDespachoTable.$inferSelect) {
  const items = await db.select().from(guiaDespachoItemsTable).where(eq(guiaDespachoItemsTable.guiaId, guia.id));
  return { ...guia, items };
}

// GET /guias-despacho
router.get("/guias-despacho", action(async (req, res) => {
  const scope = await guiaScope(req.user!.id);
  const rows = await db.select().from(guiasDespachoTable).where(scope).orderBy(desc(guiasDespachoTable.id));
  res.json(rows);
}));

// POST /guias-despacho
router.post("/guias-despacho", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const { items = [], ...body } = req.body;

  const guia = await db.transaction(async tx => {
    const [created] = await tx.insert(guiasDespachoTable).values({
      ...body,
      organizationId: ctx.organizationId ?? null,
      responsableId: req.user!.id,
      numeroGuia: "",
    }).returning();

    const prefijo = prefs.prefijoCotizacion?.replace(/COT/i, "GD") ?? "GD-";
    const [numbered] = await tx.update(guiasDespachoTable)
      .set({ numeroGuia: `${prefijo}${String(created.id).padStart(4, "0")}` })
      .where(eq(guiasDespachoTable.id, created.id))
      .returning();

    if (items.length > 0) {
      await tx.insert(guiaDespachoItemsTable).values(items.map((i: Record<string, unknown>) => ({ ...i, guiaId: created.id })));
    }
    return numbered;
  });

  res.status(201).json(await serializeGuia(guia));
}));

// POST /guias-despacho/from-pedido/:pedidoId — genera guía desde pedido aprobado/despachado
router.post("/guias-despacho/from-pedido/:pedidoId", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const pedidoId = Number(req.params.pedidoId);

  // Buscar pedido del mismo scope
  const pedScope = ctx.organizationId
    ? and(eq(pedidosTable.id, pedidoId), eq(pedidosTable.organizationId, ctx.organizationId))
    : and(eq(pedidosTable.id, pedidoId), eq(pedidosTable.responsableId, req.user!.id));
  const [pedido] = await db.select().from(pedidosTable).where(pedScope);
  if (!pedido) throw new GuiaError("Pedido no encontrado.", 404);
  if (!["aprobado", "despachado"].includes(pedido.estado)) {
    throw new GuiaError("Solo se puede emitir guía para pedidos aprobados o despachados.");
  }

  const pedItems = await db.select().from(pedidoItemsTable).where(eq(pedidoItemsTable.pedidoId, pedido.id));

  // Fecha de hoy en formato YYYY-MM-DD
  const hoy = new Date().toISOString().slice(0, 10);

  const guia = await db.transaction(async tx => {
    const [created] = await tx.insert(guiasDespachoTable).values({
      organizationId: ctx.organizationId ?? null,
      responsableId: req.user!.id,
      numeroGuia: "",
      clienteId: pedido.clienteId,
      clienteNombre: pedido.clienteNombre,
      clienteRut: pedido.clienteRut ?? null,
      clienteDireccion: pedido.clienteDireccion ?? null,
      pedidoId: pedido.id,
      estado: "emitida",
      fechaEmision: hoy,
      moneda: pedido.moneda,
      decimales: pedido.decimales,
      subtotal: pedido.subtotal,
      porcentajeIva: pedido.porcentajeIva,
      montoIva: pedido.montoIva,
      total: pedido.total,
      observaciones: pedido.notas ?? "",
      // Datos de transporte opcionales desde el body
      transportista: req.body.transportista ?? "",
      patenteVehiculo: req.body.patenteVehiculo ?? "",
      chofer: req.body.chofer ?? "",
      direccionOrigen: req.body.direccionOrigen ?? "",
      direccionDestino: pedido.clienteDireccion ?? req.body.direccionDestino ?? "",
    }).returning();

    const prefijo = prefs.prefijoCotizacion?.replace(/COT/i, "GD") ?? "GD-";
    const [numbered] = await tx.update(guiasDespachoTable)
      .set({ numeroGuia: `${prefijo}${String(created.id).padStart(4, "0")}` })
      .where(eq(guiasDespachoTable.id, created.id))
      .returning();

    if (pedItems.length > 0) {
      await tx.insert(guiaDespachoItemsTable).values(pedItems.map(i => ({
        guiaId: created.id,
        productoId: i.productoId ?? null,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        subtotalLinea: i.subtotalLinea,
      })));
    }

    // Marcar el pedido como despachado si estaba aprobado
    if (pedido.estado === "aprobado") {
      await tx.update(pedidosTable).set({
        estado: "despachado",
        despachadorId: req.user!.id,
        despachadoEn: new Date(),
        guiaDespachoId: created.id,
        actualizadoEn: new Date(),
      }).where(eq(pedidosTable.id, pedido.id));
    }

    return numbered;
  });

  res.status(201).json(await serializeGuia(guia));
}));

// GET /guias-despacho/:id
router.get("/guias-despacho/:id", action(async (req, res) => {
  const { guia } = await getScopedGuia(req.user!.id, Number(req.params.id));
  res.json(await serializeGuia(guia));
}));

// PATCH /guias-despacho/:id/estado
router.patch("/guias-despacho/:id/estado", action(async (req, res) => {
  const { condition } = await getScopedGuia(req.user!.id, Number(req.params.id));
  const { estado } = req.body as { estado: string };

  const estadosValidos = ["emitida", "entregada", "anulada"];
  if (!estadosValidos.includes(estado)) throw new GuiaError("Estado inválido.");

  const guia = await db.transaction(async tx => {
    const [current] = await tx.select().from(guiasDespachoTable).where(condition).for("update");
    if (!current) throw new GuiaError("Guía no encontrada.", 404);

    const transicionesValidas: Record<string, string[]> = {
      emitida: ["entregada", "anulada"],
      entregada: ["anulada"],
      anulada: [],
    };
    if (!transicionesValidas[current.estado]?.includes(estado)) {
      throw new GuiaError(`No se puede cambiar de '${current.estado}' a '${estado}'.`, 409);
    }

    const [updated] = await tx.update(guiasDespachoTable)
      .set({ estado: estado as "emitida" | "entregada" | "anulada", actualizadoEn: new Date() })
      .where(condition)
      .returning();
    return updated;
  });

  res.json(await serializeGuia(guia));
}));

export default router;
