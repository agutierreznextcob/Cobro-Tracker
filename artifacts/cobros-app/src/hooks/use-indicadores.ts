import { useQueryClient } from "@tanstack/react-query";
import {
  useListIndicadores,
  useSyncIndicadores,
  getListIndicadoresQueryKey,
  type IndicadorEconomico,
} from "@workspace/api-client-react";

export const INDICADORES_POLL_MS = 5 * 60 * 1000;

/** Shared indicators query: DB-cached values only, polled every 5 min. */
export function useIndicadores() {
  return useListIndicadores({
    query: {
      queryKey: getListIndicadoresQueryKey(),
      refetchInterval: INDICADORES_POLL_MS,
      refetchOnMount: true,
      staleTime: 60 * 1000,
    },
  });
}

export function useSincronizarIndicadores() {
  const qc = useQueryClient();
  return useSyncIndicadores({
    mutation: {
      onSuccess: (data) => {
        if (Array.isArray(data)) qc.setQueryData(getListIndicadoresQueryKey(), data);
        qc.invalidateQueries({ queryKey: getListIndicadoresQueryKey() });
      },
    },
  });
}

export const MONEDA_A_INDICADOR: Record<string, IndicadorEconomico["codigo"] | undefined> = {
  UF: "uf",
  USD: "dolar",
  EUR: "euro",
};

export function indicadorPorCodigo(list: IndicadorEconomico[] | undefined, codigo: string) {
  return list?.find((i) => i.codigo === codigo);
}

const TZ = "America/Santiago";
export function hoyChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
/** Normalize an ISO date/datetime to YYYY-MM-DD in Chile. */
export function fechaChile(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}
export function fmtFechaCorta(s: string): string {
  const [y, m, d] = fechaChile(s).split("-");
  return `${d}/${m}/${y}`;
}
export function fmtFechaHora(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}
export function fmtCLP(n: number, dec = 2): string {
  return "$" + n.toLocaleString("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function fmtPct(n: number): string {
  return Math.abs(n).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + "%";
}
/** Considered stale when observation is older than ~4 days (weekends keep previous). */
export function esObsoleto(updatedAt: string): boolean {
  const t = new Date(updatedAt).getTime();
  return isNaN(t) || Date.now() - t > 4 * 24 * 3600 * 1000;
}
