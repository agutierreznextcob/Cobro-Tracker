import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSavePreferencias, getGetPreferenciasQueryKey, type Preferencias } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import { usePreferencias, PREFERENCIAS_DEFAULT } from "@/hooks/use-preferencias";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { IndicadoresPanel } from "@/components/indicadores-panel";
import { formatMoney, formatFechaPref, hoySantiago, MONEDAS, MONEDA_INFO, type Moneda } from "@/lib/format";
import { apiErrorMessage } from "@/lib/inventario";
import { Info, Loader2, Lock, RotateCw, Save } from "lucide-react";

function Seccion({ titulo, desc, children }: { titulo: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 py-6 md:grid-cols-[240px_1fr] border-b last:border-b-0">
      <div>
        <p className="font-semibold text-sm">{titulo}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Segmento<T extends string | number>({ value, options, onChange, disabled, testId }: { value: T; options: Array<{ value: T; label: React.ReactNode }>; onChange: (v: T) => void; disabled?: boolean; testId: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border bg-muted/30 p-1 gap-1" role="radiogroup">
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            data-testid={`${testId}-${o.value}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${sel ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PreferenciasPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = usePreferencias();
  const save = useSavePreferencias();
  // Org members: only the org admin saves. Solo accounts (no org role) manage their own.
  const puedeGuardar = !user?.orgRole || user.orgRole === "admin_org";

  const [f, setF] = useState<Preferencias>(PREFERENCIAS_DEFAULT);
  const [iva, setIva] = useState("19");
  const init = useRef(false);
  useEffect(() => {
    if (!data || init.current) return;
    init.current = true;
    setF(data);
    setIva(String(data.porcentajeIva));
  }, [data]);

  const set = <K extends keyof Preferencias>(k: K, v: Preferencias[K]) => setF((p) => ({ ...p, [k]: v }));
  const ivaN = Number(iva);
  const ivaValido = iva.trim() !== "" && ivaN >= 0 && ivaN <= 100;
  const prefijoOk = (s: string) => s.trim().length >= 1 && s.trim().length <= 16;
  const valido = ivaValido && prefijoOk(f.prefijoCobro) && prefijoOk(f.prefijoCotizacion);
  const sucio = !!data && (JSON.stringify({ ...f, porcentajeIva: ivaN }) !== JSON.stringify(data));

  const guardar = () => {
    if (!valido || !puedeGuardar) return;
    const payload: Preferencias = { ...f, porcentajeIva: ivaN, prefijoCobro: f.prefijoCobro.trim(), prefijoCotizacion: f.prefijoCotizacion.trim() };
    save.mutate({ data: payload }, {
      onSuccess: (res) => {
        init.current = false;
        qc.invalidateQueries({ queryKey: getGetPreferenciasQueryKey() });
        setF(res ?? payload);
        toast({ title: "Preferencias guardadas", description: "Se aplicarán a los nuevos documentos." });
      },
      onError: (err) => toast({ title: "No se pudo guardar", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 w-56 bg-muted rounded" />
        <div className="h-[460px] bg-muted/60 rounded-xl" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No pudimos cargar las preferencias.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
      </div>
    );
  }

  const bloqueado = !puedeGuardar;
  const ejemplo = 1234567.891;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Configuración</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Preferencias</h1>
          <p className="text-muted-foreground mt-1">Valores por defecto para los documentos nuevos de tu cuenta.</p>
        </div>
        {puedeGuardar && (
          <Button onClick={guardar} disabled={!valido || !sucio || save.isPending} data-testid="button-guardar-preferencias">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Guardar cambios
          </Button>
        )}
      </div>

      {bloqueado && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200" data-testid="banner-solo-lectura">
          <Lock className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Solo el administrador de la organización puede cambiar estas preferencias. Las ves en modo lectura.</span>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-lg border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <span>Cada cobro, cotización y producto guarda su propia moneda. Cambiar la moneda aquí solo afecta a los documentos que crees desde ahora; los existentes conservan la suya (los históricos están en CLP). No se hacen conversiones de tipo de cambio.</span>
      </div>

      <Card className="px-5 sm:px-8 shadow-sm">
        <Seccion titulo="Moneda" desc="Moneda por defecto para cobros, cotizaciones y productos nuevos.">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MONEDAS.map((m: Moneda) => {
              const sel = f.moneda === m;
              return (
                <button key={m} type="button" disabled={bloqueado} onClick={() => set("moneda", m)}
                  data-testid={`option-moneda-${m}`}
                  className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed ${sel ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border/70 hover:bg-secondary/50"}`}>
                  <p className="font-mono text-lg font-bold">{MONEDA_INFO[m].simbolo}</p>
                  <p className="text-xs font-semibold">{m}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight">{MONEDA_INFO[m].nombre}</p>
                </button>
              );
            })}
          </div>
        </Seccion>

        <Seccion titulo="Decimales" desc="Precisión de montos en cobros, cotizaciones e inventario nuevos. Cada línea se redondea antes de sumar y calcular IVA. Los documentos existentes conservan la suya. No afecta cantidades de stock ni porcentajes.">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch id="switch-decimales" checked={f.decimales > 0} disabled={bloqueado} onCheckedChange={(on) => set("decimales", on ? 2 : 0)} data-testid="switch-habilitar-decimales" />
              <Label htmlFor="switch-decimales" className="text-sm">Habilitar decimales</Label>
            </div>
            {f.decimales > 0 && (
              <Segmento value={f.decimales} disabled={bloqueado} testId="option-decimales" onChange={(v) => set("decimales", v)} options={[1, 2].map((d) => ({ value: d, label: `${d} decimal${d === 1 ? "" : "es"}` }))} />
            )}
            <p className="text-xs text-muted-foreground">Ejemplo: <span className="font-mono text-foreground">{formatMoney(ejemplo, f.moneda, f.decimales)}</span></p>
            {f.moneda === "CLP" && f.decimales > 0 && <p className="text-xs text-amber-700">Los cobros CLP con decimales no pueden generar links de Flow ni MercadoPago.</p>}
          </div>
        </Seccion>

        <Seccion titulo="Indicadores económicos" desc="Valores guardados en NextCob (fuente mindicador.cl). Se usan como equivalencia referencial en CLP para documentos en UF, USD o EUR.">
          <IndicadoresPanel decimales={f.decimales} />
        </Seccion>

        <Seccion titulo="IVA por defecto" desc="Porcentaje sugerido en cotizaciones y cobros afectos. Editable en cada documento.">
          <div className="relative w-36">
            <Input type="number" min="0" max="100" step="0.01" value={iva} disabled={bloqueado} onChange={(e) => setIva(e.target.value)} className={`pr-8 font-mono ${ivaValido ? "" : "border-red-500"}`} data-testid="input-iva-default" />
            <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
          </div>
          {!ivaValido && <p className="text-xs text-red-600 mt-1">Usa un valor entre 0 y 100.</p>}
        </Seccion>

        <Seccion titulo="Formato de fecha" desc="Cómo se muestran las fechas en cotizaciones y documentos.">
          <div className="space-y-2">
            <Segmento value={f.formatoFecha} disabled={bloqueado} testId="option-formato-fecha" onChange={(v) => set("formatoFecha", v)} options={(["DD/MM/YYYY", "MM/DD/YYYY"] as const).map((v) => ({ value: v, label: <span className="font-mono text-xs">{v}</span> }))} />
            <p className="text-xs text-muted-foreground">Hoy: <span className="font-mono text-foreground">{formatFechaPref(hoySantiago(), f.formatoFecha)}</span></p>
          </div>
        </Seccion>

        <Seccion titulo="Numeración de documentos" desc="Prefijo para los números de los nuevos documentos. Máximo 16 caracteres.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Prefijo de cobros</Label>
              <Input value={f.prefijoCobro} maxLength={16} disabled={bloqueado} onChange={(e) => set("prefijoCobro", e.target.value.toUpperCase())} className={`font-mono ${prefijoOk(f.prefijoCobro) ? "" : "border-red-500"}`} data-testid="input-prefijo-cobro" />
              <p className="text-[11px] text-muted-foreground">Ej: <span className="font-mono">{f.prefijoCobro.trim() || "?"}0042</span></p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Prefijo de cotizaciones</Label>
              <Input value={f.prefijoCotizacion} maxLength={16} disabled={bloqueado} onChange={(e) => set("prefijoCotizacion", e.target.value.toUpperCase())} className={`font-mono ${prefijoOk(f.prefijoCotizacion) ? "" : "border-red-500"}`} data-testid="input-prefijo-cotizacion" />
              <p className="text-[11px] text-muted-foreground">Ej: <span className="font-mono">{f.prefijoCotizacion.trim() || "?"}0001</span></p>
            </div>
          </div>
        </Seccion>
      </Card>

      {puedeGuardar && sucio && (
        <div className="sticky bottom-4 flex justify-end">
          <div className="flex items-center gap-3 rounded-full border bg-card/95 backdrop-blur px-4 py-2 shadow-lg">
            <span className="text-sm text-muted-foreground">Cambios sin guardar</span>
            <Button size="sm" variant="ghost" onClick={() => { if (data) { setF(data); setIva(String(data.porcentajeIva)); } }}>Descartar</Button>
            <Button size="sm" onClick={guardar} disabled={!valido || save.isPending}>Guardar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
