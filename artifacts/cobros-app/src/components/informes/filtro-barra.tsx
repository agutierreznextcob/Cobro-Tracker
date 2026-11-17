/**
 * FiltroBarra — barra de filtros unificada para todos los módulos de Informes.
 *
 * Incluye:
 *   • Presets de período (7d / 1m / 3m / 1y / todo el tiempo)
 *   • Pickers Desde / Hasta (activan automáticamente preset "custom")
 *   • Slot opcional "extras" para filtros específicos del módulo
 *     (Agrupar por, Tipo documento, Proveedor, Moneda, etc.)
 *   • Muestra el rango de fechas resultante en texto
 *
 * Uso:
 *   const filtro = useFiltroBarra();
 *   <FiltroBarra {...filtro} extras={<FiltroMoneda ... />} />
 *   // filtro.range.desde / filtro.range.hasta → Date objects para filtrar datos
 */

import { useMemo, useState } from "react";
import { subDays, subMonths, subYears, startOfDay, endOfDay, parseISO } from "date-fns";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type PresetKey = "7d" | "1m" | "3m" | "1y" | "all" | "custom";

export interface DateRange {
  desde: Date;
  hasta: Date;
}

export interface FiltroBarra {
  preset: PresetKey;
  setPreset: (p: PresetKey) => void;
  customDesde: string;
  setCustomDesde: (v: string) => void;
  customHasta: string;
  setCustomHasta: (v: string) => void;
  range: DateRange;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d",  label: "Últimos 7 días" },
  { key: "1m",  label: "Último mes" },
  { key: "3m",  label: "Último trimestre" },
  { key: "1y",  label: "Último año" },
  { key: "all", label: "Todo el tiempo" },
];

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook que encapsula todo el estado de FiltroBarra.
 * El componente del módulo sólo necesita `filtro.range.desde/hasta`.
 */
export function useFiltroBarra(defaultPreset: PresetKey = "1m"): FiltroBarra {
  const [preset, setPreset] = useState<PresetKey>(defaultPreset);
  const [customDesde, setCustomDesde] = useState("");
  const [customHasta, setCustomHasta] = useState("");

  const range = useMemo<DateRange>(() => {
    const now = new Date();
    const hasta =
      preset === "custom" && customHasta
        ? endOfDay(parseISO(customHasta))
        : endOfDay(now);
    let desde: Date;
    switch (preset) {
      case "7d":
        desde = startOfDay(subDays(now, 6));
        break;
      case "3m":
        desde = startOfDay(subMonths(now, 3));
        break;
      case "1y":
        desde = startOfDay(subYears(now, 1));
        break;
      case "all":
        desde = startOfDay(subYears(now, 10));
        break;
      case "custom":
        desde = customDesde
          ? startOfDay(parseISO(customDesde))
          : startOfDay(subMonths(now, 1));
        break;
      case "1m":
      default:
        desde = startOfDay(subMonths(now, 1));
        break;
    }
    return { desde, hasta };
  }, [preset, customDesde, customHasta]);

  return { preset, setPreset, customDesde, setCustomDesde, customHasta, setCustomHasta, range };
}

// ── Componente ────────────────────────────────────────────────────────────────

interface FiltroBArraProps extends FiltroBarra {
  /** Filtros adicionales del módulo (Moneda, Tipo doc, Proveedor, Agrupar por, …) */
  extras?: React.ReactNode;
}

export function FiltroBArra({
  preset,
  setPreset,
  customDesde,
  setCustomDesde,
  customHasta,
  setCustomHasta,
  range,
  extras,
}: FiltroBArraProps) {
  return (
    <div className="rounded-lg border bg-card shadow-sm p-4 space-y-3">
      {/* Presets */}
      <div className="flex items-center gap-2 flex-wrap">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={preset === p.key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Date pickers + extras */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Desde</label>
          <Input
            type="date"
            value={customDesde}
            max={customHasta || undefined}
            onChange={(e) => {
              setCustomDesde(e.target.value);
              setPreset("custom");
            }}
            className="h-8 w-[150px] text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Hasta</label>
          <Input
            type="date"
            value={customHasta}
            min={customDesde || undefined}
            onChange={(e) => {
              setCustomHasta(e.target.value);
              setPreset("custom");
            }}
            className="h-8 w-[150px] text-xs"
          />
        </div>

        {/* Slot para filtros del módulo */}
        {extras && <>{extras}</>}

        {/* Rango activo */}
        <p className="text-xs text-muted-foreground ml-auto self-center whitespace-nowrap">
          {format(range.desde, "d MMM yyyy", { locale: es })} —{" "}
          {format(range.hasta, "d MMM yyyy", { locale: es })}
        </p>
      </div>
    </div>
  );
}
