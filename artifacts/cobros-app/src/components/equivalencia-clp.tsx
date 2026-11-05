import { roundTo } from "@/lib/format";
import { AlertTriangle, ArrowRightLeft } from "lucide-react";
import { useIndicadores, MONEDA_A_INDICADOR, indicadorPorCodigo, fechaChile, hoyChile, fmtFechaCorta, fmtCLP } from "@/hooks/use-indicadores";

interface Props {
  monto: number;
  /** CLP precision: current preference for new documents, stored precision for existing ones. */
  decimales?: number;
  moneda: string;
  className?: string;
  compact?: boolean;
  testId?: string;
}

/**
 * Informative CLP equivalence for UF/USD/EUR amounts using DB-cached indicators.
 * Never alters the document's currency or amount.
 */
export function EquivalenciaCLP({ monto, moneda, decimales = 0, className = "", compact = false, testId = "equivalencia-clp" }: Props) {
  const codigo = MONEDA_A_INDICADOR[moneda];
  const q = useIndicadores();
  if (!codigo) return null;

  const base = `rounded-md border text-xs ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} ${className}`;

  if (q.isLoading) {
    return <div className={`${base} border-border/60 bg-muted/40`} data-testid={`${testId}-loading`}><div className="h-3.5 w-40 rounded bg-muted animate-pulse" /></div>;
  }
  const ind = indicadorPorCodigo(q.data, codigo);
  if (!ind || !(ind.valor > 0)) {
    return (
      <div className={`${base} border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 flex items-start gap-1.5`} data-testid={`${testId}-unavailable`}>
        <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
        <span>Equivalencia en CLP no disponible: no hay valor de {moneda} sincronizado{q.isError ? " (error al consultar indicadores)" : ""}.</span>
      </div>
    );
  }
  const clp = monto * ind.valor;
  const esHoy = fechaChile(ind.fecha) === hoyChile();
  return (
    <div className={`${base} border-primary/15 bg-primary/[0.04] space-y-0.5`} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground"><ArrowRightLeft className="h-3 w-3" />Equivalente CLP</span>
        <span className="font-mono font-semibold tabular-nums text-foreground" data-testid={`${testId}-valor`}>≈ {fmtCLP(roundTo(clp, decimales), decimales)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        1 {moneda} = {fmtCLP(ind.valor)} · {esHoy ? "valor del día" : `observación del ${fmtFechaCorta(ind.fecha)}`} ({fmtFechaCorta(ind.fecha)}). Referencial: el documento se mantiene en {moneda}.
      </p>
    </div>
  );
}
