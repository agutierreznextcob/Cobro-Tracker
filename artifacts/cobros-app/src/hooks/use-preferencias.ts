import { useGetPreferencias, getGetPreferenciasQueryKey, type Preferencias } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";

export const PREFERENCIAS_DEFAULT: Preferencias = {
  moneda: "CLP",
  decimales: 0,
  porcentajeIva: 19,
  formatoFecha: "DD/MM/YYYY",
  prefijoCobro: "COB-",
  prefijoCotizacion: "COT-",
};

/**
 * Shared org preferences query. The key is scoped by user id so a different
 * session in the same tab never sees cached preferences of a previous user;
 * invalidating getGetPreferenciasQueryKey() still matches by prefix.
 */
export function usePreferencias(opts?: { enabled?: boolean }) {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const q = useGetPreferencias({
    query: {
      queryKey: [...getGetPreferenciasQueryKey(), uid],
      enabled: !!user && (opts?.enabled ?? true),
      staleTime: 30_000,
      refetchOnMount: "always",
    },
  });
  return { ...q, prefs: q.data ?? PREFERENCIAS_DEFAULT, listo: !!q.data };
}

/** Global monetary precision (0, 1 or 2) for NEW documents and inventory. */
export function decimalesPref(p: Pick<Preferencias, "decimales"> | null | undefined): number {
  const d = Number(p?.decimales);
  return d === 1 || d === 2 ? d : 0;
}
