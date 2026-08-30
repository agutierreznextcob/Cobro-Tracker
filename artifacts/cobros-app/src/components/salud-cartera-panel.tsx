import { useGetSaludCartera, type SaludCarteraBloque } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { EvolucionCarteraChart } from "@/components/evolucion-cartera-chart";
import { MoveRight, TrendingDown, TrendingUp, Wallet } from "lucide-react";

function TendenciaIcon({ tendencia }: { tendencia: SaludCarteraBloque["tendencia"] }) {
  if (tendencia === "mejor") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600" title="Mejor que la semana pasada">
        <TrendingUp className="h-3.5 w-3.5" /> Mejor
      </span>
    );
  }
  if (tendencia === "peor") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600" title="Peor que la semana pasada">
        <TrendingDown className="h-3.5 w-3.5" /> Peor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground" title="Sin cambios significativos">
      <MoveRight className="h-3.5 w-3.5" /> Igual
    </span>
  );
}

export function SaludCarteraPanel() {
  const { data, isLoading } = useGetSaludCartera();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="h-10 bg-muted/50" />
            <CardContent className="h-20 bg-muted/20" />
          </Card>
        ))}
      </div>
    );
  }
  if (!data) return null;

  const { semaforo } = data;
  return (
    <section className="space-y-6">
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Salud de cartera</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-green-500/30 bg-green-500/5 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-green-700">
                <span className="inline-block h-3 w-3 rounded-full bg-green-500" /> Cartera sana
              </CardTitle>
              <TendenciaIcon tendencia={semaforo.sana.tendencia} />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-bold text-green-700">{formatCurrency(semaforo.sana.monto)}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {semaforo.sana.cantidad} {semaforo.sana.cantidad === 1 ? "cobro dentro del plazo" : "cobros dentro del plazo"}
              </p>
              <p className="mt-2 text-xs font-medium text-green-700">Sin riesgo inmediato</p>
            </CardContent>
          </Card>

          <Card className="border-yellow-500/30 bg-yellow-500/5 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-yellow-700">
                <span className="inline-block h-3 w-3 rounded-full bg-yellow-400" /> Cartera en riesgo
              </CardTitle>
              <TendenciaIcon tendencia={semaforo.riesgo.tendencia} />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-bold text-yellow-700">{formatCurrency(semaforo.riesgo.monto)}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {semaforo.riesgo.cantidad} {semaforo.riesgo.cantidad === 1 ? "cobro vence" : "cobros vencen"} en los próximos 7 días
              </p>
              <p className="mt-2 text-xs font-medium text-yellow-700">Requieren seguimiento pronto</p>
            </CardContent>
          </Card>

          <Card className="border-red-500/30 bg-red-500/5 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <span className="inline-block h-3 w-3 rounded-full bg-red-500" /> Cartera crítica
              </CardTitle>
              <TendenciaIcon tendencia={semaforo.critica.tendencia} />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-bold text-red-700">{formatCurrency(semaforo.critica.monto)}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {semaforo.critica.cantidad} {semaforo.critica.cantidad === 1 ? "cobro vencido" : "cobros vencidos"}
                {semaforo.critica.cantidad > 0 && semaforo.critica.diasPromedioMora != null
                  ? ` · ${semaforo.critica.diasPromedioMora} días promedio de mora`
                  : ""}
              </p>
              <p className="mt-2 text-xs font-medium text-red-700">Acción inmediata requerida</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <EvolucionCarteraChart />
    </section>
  );
}