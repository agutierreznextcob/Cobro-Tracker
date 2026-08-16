import { useState } from "react";
import { useGetSaludCarteraHistorial } from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";

function formatFechaCorta(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

export function EvolucionCarteraChart() {
  const [dias, setDias] = useState<30 | 90>(30);
  const { data, isLoading } = useGetSaludCarteraHistorial({ dias });

  const puntos = data?.puntos ?? [];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Evolución de la cartera</h2>
        </div>
        <Select value={String(dias)} onValueChange={(v) => setDias(v === "90" ? 90 : 30)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Últimos 30 días</SelectItem>
            <SelectItem value="90">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="h-[280px] animate-pulse bg-muted/30 rounded-md" />
          ) : puntos.length < 2 ? (
            <div className="h-[280px] flex flex-col items-center justify-center text-center gap-2">
              <BarChart3 className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground max-w-sm">
                Aún no hay suficiente historial para graficar la evolución. Los datos se registran
                automáticamente cada día — vuelve en unos días para ver la tendencia.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={puntos} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="fecha"
                  tickFormatter={formatFechaCorta}
                  tick={{ fontSize: 12 }}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: number) =>
                    v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                  }
                  width={64}
                />
                <Tooltip
                  labelFormatter={(l) => formatFechaCorta(String(l))}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = { sana: "Sana", riesgo: "En riesgo", critica: "Crítica" };
                    return [formatCurrency(value), labels[name] ?? name];
                  }}
                />
                <Legend
                  formatter={(name: string) => {
                    const labels: Record<string, string> = { sana: "Sana", riesgo: "En riesgo", critica: "Crítica" };
                    return labels[name] ?? name;
                  }}
                />
                {/* connectNulls bridges days without a stored snapshot */}
                <Area type="monotone" dataKey="sana" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} connectNulls />
                <Area type="monotone" dataKey="riesgo" stroke="#eab308" fill="#eab308" fillOpacity={0.15} strokeWidth={2} connectNulls />
                <Area type="monotone" dataKey="critica" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} strokeWidth={2} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
