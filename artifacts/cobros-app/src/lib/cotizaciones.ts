import type { QueryClient } from "@tanstack/react-query";
import {
  downloadCotizacionPdf,
  getGetCotizacionQueryKey,
  getListCotizacionesQueryKey,
  getListCobrosQueryKey,
  type Cotizacion,
} from "@workspace/api-client-react";
import { roundTo } from "@/lib/format";

export type EstadoCotizacion = Cotizacion["estado"];

export const ESTADO_COTIZACION: Record<EstadoCotizacion, { label: string; className: string; dot: string }> = {
  borrador: { label: "Borrador", className: "bg-secondary text-foreground/80 border-border", dot: "bg-muted-foreground/60" },
  enviada: { label: "Enviada", className: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  aceptada: { label: "Aceptada", className: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  rechazada: { label: "Rechazada", className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900", dot: "bg-red-500" },
  vencida: { label: "Vencida", className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
};

export type LineaCot = {
  key: string;
  productoId: number | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  descuentoPorcentaje: string;
};

/** Line subtotal rounded to the document decimals. */
export function subtotalLinea(l: Pick<LineaCot, "cantidad" | "precioUnitario" | "descuentoPorcentaje">, dec: number) {
  const c = Number(l.cantidad) || 0;
  const p = Number(l.precioUnitario) || 0;
  const d = Math.min(100, Math.max(0, Number(l.descuentoPorcentaje) || 0));
  return roundTo(c * p * (1 - d / 100), dec);
}

/** Lines rounded first, then summed, then IVA on the rounded subtotal. */
export function totalesCot(lineas: LineaCot[], dec: number, ivaPct: number) {
  const subtotal = roundTo(lineas.reduce((s, l) => s + subtotalLinea(l, dec), 0), dec);
  const iva = roundTo((subtotal * ivaPct) / 100, dec);
  return { subtotal, iva, total: roundTo(subtotal + iva, dec) };
}

export function invalidateCotizaciones(qc: QueryClient, id?: number) {
  qc.invalidateQueries({ queryKey: getListCotizacionesQueryKey() });
  if (id) qc.invalidateQueries({ queryKey: getGetCotizacionQueryKey(id) });
}

export function invalidateCobrosTrasConversion(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: getListCobrosQueryKey() });
}

export async function descargarPdfCotizacion(c: Pick<Cotizacion, "id" | "numeroCotizacion">) {
  const blob = await downloadCotizacionPdf(c.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${c.numeroCotizacion || `cotizacion-${c.id}`}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
