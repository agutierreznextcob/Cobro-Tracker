import { db, productosTable, type Producto, type ItemInventarioSnapshot } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getOrgContext } from "./org";

const money = z.number().finite().min(0).max(1e10).multipleOf(0.01);
const units = z.number().finite().min(0).max(1e9).multipleOf(0.001);
export const productoBody = z.object({
  nombre: z.string().trim().min(1).max(200),
  descripcion: z.string().max(5000).default(""),
  tipo: z.enum(["producto", "servicio"]),
  costoUnitario: money, precioUnitario: money,
  margenPorcentaje: z.number().finite().min(-1000000).max(1000000).default(0),
  metodoCalculo: z.enum(["margen", "recargo"]).default("margen"),
  stockActual: units.nullable().optional(),
  stockCritico: units.default(0),
  unidadMedida: z.string().trim().min(1).max(40).default("unidad"),
  activo: z.boolean().default(true),
  tarifaHora: money.nullable().optional(),
  tiempoEstimadoHoras: units.nullable().optional(),
  factorFactibilidad: z.number().min(1).max(2).multipleOf(0.001).nullable().optional(),
}).superRefine((d, ctx) => {
  if (d.tipo === "servicio" && (d.tarifaHora == null || d.tiempoEstimadoHoras == null || d.factorFactibilidad == null)) {
    ctx.addIssue({ code: "custom", message: "Completa tarifa, tiempo y factor del servicio." });
  }
  if (d.tipo === "producto" && d.metodoCalculo === "margen" && d.margenPorcentaje >= 100) {
    ctx.addIssue({ code: "custom", message: "El margen sobre venta debe ser menor a 100%." });
  }
  if (d.tipo === "servicio" && (d.tarifaHora ?? 0) * (d.tiempoEstimadoHoras ?? 0) * (d.factorFactibilidad ?? 1) > 1e12) {
    ctx.addIssue({ code: "custom", message: "El precio calculado excede el máximo permitido." });
  }
});
export const movimientoBody = z.object({
  tipo: z.enum(["entrada", "salida", "ajuste"]),
  cantidad: units,
  motivo: z.string().trim().min(1).max(1000),
}).refine(d => d.tipo === "ajuste" || d.cantidad > 0, "La cantidad debe ser mayor a cero.");

export const itemsInventarioBody = z.array(z.object({
  productoId: z.number().int().positive(),
  cantidad: units.refine(n => n > 0),
  precioUnitario: money,
  nombre: z.string().optional(), tipo: z.enum(["producto", "servicio"]).optional(),
})).max(100).default([]);

export async function inventarioScope(userId: string) {
  const ctx = await getOrgContext(userId);
  return {
    ctx,
    condition: ctx.organizationId != null
      ? eq(productosTable.organizationId, ctx.organizationId)
      : and(isNull(productosTable.organizationId), eq(productosTable.usuarioId, userId))!,
  };
}

export function productoValues(d: z.infer<typeof productoBody>) {
  const service = d.tipo === "servicio";
  const base = service ? d.tarifaHora! * d.tiempoEstimadoHoras! : d.costoUnitario;
  const calculated = service ? base * d.factorFactibilidad!
    : d.metodoCalculo === "margen" ? base / (1 - d.margenPorcentaje / 100)
    : base * (1 + d.margenPorcentaje / 100);
  if (!Number.isFinite(calculated) || calculated < 0 || calculated > 1e12) throw new Error("Precio sugerido fuera de rango.");
  return {
    nombre: d.nombre, descripcion: d.descripcion, tipo: d.tipo,
    costoUnitario: String(service ? Math.round(base * 100) / 100 : d.costoUnitario),
    precioUnitario: String(d.precioUnitario), margenPorcentaje: String(d.margenPorcentaje),
    metodoCalculo: d.metodoCalculo, stockActual: service ? null : String(d.stockActual ?? 0),
    stockCritico: service ? "0" : String(d.stockCritico), unidadMedida: d.unidadMedida, activo: d.activo,
    tarifaHora: service ? String(d.tarifaHora) : null,
    tiempoEstimadoHoras: service ? String(d.tiempoEstimadoHoras) : null,
    factorFactibilidad: service ? String(d.factorFactibilidad) : null,
    precioCalculado: String(Math.round(calculated)),
  };
}

export function serializeProducto(p: Producto) {
  const costo = Number(p.costoUnitario), precio = Number(p.precioUnitario);
  const stock = p.stockActual == null ? null : Number(p.stockActual);
  return {
    ...p, costoUnitario: costo, precioUnitario: precio,
    margenPorcentaje: Number(p.margenPorcentaje),
    stockActual: stock, stockCritico: Number(p.stockCritico),
    tarifaHora: p.tarifaHora == null ? null : Number(p.tarifaHora),
    tiempoEstimadoHoras: p.tiempoEstimadoHoras == null ? null : Number(p.tiempoEstimadoHoras),
    factorFactibilidad: p.factorFactibilidad == null ? null : Number(p.factorFactibilidad),
    precioCalculado: p.precioCalculado == null ? null : Number(p.precioCalculado),
    utilidad: precio - costo, margenReal: precio > 0 ? ((precio - costo) / precio) * 100 : 0,
    estadoStock: stock == null ? "no_aplica" : stock <= 0 ? "agotado" : stock <= Number(p.stockCritico) ? "critico" : "normal",
    creadoEn: p.creadoEn.toISOString(), actualizadoEn: p.actualizadoEn.toISOString(),
  };
}

export async function resolveItemsInventario(userId: string, input: unknown, monto: unknown): Promise<ItemInventarioSnapshot[]> {
  const items = itemsInventarioBody.parse(input);
  if (!items.length) return [];
  const ids = items.map(i => i.productoId);
  if (new Set(ids).size !== ids.length) throw new Error("No repitas un producto; modifica su cantidad.");
  const { condition } = await inventarioScope(userId);
  const rows = await db.select().from(productosTable).where(and(condition, inArray(productosTable.id, ids), eq(productosTable.activo, true)));
  if (rows.length !== ids.length) throw new Error("Uno o más productos no están disponibles en tu catálogo.");
  const total = Math.round(items.reduce((sum, i) => sum + i.cantidad * i.precioUnitario, 0));
  if (total !== Number(monto)) throw new Error("El monto debe coincidir con la suma de los ítems del catálogo (antes de IVA).");
  return items.map(i => {
    const p = rows.find(p => p.id === i.productoId)!;
    return { ...i, nombre: p.nombre, tipo: p.tipo };
  });
}
