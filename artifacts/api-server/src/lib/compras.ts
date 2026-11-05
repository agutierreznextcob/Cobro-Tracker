import { db, comprasTable, compraItemsTable, proveedoresTable, productosTable, type Compra, type Proveedor } from "@workspace/db";
import { and, eq, inArray, isNull, asc, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getOrgContext, type OrgContext } from "./org";
import { getPreferenciasNegocio, roundMoney } from "./preferencias";
import { inventarioScope } from "./inventario";
import { lockInventoryScope, scopedBodegas, type InventoryTx } from "./inventario-bodegas";
import { isValidRut } from "./rut";
import { GetCompraResponse } from "@workspace/api-zod";

export class CompraError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const purchaseDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Fecha inválida");
export const proveedorInput = z.object({
  razonSocial: z.string().trim().min(1).max(200),
  rut: z.string().trim().max(20).refine(isValidRut, "RUT inválido").transform(s => s.replace(/[.\s]/g, "").toUpperCase()),
  giro: z.string().trim().max(200).default(""),
  direccion: z.string().trim().max(300).default(""),
  email: z.union([z.string().email().max(254), z.literal("")]).default(""),
  telefono: z.string().trim().max(40).default(""),
  contactoNombre: z.string().trim().max(200).default(""),
  activo: z.boolean().default(true),
});
export const compraInput = z.object({
  numeroFactura: z.string().trim().min(1).max(80),
  proveedorId: z.number().int().positive(),
  fechaEmision: purchaseDate,
  fechaRecepcion: purchaseDate,
  moneda: z.enum(["CLP", "USD", "EUR", "UF"]),
  porcentajeIva: z.number().finite().min(0).max(100),
  notas: z.string().max(5000).default(""),
  updatedAt: z.string().optional(),
  items: z.array(z.object({
    productoId: z.number().int().positive().nullish(),
    descripcion: z.string().trim().min(1).max(500),
    cantidad: z.number().finite().positive().max(1e8).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-5, "Máximo 3 decimales en cantidad"),
    precioUnitario: z.number().finite().min(0).max(1e9),
    bodegaDestinoId: z.number().int().positive().nullish(),
  })).min(1).max(200),
}).refine(d => d.fechaRecepcion >= d.fechaEmision, "La recepción no puede ser anterior a la emisión");
export type CompraDraft = z.infer<typeof compraInput>;
export function compraScope(ctx: OrgContext, userId: string): SQL {
  return ctx.organizationId != null ? eq(comprasTable.organizationId, ctx.organizationId)
    : and(isNull(comprasTable.organizationId), eq(comprasTable.usuarioId, userId))!;
}
export function proveedorScope(ctx: OrgContext, userId: string): SQL {
  return ctx.organizationId != null ? eq(proveedoresTable.organizationId, ctx.organizationId)
    : and(isNull(proveedoresTable.organizationId), eq(proveedoresTable.usuarioId, userId))!;
}
export function puedeRecibirCompra(ctx: OrgContext) {
  return ctx.isOrgAdmin || ctx.isSupervisor || (ctx.organizationId == null && ctx.orgRole !== "ejecutivo");
}
export function exigirRecepcion(ctx: OrgContext) {
  if (!puedeRecibirCompra(ctx)) throw new CompraError("Solo administradores y supervisores pueden confirmar recepciones y actualizar costos.", 403);
}
export async function compraPorId(userId: string, id: number, executor: InventoryTx | typeof db = db, lock = false) {
  const ctx = await getOrgContext(userId);
  const query = executor.select().from(comprasTable).where(and(compraScope(ctx, userId), eq(comprasTable.id, id)));
  const [c] = lock ? await query.for("update") : await query;
  if (!c) throw new CompraError("Compra no encontrada.", 404);
  return { c, ctx };
}
export async function proveedorPorId(userId: string, id: number, executor: InventoryTx | typeof db = db) {
  const ctx = await getOrgContext(userId);
  const [p] = await executor.select().from(proveedoresTable).where(and(proveedorScope(ctx, userId), eq(proveedoresTable.id, id)));
  if (!p) throw new CompraError("Proveedor no encontrado.", 404);
  return p;
}
export function serializeProveedor(p: Proveedor) {
  const { organizationId: _, usuarioId: __, ...rest } = p;
  return { ...rest, createdAt: p.createdAt.toISOString() };
}
export async function serializeCompras(rows: Compra[], ctx: OrgContext, executor: InventoryTx | typeof db = db) {
  if (!rows.length) return [];
  const items = await executor.select({ item: compraItemsTable, tipo: productosTable.tipo }).from(compraItemsTable)
    .leftJoin(productosTable, eq(productosTable.id, compraItemsTable.productoId))
    .where(inArray(compraItemsTable.compraId, rows.map(c => c.id))).orderBy(asc(compraItemsTable.id));
  return rows.map(c => {
    const children = items.filter(i => i.item.compraId === c.id).map(({ item: i, tipo }) => ({
      ...i, cantidad: Number(i.cantidad), precioUnitario: Number(i.precioUnitario), subtotalLinea: Number(i.subtotalLinea),
      tipoProducto: tipo, costoAnterior: i.costoAnterior == null ? null : Number(i.costoAnterior),
    }));
    const { organizationId: _, usuarioId: __, siiXml: ___, ...rest } = c;
    return GetCompraResponse.parse({
      ...rest, subtotal: Number(c.subtotal), porcentajeIva: Number(c.porcentajeIva), montoIva: Number(c.montoIva), total: Number(c.total),
      items: children, itemsRecibidos: c.estado === "borrador" ? 0 : children.filter(i => i.tipoProducto === "producto").length,
      puedeRecibir: puedeRecibirCompra(ctx), createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    });
  });
}
export async function guardarCompra(userId: string, input: unknown, id?: number) {
  const d = compraInput.parse(input);
  const { ctx, condition: productScope } = await inventarioScope(userId);
  const prefs = await getPreferenciasNegocio(userId);
  return db.transaction(async tx => {
    await lockInventoryScope(tx, ctx, userId);
    const original = id ? (await compraPorId(userId, id, tx, true)).c : undefined;
    if (original && original.estado !== "borrador") throw new CompraError("Una compra recibida no se puede modificar.", 409);
    if (original && d.updatedAt !== original.updatedAt.toISOString()) throw new CompraError("La compra cambió. Recarga antes de guardar.", 409);
    if (original && original.moneda !== d.moneda) throw new CompraError("La moneda de la compra no se puede cambiar.");
    const p = await proveedorPorId(userId, d.proveedorId, tx);
    if (!p.activo) throw new CompraError("Selecciona un proveedor activo.");
    const duplicates = await tx.select().from(comprasTable).where(and(compraScope(ctx, userId), eq(comprasTable.proveedorId, p.id), eq(comprasTable.numeroFactura, d.numeroFactura)));
    if (duplicates.some(c => c.id !== id)) throw new CompraError("Ya existe esa factura para este proveedor.", 409);
    const dp = original?.decimales ?? prefs.decimales;
    const ids = [...new Set(d.items.flatMap(i => i.productoId ? [i.productoId] : []))];
    const products = ids.length ? await tx.select().from(productosTable).where(and(productScope, inArray(productosTable.id, ids))) : [];
    const warehouses = await scopedBodegas(userId, tx);
    const costs = new Map<number, number>();
    const items = d.items.map(i => {
      const product = products.find(p => p.id === i.productoId);
      if (i.productoId && (!product || !product.activo)) throw new CompraError("Producto no disponible.");
      if (product && product.moneda !== d.moneda) throw new CompraError(`La moneda de ${product.nombre} no coincide con la factura.`);
      if (i.bodegaDestinoId && !warehouses.some(w => w.bodega.id === i.bodegaDestinoId)) throw new CompraError("Bodega no disponible.");
      const price = roundMoney(i.precioUnitario, dp);
      if (i.productoId && costs.has(i.productoId) && costs.get(i.productoId) !== price) throw new CompraError("Un mismo producto debe tener el mismo precio de costo en todas las líneas.");
      if (i.productoId) costs.set(i.productoId, price);
      return {
        productoId: i.productoId ?? null, descripcion: i.descripcion, cantidad: String(i.cantidad),
        precioUnitario: String(price), subtotalLinea: String(roundMoney(price * i.cantidad, dp)),
        bodegaDestinoId: product?.tipo === "producto" ? i.bodegaDestinoId ?? null : null,
      };
    });
    const subtotal = roundMoney(items.reduce((sum, i) => sum + Number(i.subtotalLinea), 0), dp);
    const ivaPct = roundMoney(d.porcentajeIva, 2);
    const montoIva = roundMoney(subtotal * ivaPct / 100, dp), total = roundMoney(subtotal + montoIva, dp);
    if (!Number.isFinite(total) || total <= 0 || total >= 1e12) throw new CompraError("Total fuera de rango.");
    const values = { numeroFactura: d.numeroFactura, proveedorId: p.id, proveedorNombre: p.razonSocial,
      fechaEmision: d.fechaEmision, fechaRecepcion: d.fechaRecepcion, moneda: d.moneda, decimales: dp,
      subtotal: String(subtotal), porcentajeIva: String(ivaPct), montoIva: String(montoIva), total: String(total),
      notas: d.notas, updatedAt: new Date(Math.max(Date.now(), (original?.updatedAt.getTime() ?? 0) + 1)),
    };
    const [saved] = original ? await tx.update(comprasTable).set(values).where(eq(comprasTable.id, original.id)).returning()
      : await tx.insert(comprasTable).values({ ...values, organizationId: ctx.organizationId, usuarioId: userId }).returning();
    if (original) await tx.delete(compraItemsTable).where(eq(compraItemsTable.compraId, original.id));
    await tx.insert(compraItemsTable).values(items.map(i => ({ ...i, compraId: saved.id })));
    return (await serializeCompras([saved], ctx, tx))[0];
  });
}
