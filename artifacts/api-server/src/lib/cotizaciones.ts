import { db, cotizacionesTable, cotizacionItemsTable, clientesTable, productosTable, type Cotizacion } from "@workspace/db";
import { and, eq, inArray, desc, type SQL } from "drizzle-orm";
import { CreateCotizacionBody } from "@workspace/api-zod";
import { clienteScopeCondition, getOrgContext, type OrgContext } from "./org";
import { inventarioScope } from "./inventario";
import { hoySantiago, roundMoney, getPreferenciasNegocio } from "./preferencias";
import { getEmpresaForUser } from "./empresa";

export class CotizacionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function cotizacionScope(ctx: OrgContext, userId: string): SQL {
  if (ctx.isOrgAdmin && ctx.organizationId != null) return eq(cotizacionesTable.organizationId, ctx.organizationId);
  if (ctx.isSupervisor && ctx.organizationId != null) return and(
    eq(cotizacionesTable.organizationId, ctx.organizationId),
    inArray(cotizacionesTable.responsableId, ctx.teamMemberIds.length ? ctx.teamMemberIds : [userId]),
  )!;
  return eq(cotizacionesTable.responsableId, userId);
}
export function estadoCotizacion(q: Cotizacion) {
  return ["borrador", "enviada"].includes(q.estado) && q.fechaVencimiento < hoySantiago() ? "vencida" : q.estado;
}
function diasValidez(emision: string, vencimiento: string) {
  // Existing quotes predate the conditions fields. Their recorded expiry is
  // authoritative; the new default must not label every historical quote 30d.
  return Math.max(1, Math.round((Date.parse(vencimiento) - Date.parse(emision)) / 86_400_000));
}
export async function serializeCotizacion(q: Cotizacion) {
  const items = await db.select().from(cotizacionItemsTable).where(eq(cotizacionItemsTable.cotizacionId, q.id)).orderBy(cotizacionItemsTable.id);
  const { envioEnCurso: _claim, envioPdf: _archivo, ...publicRow } = q;
  return {
    ...publicRow, pdfEnviadoDisponible: !!(q.enviadoEn && q.envioPdf), envioPendiente: !!(q.envioPdf && !q.enviadoEn),
    estado: estadoCotizacion(q), validezDias: diasValidez(q.fechaEmision, q.fechaVencimiento),
    subtotal: Number(q.subtotal), porcentajeIva: Number(q.porcentajeIva), montoIva: Number(q.montoIva), total: Number(q.total),
    items: items.map(i => ({ ...i, cantidad: Number(i.cantidad), precioUnitario: Number(i.precioUnitario), descuentoPorcentaje: Number(i.descuentoPorcentaje), subtotalLinea: Number(i.subtotalLinea) })),
  };
}
export async function getScopedCotizacion(userId: string, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new CotizacionError("Cotización no encontrada.", 404);
  const ctx = await getOrgContext(userId);
  const condition = and(cotizacionScope(ctx, userId), eq(cotizacionesTable.id, id))!;
  const [q] = await db.select().from(cotizacionesTable).where(condition);
  if (!q) throw new CotizacionError("Cotización no encontrada.", 404);
  return { q, ctx, condition };
}
export async function cotizacionValues(userId: string, input: unknown, precisionExistente?: number) {
  const parsed = CreateCotizacionBody.safeParse(input);
  if (!parsed.success) throw new CotizacionError("Revisa los datos de la cotización.");
  const data = parsed.data;
  const empresa = await getEmpresaForUser(userId);
  data.decimales = precisionExistente ?? (await getPreferenciasNegocio(userId)).decimales;
  for (const day of [data.fechaEmision, data.fechaVencimiento]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
      throw new CotizacionError("La fecha no es válida.");
    }
  }
  if (data.fechaVencimiento < data.fechaEmision) throw new CotizacionError("El vencimiento debe ser igual o posterior a la emisión.");
  if (!Number.isInteger(data.clienteId) || !data.items.length || data.items.length > 100) throw new CotizacionError("Selecciona un cliente y al menos un ítem.");
  const ctx = await getOrgContext(userId);
  const [cliente] = await db.select().from(clientesTable).where(and(clienteScopeCondition(ctx, userId), eq(clientesTable.id, data.clienteId)));
  if (!cliente) throw new CotizacionError("Cliente no encontrado.", 404);
  const { condition } = await inventarioScope(userId);
  const ids = [...new Set(data.items.flatMap(i => i.productoId == null ? [] : [i.productoId]))];
  const productos = ids.length ? await db.select().from(productosTable).where(and(condition, inArray(productosTable.id, ids), eq(productosTable.activo, true))) : [];
  if (productos.length !== ids.length) throw new CotizacionError("Uno o más productos no están disponibles en tu catálogo.");
  if (productos.some(p => p.moneda !== data.moneda)) throw new CotizacionError("La moneda del catálogo debe coincidir con la cotización. No se convierten precios automáticamente.");
  const items = data.items.map(i => {
    if (![i.cantidad, i.precioUnitario, i.descuentoPorcentaje].every(Number.isFinite) ||
      i.cantidad <= 0 || i.cantidad > 1e9 || Math.abs(i.cantidad * 1000 - Math.round(i.cantidad * 1000)) > 1e-5 ||
      i.precioUnitario > 1e9 || i.precioUnitario < 0 || Math.abs(i.precioUnitario * 100 - Math.round(i.precioUnitario * 100)) > 1e-5 ||
      i.descuentoPorcentaje < 0 || i.descuentoPorcentaje > 100 || !i.descripcion.trim()) {
      throw new CotizacionError("Cantidades, precios o descuentos inválidos. Cantidades: hasta 3 decimales; precios: hasta 2.");
    }
    const precio = precisionExistente == null ? roundMoney(i.precioUnitario, data.decimales) : i.precioUnitario;
    const subtotalLinea = roundMoney(i.cantidad * precio * (1 - i.descuentoPorcentaje / 100), data.decimales);
    return { productoId: i.productoId ?? null, descripcion: i.descripcion.trim(), cantidad: String(i.cantidad), precioUnitario: String(precio), descuentoPorcentaje: String(i.descuentoPorcentaje), subtotalLinea: String(subtotalLinea) };
  });
  const subtotal = roundMoney(items.reduce((n, i) => n + Number(i.subtotalLinea), 0), data.decimales);
  const montoIva = roundMoney(subtotal * data.porcentajeIva / 100, data.decimales);
  const total = roundMoney(subtotal + montoIva, data.decimales);
  if (!Number.isFinite(total) || total <= 0 || total >= 1e10) throw new CotizacionError("El total debe ser mayor a cero y menor a 10.000 millones.");
  return { ctx, items, values: {
    clienteId: cliente.id, clienteNombre: cliente.nombre, clienteRut: cliente.rut,
    clienteEmail: cliente.email, clienteDireccion: cliente.direccion,
    clienteGiro: data.clienteGiro ?? cliente.giro ?? "",
    formaPago: data.formaPago ?? empresa.condicionesPago,
    tiempoEntrega: data.tiempoEntrega ?? "",
    validezDias: diasValidez(data.fechaEmision, data.fechaVencimiento),
    fechaEmision: data.fechaEmision, fechaVencimiento: data.fechaVencimiento,
    moneda: data.moneda, decimales: data.decimales, porcentajeIva: String(data.porcentajeIva),
    subtotal: String(subtotal), montoIva: String(montoIva), total: String(total), notas: data.notas,
    areaId: (data as unknown as { areaId?: number }).areaId ?? null,
  } };
}
