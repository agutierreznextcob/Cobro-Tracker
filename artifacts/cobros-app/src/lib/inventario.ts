import type { QueryClient } from "@tanstack/react-query";
import {
  getListInventarioQueryKey,
  getGetInventarioResumenQueryKey,
  getGetProductoQueryKey,
  getListMovimientosStockQueryKey,
  getListHistorialCostosQueryKey,
  type Producto,
  type StockUbicacion,
} from "@workspace/api-client-react";

export const UNIDADES_PRODUCTO = ["unidad", "par", "docena", "caja", "paquete", "kilogramo", "gramo", "litro", "mililitro", "metro", "metro cuadrado", "metro cúbico"] as const;
export const UNIDADES_SERVICIO = ["hora", "día", "semana", "mes", "visita", "proyecto", "consulta"] as const;

export function unidadesPara(tipo: "producto" | "servicio"): readonly string[] {
  return tipo === "producto" ? UNIDADES_PRODUCTO : UNIDADES_SERVICIO;
}

export const capitalizar = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const MOTIVO_ENTRE_BODEGAS = "Movimiento entre bodegas";
export const MOTIVO_AJUSTE = "Ajuste de inventario";
export const MOTIVO_COBRO = "Cobro";

export const MOTIVOS_ENTRADA = ["Ingreso por compra", MOTIVO_ENTRE_BODEGAS, "Parte de entrada", MOTIVO_AJUSTE, "Devolución de cliente"] as const;
/** "Cobro" is assigned automatically by the server when a paid charge deducts stock; never manually selectable. */
export const MOTIVOS_SALIDA = ["Merma", "Consumo interno", "Rebaja de stock", MOTIVO_ENTRE_BODEGAS] as const;

export const CODIGO_RE = /^[A-Za-z0-9-]*$/;

export function ubicacionCritica(u: StockUbicacion) {
  return u.stockActual <= 0 || u.stockActual <= u.stockCritico;
}

export function etiquetaUbicacion(u: Pick<StockUbicacion, "localNombre" | "bodegaNombre">) {
  return `${u.localNombre} → ${u.bodegaNombre}`;
}

/** Exact (trimmed, case-insensitive) match on barcode, SKU or internal code. */
export function buscarPorCodigo(productos: Producto[], code: string): Producto[] {
  const c = code.trim().toLowerCase();
  if (!c) return [];
  const eq = (v?: string | null) => !!v && v.trim().toLowerCase() === c;
  return productos.filter((p) => eq(p.codigoBarras) || eq(p.sku) || eq(p.codigoInterno));
}

export type MetodoCalculo = "margen" | "recargo";

/** Suggested price from cost and percentage. Returns null when not computable. */
const redondear = (n: number, d: number) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };

export function precioSugerido(costo: number, pct: number, metodo: MetodoCalculo, decimales = 0): number | null {
  if (!Number.isFinite(costo) || !Number.isFinite(pct) || costo < 0 || pct < 0) return null;
  if (metodo === "margen") {
    if (pct >= 100) return null;
    return redondear(costo / (1 - pct / 100), decimales);
  }
  return redondear(costo * (1 + pct / 100), decimales);
}

export function utilidadDe(costo: number, precio: number) {
  const utilidad = precio - costo;
  const margen = precio > 0 ? (utilidad / precio) * 100 : 0;
  const recargo = costo > 0 ? (utilidad / costo) * 100 : 0;
  return { utilidad, margen, recargo };
}

export function precioServicio(tarifa: number, horas: number, factor: number, decimales = 0) {
  if (![tarifa, horas, factor].every(Number.isFinite)) return 0;
  return redondear(tarifa * horas * factor, decimales);
}

export function formatPct(n: number) {
  return `${n.toLocaleString("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

export function formatQty(n: number) {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 3 });
}

export type EstadoVisual = "servicio" | "normal" | "critico" | "agotado" | "archivado";

export function estadoVisual(p: Producto): EstadoVisual {
  if (!p.activo) return "archivado";
  if (p.tipo === "servicio") return "servicio";
  const stock = p.stockActual ?? 0;
  if (stock <= 0) return "agotado";
  if ((p.ubicaciones ?? []).length > 0) return p.ubicaciones!.some(ubicacionCritica) ? "critico" : "normal";
  if (stock <= (p.stockCritico ?? 0)) return "critico";
  return "normal";
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string; message?: string } } | null)?.data;
  return data?.error || data?.message || fallback;
}

/** Stock-related keys: inventario list/resumen/producto/movimientos plus locales and bodegas (list and detail). */
const STOCK_KEY_RE = /^\/api\/(inventario|locales|bodegas)/;

export function invalidateInventario(qc: QueryClient, id?: number) {
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && STOCK_KEY_RE.test(q.queryKey[0] as string) });
  qc.invalidateQueries({ queryKey: getListInventarioQueryKey() });
  qc.invalidateQueries({ queryKey: getGetInventarioResumenQueryKey() });
  if (id) {
    qc.invalidateQueries({ queryKey: getGetProductoQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListMovimientosStockQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListHistorialCostosQueryKey(id) });
  }
}

/** Bell notifications (list and unread counters). */
export function invalidateNotificaciones(qc: QueryClient) {
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/notificaciones") });
}

/**
 * Net (tax-exclusive) unit price to use when a catalog item enters a NEW document line.
 * Products with incluyeIvaPrecio store a gross retail price; documents add IVA themselves,
 * so using the gross amount would charge IVA twice.
 */
export function precioNetoDe(p: Pick<Producto, "precioUnitario" | "precioUnitarioNeto" | "incluyeIvaPrecio" | "porcentajeIvaPrecio">): number {
  if (typeof p.precioUnitarioNeto === "number" && Number.isFinite(p.precioUnitarioNeto)) return p.precioUnitarioNeto;
  if (p.incluyeIvaPrecio) return p.precioUnitario / (1 + (p.porcentajeIvaPrecio ?? 19) / 100);
  return p.precioUnitario;
}

/** net -> IVA -> final, each step rounded to the global precision (mirrors the server). */
export function desgloseIva(neto: number, tasa: number, conIva: boolean, decimales = 0) {
  const n = redondear(neto, decimales);
  const iva = conIva ? redondear((n * tasa) / 100, decimales) : 0;
  return { neto: n, iva, final: redondear(n + iva, decimales) };
}

/** Net equivalent of a price (unrounded, used for margins). */
export function netoDesde(precio: number, tasa: number, incluyeIva: boolean) {
  return incluyeIva ? precio / (1 + tasa / 100) : precio;
}

export { redondear };
