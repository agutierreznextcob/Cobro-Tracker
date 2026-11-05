import type { QueryClient } from "@tanstack/react-query";
import {
  getListInventarioQueryKey,
  getGetInventarioResumenQueryKey,
  getGetProductoQueryKey,
  getListMovimientosStockQueryKey,
  type Producto,
} from "@workspace/api-client-react";

export type MetodoCalculo = "margen" | "recargo";

/** Suggested price from cost and percentage. Returns null when not computable. */
export function precioSugerido(costo: number, pct: number, metodo: MetodoCalculo): number | null {
  if (!Number.isFinite(costo) || !Number.isFinite(pct) || costo < 0 || pct < 0) return null;
  if (metodo === "margen") {
    if (pct >= 100) return null;
    return Math.round(costo / (1 - pct / 100));
  }
  return Math.round(costo * (1 + pct / 100));
}

export function utilidadDe(costo: number, precio: number) {
  const utilidad = precio - costo;
  const margen = precio > 0 ? (utilidad / precio) * 100 : 0;
  const recargo = costo > 0 ? (utilidad / costo) * 100 : 0;
  return { utilidad, margen, recargo };
}

export function precioServicio(tarifa: number, horas: number, factor: number) {
  if (![tarifa, horas, factor].every(Number.isFinite)) return 0;
  return Math.round(tarifa * horas * factor);
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
  if (stock <= (p.stockCritico ?? 0)) return "critico";
  return "normal";
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string; message?: string } } | null)?.data;
  return data?.error || data?.message || fallback;
}

export function invalidateInventario(qc: QueryClient, id?: number) {
  qc.invalidateQueries({ queryKey: getListInventarioQueryKey() });
  qc.invalidateQueries({ queryKey: getGetInventarioResumenQueryKey() });
  if (id) {
    qc.invalidateQueries({ queryKey: getGetProductoQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListMovimientosStockQueryKey(id) });
  }
}
