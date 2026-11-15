import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@/lib/format";

// --- Tipos ---
export type EstadoPedido = "pendiente" | "aprobado" | "despachado" | "cancelado";

export interface PedidoItem {
  id: number;
  pedidoId: number;
  productoId: number | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  subtotalLinea: string;
}

export interface Pedido {
  id: number;
  numeroPedido: string;
  organizationId: number | null;
  responsableId: string;
  clienteId: number;
  clienteNombre: string;
  clienteRut: string | null;
  clienteEmail: string | null;
  clienteDireccion: string | null;
  cotizacionId: number | null;
  estado: EstadoPedido;
  moneda: string;
  decimales: number;
  subtotal: string;
  porcentajeIva: string;
  montoIva: string;
  total: string;
  notas: string;
  notasLogistica: string;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  despachadorId: string | null;
  despachadoEn: string | null;
  guiaDespachoId: number | null;
  creadoEn: string;
  actualizadoEn: string;
  items: PedidoItem[];
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
export const PEDIDOS_KEY = ["pedidos"] as const;
export const pedidoKey = (id: number) => ["pedido", id] as const;

// --- Hooks ---
export function useListPedidos() {
  return useQuery({
    queryKey: PEDIDOS_KEY,
    queryFn: () => apiFetch<Pedido[]>("/api/pedidos"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30000,
  });
}

export function useGetPedido(id: number) {
  return useQuery({
    queryKey: pedidoKey(id),
    queryFn: () => apiFetch<Pedido>(`/api/pedidos/${id}`),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useCrearPedido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Pedido>("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY });
      qc.setQueryData(pedidoKey(p.id), p);
    },
  });
}

export function useActualizarPedido(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Pedido>(`/api/pedidos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY });
      qc.setQueryData(pedidoKey(id), p);
    },
  });
}

export function useCambiarEstadoPedido(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { estado: EstadoPedido; notasLogistica?: string }) =>
      apiFetch<Pedido>(`/api/pedidos/${id}/estado`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY });
      qc.setQueryData(pedidoKey(id), p);
    },
  });
}

export function useConvertirCotizacionAPedido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cotizacionId: number) =>
      apiFetch<Pedido>(`/api/pedidos/from-cotizacion/${cotizacionId}`, { method: "POST" }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY });
      qc.setQueryData(pedidoKey(p.id), p);
    },
  });
}

// --- Estado helpers ---
export const ESTADO_PEDIDO: Record<EstadoPedido, { label: string; className: string; dot: string }> = {
  pendiente: { label: "Pendiente", className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  aprobado: { label: "Aprobado", className: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  despachado: { label: "Despachado", className: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  cancelado: { label: "Cancelado", className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900", dot: "bg-red-500" },
};

export function estadoBadgePedido(estado: EstadoPedido) {
  return ESTADO_PEDIDO[estado];
}

export function formatTotalPedido(pedido: Pedido) {
  return formatMoney(Number(pedido.total), pedido.moneda, pedido.decimales);
}
