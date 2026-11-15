import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@/lib/format";

// --- Tipos ---
export type EstadoGuia = "emitida" | "en_despacho" | "entregada" | "anulada";

export interface GuiaItem {
  id: number;
  guiaId: number;
  productoId: number | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  subtotalLinea: string;
}

export interface GuiaDespacho {
  id: number;
  numeroGuia: string;
  organizationId: number | null;
  responsableId: string;
  clienteId: number;
  clienteNombre: string;
  clienteRut: string | null;
  clienteDireccion: string | null;
  pedidoId: number | null;
  estado: EstadoGuia;
  fechaEmision: string;
  transportista: string;
  patenteVehiculo: string;
  chofer: string;
  direccionOrigen: string;
  direccionDestino: string;
  moneda: string;
  decimales: number;
  subtotal: string;
  porcentajeIva: string;
  montoIva: string;
  total: string;
  observaciones: string;
  creadoEn: string;
  actualizadoEn: string;
  items: GuiaItem[];
}

// --- Fetch helpers ---
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Error ${res.status}`);
  }
  return res.json();
}

// --- Query keys ---
export const GUIAS_KEY = ["guias-despacho"] as const;
export const guiaKey = (id: number) => ["guia-despacho", id] as const;

// --- Hooks ---
export function useListGuias() {
  return useQuery({
    queryKey: GUIAS_KEY,
    queryFn: () => apiFetch<GuiaDespacho[]>("/api/guias-despacho"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30000,
  });
}

export function useGetGuia(id: number) {
  return useQuery({
    queryKey: guiaKey(id),
    queryFn: () => apiFetch<GuiaDespacho>(`/api/guias-despacho/${id}`),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useEmitirGuiaDesdePedido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pedidoId, body }: { pedidoId: number; body?: Record<string, string> }) =>
      apiFetch<GuiaDespacho>(`/api/guias-despacho/from-pedido/${pedidoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: GUIAS_KEY });
      qc.setQueryData(guiaKey(g.id), g);
    },
  });
}

export function useCambiarEstadoGuia(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (estado: EstadoGuia) =>
      apiFetch<GuiaDespacho>(`/api/guias-despacho/${id}/estado`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      }),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: GUIAS_KEY });
      qc.setQueryData(guiaKey(id), g);
    },
  });
}

// --- Estado helpers ---
export const ESTADO_GUIA: Record<EstadoGuia, { label: string; className: string; dot: string }> = {
  emitida:     { label: "Emitida",      className: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900",         dot: "bg-sky-500" },
  en_despacho: { label: "En despacho",  className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  entregada:   { label: "Entregada",    className: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  anulada:     { label: "Anulada",      className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",           dot: "bg-red-500" },
};

export function formatTotalGuia(guia: GuiaDespacho) {
  return formatMoney(Number(guia.total), guia.moneda, guia.decimales);
}
