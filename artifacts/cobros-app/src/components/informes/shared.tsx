import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { AlertTriangle, Download, Inbox, Loader2, RefreshCcw } from "lucide-react";
import type { GetInformeAreaParams } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, MONEDAS, type Moneda } from "@/lib/format";

export type Periodo = NonNullable<GetInformeAreaParams["periodo"]>;

export const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "7dias", label: "Últimos 7 días" },
  { value: "mes", label: "Este mes" },
  { value: "trimestre", label: "Este trimestre" },
  { value: "ano", label: "Este año" },
  { value: "todo", label: "Todo el tiempo" },
];

/** Single accessible chart color (Atta palette primary blue). */
export const CHART_COLOR = "#1F74AD";

export function money(v: number, moneda: string) {
  return formatMoney(v, moneda);
}

export function compactMoney(v: number, moneda: string) {
  const abs = Math.abs(v);
  const sym = moneda === "CLP" ? "$" : moneda === "UF" ? "UF " : `${moneda} `;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sym}${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sym}${v.toFixed(moneda === "CLP" ? 0 : 2)}`;
}

export function fmtNum(v: number, dec = 0) {
  return v.toLocaleString("es-CL", { maximumFractionDigits: dec, minimumFractionDigits: 0 });
}

export function fechaCorta(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function FiltroPeriodo({ value, onChange }: { value: Periodo; onChange: (p: Periodo) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Periodo)}>
      <SelectTrigger className="w-[170px] h-9" data-testid="select-periodo"><SelectValue /></SelectTrigger>
      <SelectContent>
        {PERIODOS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function FiltroMoneda({ value, onChange }: { value: Moneda; onChange: (m: Moneda) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Moneda)}>
      <SelectTrigger className="w-[100px] h-9" data-testid="select-moneda"><SelectValue /></SelectTrigger>
      <SelectContent>
        {MONEDAS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export type Sheet = { name: string; rows: Record<string, unknown>[]; cols?: number[] };

export async function descargarXlsx(base: string, sheets: Sheet[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = s.rows.length ? XLSX.utils.json_to_sheet(s.rows) : XLSX.utils.aoa_to_sheet([["Sin datos para los filtros seleccionados"]]);
    if (s.cols) ws["!cols"] = s.cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${base}-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function BotonExcel({
  onExport,
  disabled,
  disabledReason,
  label = "Descargar Excel",
  testId = "button-descargar-excel",
}: {
  onExport: () => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  label?: string;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onExport();
    } catch {
      setError("No se pudo generar el Excel. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={run} disabled={disabled || busy} className="gap-2" size="sm" data-testid={testId} title={disabled ? disabledReason : undefined}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {busy ? "Preparando Excel…" : label}
      </Button>
      {disabled && disabledReason && <span className="text-[11px] text-muted-foreground">{disabledReason}</span>}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function SkeletonReporte() {
  return (
    <div className="space-y-4 animate-pulse" data-testid="skeleton-informe">
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-lg bg-muted" />)}
      </div>
      <div className="h-64 rounded-lg bg-muted" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 rounded bg-muted/70" />)}
      </div>
    </div>
  );
}

export function ErrorReporte({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="p-8 text-center space-y-3" data-testid="error-informe">
      <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
      <p className="font-medium">No pudimos cargar este informe.</p>
      <p className="text-sm text-muted-foreground">Puede ser un problema de conexión o el servidor aún está procesando.</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-2" data-testid="button-reintentar">
        <RefreshCcw className="h-4 w-4" /> Reintentar
      </Button>
    </Card>
  );
}

export function VacioReporte({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="empty-informe">
      <div className="h-11 w-11 rounded-full bg-secondary flex items-center justify-center mb-3">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="font-medium text-sm">{titulo}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{detalle}</p>
    </div>
  );
}

export function NotaInforme({ desde, hasta, moneda, notas }: { desde: string; hasta: string; moneda?: string; notas: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-secondary/40 px-4 py-3 text-xs text-muted-foreground space-y-1" data-testid="text-notas-informe">
      <p>
        <span className="font-medium text-foreground">Período:</span> {fechaCorta(desde)} – {fechaCorta(hasta)}
        {moneda && <> · <span className="font-medium text-foreground">Moneda:</span> {moneda} (no se mezclan monedas)</>}
      </p>
      {notas && <p className="whitespace-pre-line">{notas}</p>}
    </div>
  );
}

export function KpiCard({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "warn" }) {
  return (
    <Card className={`p-5 ${tone === "warn" ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}
