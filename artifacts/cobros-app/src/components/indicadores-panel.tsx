import { AlertTriangle, ArrowDown, ArrowUp, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/inventario";
import { useIndicadores, useSincronizarIndicadores, indicadorPorCodigo, fmtCLP, fmtPct, fmtFechaCorta, fmtFechaHora, esObsoleto } from "@/hooks/use-indicadores";

const ORDEN = [
  { codigo: "uf", label: "UF", dec: 2 },
  { codigo: "dolar", label: "Dólar observado", dec: 2 },
  { codigo: "euro", label: "Euro", dec: 2 },
  { codigo: "utm", label: "UTM", dec: 0 },
  { codigo: "ivp", label: "IVP", dec: 2 },
] as const;

export function IndicadoresPanel() {
  const q = useIndicadores();
  const sync = useSincronizarIndicadores();
  const data = q.data;
  const latest = data?.reduce<string | null>((a, i) => (!a || i.updatedAt > a ? i.updatedAt : a), null) ?? null;

  return (
    <div className="space-y-3" data-testid="panel-indicadores">
      {q.isLoading ? (
        <div className="space-y-2">{ORDEN.map((o) => <div key={o.codigo} className="h-9 rounded-md bg-muted animate-pulse" />)}</div>
      ) : q.isError && !data ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />No se pudieron cargar los indicadores.</span>
          <Button size="sm" variant="ghost" onClick={() => q.refetch()} data-testid="button-reintentar-indicadores">Reintentar</Button>
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {ORDEN.map((o) => {
            const ind = indicadorPorCodigo(data, o.codigo);
            return (
              <div key={o.codigo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`row-indicador-${o.codigo}`}>
                <div className="min-w-0">
                  <p className="font-medium">{o.label}</p>
                  <p className="text-[11px] text-muted-foreground">{ind ? `Valor al ${fmtFechaCorta(ind.fecha)}` : "Sin dato sincronizado"}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono tabular-nums">{ind ? fmtCLP(ind.valor, o.dec) : "—"}</p>
                  {ind?.variacion != null && ind.variacion !== 0 && (
                    <p className={`inline-flex items-center text-[11px] font-mono ${ind.variacion > 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {ind.variacion > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{fmtPct(ind.variacion)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${latest && esObsoleto(latest) ? "text-amber-700" : "text-muted-foreground"}`} data-testid="text-ultima-sincronizacion">
          {latest ? `Última sincronización: ${fmtFechaHora(latest)}${esObsoleto(latest) ? " (desactualizado)" : ""}` : "Sin sincronizaciones registradas"}
        </p>
        <Button type="button" size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()} data-testid="button-sincronizar-indicadores">
          {sync.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          {sync.isPending ? "Actualizando..." : "Actualizar ahora"}
        </Button>
      </div>
      {sync.isError && <p className="text-xs text-destructive" role="alert" data-testid="text-error-sincronizar">No se pudo actualizar: {apiErrorMessage(sync.error, "intenta nuevamente en unos minutos.")}</p>}
    </div>
  );
}
