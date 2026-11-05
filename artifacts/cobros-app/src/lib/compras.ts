import type { QueryClient } from "@tanstack/react-query";
import type { CompraItemsItem } from "@workspace/api-client-react";
import { roundTo } from "@/lib/format";
import { invalidateInventario } from "@/lib/inventario";

export type EstadoCompra = "borrador" | "recibida" | "contabilizada";

export const ESTADO_COMPRA: Record<EstadoCompra, { label: string; className: string; dot: string }> = {
  borrador: { label: "Borrador", className: "border-slate-300 bg-slate-100 text-slate-700", dot: "bg-slate-500" },
  recibida: { label: "Recibida", className: "border-emerald-300 bg-emerald-50 text-emerald-800", dot: "bg-emerald-600" },
  contabilizada: { label: "Contabilizada", className: "border-sky-300 bg-sky-50 text-sky-800", dot: "bg-sky-600" },
};

export const ORIGEN_COMPRA: Record<string, string> = { manual: "Manual", sii: "SII", sii_futuro: "SII" };

export const SII_TOOLTIP = "Próximamente — requiere certificado digital SII";

/** Client-side hint only; the server's Compra.puedeRecibir is authoritative once a draft exists. */
export function puedeRecibirLocal(user: { organizationId?: number | null; orgRole?: string | null } | null | undefined) {
  if (!user) return false;
  if (!user.organizationId) return user.orgRole !== "ejecutivo";
  return user.orgRole === "admin_org" || user.orgRole === "supervisor";
}

export type LineaCompra = {
  key: string;
  productoId: number | null;
  tipoProducto: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  bodegaDestinoId: string;
};

let seq = 0;
export const nuevaKeyCompra = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export const lineaLibreCompra = (): LineaCompra => ({
  key: nuevaKeyCompra(), productoId: null, tipoProducto: null, descripcion: "", cantidad: "1", precioUnitario: "", bodegaDestinoId: "",
});

export const esFisico = (l: Pick<LineaCompra, "productoId" | "tipoProducto">) => l.productoId != null && l.tipoProducto !== "servicio";

export function subtotalLineaCompra(l: LineaCompra, d: number) {
  return roundTo((Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), d);
}

export function totalesCompra(lineas: LineaCompra[], d: number, ivaPct: number) {
  const subtotal = roundTo(lineas.reduce((s, l) => s + subtotalLineaCompra(l, d), 0), d);
  const iva = roundTo(subtotal * ivaPct / 100, d);
  return { subtotal, iva, total: roundTo(subtotal + iva, d) };
}

export function errorStatus(err: unknown): number | undefined {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status ?? e?.response?.status;
}

const RE = /^\/api\/(compras|proveedores)/;
export function invalidateCompras(qc: QueryClient, conStock = false) {
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && RE.test(q.queryKey[0] as string) });
  if (conStock) invalidateInventario(qc);
}

/** Compra = CompraInput & {...}: the generated intersection narrows items to the input shape; expose the full response item type. */
export const itemsDe = (c: { items: unknown }) => c.items as CompraItemsItem[];
