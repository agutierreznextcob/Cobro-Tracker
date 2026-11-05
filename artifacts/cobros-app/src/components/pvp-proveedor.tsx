import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatPct } from "@/lib/inventario";
import { Check, Calculator, Tag } from "lucide-react";

export type PvpCalc = { netoExacto: number; margen: number; utilidad: number; finalAceptado: number } | null;

export function PvpProveedorCard({ pvp, setPvp, incluyeIva, setIncluyeIva, tasa, calc, fmt, fuente, onAceptar, onUsarCalculado }: {
  pvp: string; setPvp: (s: string) => void;
  incluyeIva: boolean; setIncluyeIva: (b: boolean) => void;
  tasa: number; calc: PvpCalc; fmt: (n: number) => string;
  fuente: "manual" | "calculado" | "pvp";
  onAceptar: () => void; onUsarCalculado: () => void;
}) {
  const neg = calc != null && calc.utilidad < 0;
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4 text-primary" />PVP del proveedor (opcional)</CardTitle>
        <CardDescription>Compara tu cálculo con el precio de venta sugerido por el proveedor.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0 space-y-1.5">
            <Label>PVP sugerido</Label>
            <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
              <Input type="number" min="0" step="any" className="pl-7 font-mono" value={pvp} onChange={(e) => setPvp(e.target.value)} placeholder="Sin PVP" data-testid="input-pvp-proveedor" /></div>
          </div>
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit" role="radiogroup" aria-label="El PVP incluye IVA">
            {([[true, "Con IVA"], [false, "Sin IVA"]] as const).map(([v, l]) => (
              <button key={l} type="button" role="radio" aria-checked={incluyeIva === v} onClick={() => setIncluyeIva(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${incluyeIva === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`toggle-pvp-${v ? "con" : "sin"}-iva`}>{l}</button>
            ))}
          </div>
        </div>

        {calc && (
          <>
            <div className="rounded-lg bg-muted/50 p-3 font-mono text-xs space-y-1">
              {incluyeIva ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">PVP con IVA</span><span>{fmt(Number(pvp))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">÷ (1 + {tasa}%) = neto</span><span className="font-semibold">{fmt(calc.netoExacto)}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">PVP neto</span><span className="font-semibold">{fmt(calc.netoExacto)}</span></div>
              )}
            </div>
            <p className={`text-sm rounded-md px-3 py-2 border ${neg ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} data-testid="text-pvp-margen">
              Con el PVP del proveedor obtienes <strong className="font-mono">{formatPct(calc.margen)}</strong> de margen / <strong className="font-mono">{fmt(calc.utilidad)}</strong> de utilidad
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={fuente === "pvp" ? "default" : "outline"} onClick={onAceptar} data-testid="button-aceptar-pvp">
                <Check className="h-3.5 w-3.5 mr-1.5" />{fuente === "pvp" ? "PVP aceptado" : "Aceptar PVP"} · {fmt(calc.finalAceptado)}
              </Button>
              <Button type="button" size="sm" variant={fuente === "calculado" ? "default" : "outline"} onClick={onUsarCalculado} data-testid="button-usar-calculado">
                <Calculator className="h-3.5 w-3.5 mr-1.5" />Usar precio calculado
              </Button>
            </div>
            {incluyeIva && fuente !== "pvp" && <p className="text-[11px] text-muted-foreground">Aceptar un PVP con IVA activa "Incluir IVA en precio final" para que el precio final sea exactamente el PVP.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
