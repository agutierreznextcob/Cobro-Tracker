import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useGetClientesPrioritarios,
  getGetClientesPrioritariosQueryKey,
  ScoreCategoria
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, AlertTriangle, ArrowRight, Activity, DollarSign, TrendingDown, Loader2, Filter, Clock, Percent } from "lucide-react";
import { formatCurrency } from "@/lib/format";

const CATEGORIA_LABELS: Record<string, string> = {
  excelente: "Excelente",
  bueno: "Bueno",
  regular: "Regular",
  riesgoso: "Riesgoso",
  critico: "Crítico",
  sin_datos: "Sin datos",
};

export default function ClientesPrioritariosPage() {
  const { data: clientes, isLoading, isError } = useGetClientesPrioritarios({ query: { queryKey: getGetClientesPrioritariosQueryKey() } });

  const [categoriaFiltro, setCategoriaFiltro] = useState<string>("all");
  const [minMontoFiltro, setMinMontoFiltro] = useState<string>("0");
  const [minDiasFiltro, setMinDiasFiltro] = useState<string>("0");

  const clientesList = clientes || [];

  const filteredClientes = useMemo(() => {
    return clientesList.filter((c) => {
      if (categoriaFiltro !== "all" && c.categoria !== categoriaFiltro) return false;
      if (Number(minMontoFiltro) > 0 && c.totalPendiente < Number(minMontoFiltro)) return false;
      if (Number(minDiasFiltro) > 0 && c.diasMora < Number(minDiasFiltro)) return false;
      return true;
    });
  }, [clientesList, categoriaFiltro, minMontoFiltro, minDiasFiltro]);

  const resetFilters = () => {
    setCategoriaFiltro("all");
    setMinMontoFiltro("0");
    setMinDiasFiltro("0");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Star className="h-7 w-7 text-primary" />
            Clientes Prioritarios
          <span className="ml-2 align-middle rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" data-testid="label-importes-clp">Importes en CLP</span></h1>
        </div>
        <Card className="border-dashed bg-destructive/10 border-destructive/20">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center text-destructive">
            <AlertTriangle className="h-12 w-12 mb-4 opacity-80" />
            <h3 className="text-lg font-medium mb-1">Error al cargar clientes</h3>
            <p>Ocurrió un problema al obtener la lista de clientes prioritarios.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isFiltered = categoriaFiltro !== "all" || minMontoFiltro !== "0" || minDiasFiltro !== "0";

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Star className="h-7 w-7 text-primary" />
          Clientes Prioritarios
        <span className="ml-2 align-middle rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" data-testid="label-importes-clp">Importes en CLP</span></h1>
        <p className="text-muted-foreground mt-1 text-sm max-w-3xl">
          Clientes con saldo pendiente ordenados por prioridad de cobranza (peor score y mayor riesgo primero).
        </p>
      </div>

      {clientesList.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Filter className="h-4 w-4" />
            <span className="text-sm font-medium">Filtros:</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto flex-1">
            <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
              <SelectTrigger className="h-9 w-full sm:w-[160px]">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {Object.values(ScoreCategoria).map((cat) => (
                  <SelectItem key={cat} value={cat}>{CATEGORIA_LABELS[cat] || cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={minMontoFiltro} onValueChange={setMinMontoFiltro}>
              <SelectTrigger className="h-9 w-full sm:w-[180px]">
                <SelectValue placeholder="Monto mínimo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Cualquier monto</SelectItem>
                <SelectItem value="100000">&gt; $100.000</SelectItem>
                <SelectItem value="500000">&gt; $500.000</SelectItem>
                <SelectItem value="1000000">&gt; $1.000.000</SelectItem>
                <SelectItem value="5000000">&gt; $5.000.000</SelectItem>
              </SelectContent>
            </Select>

            <Select value={minDiasFiltro} onValueChange={setMinDiasFiltro}>
              <SelectTrigger className="h-9 w-full sm:w-[160px]">
                <SelectValue placeholder="Días mora" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Cualquier mora</SelectItem>
                <SelectItem value="15">&gt; 15 días</SelectItem>
                <SelectItem value="30">&gt; 30 días</SelectItem>
                <SelectItem value="60">&gt; 60 días</SelectItem>
                <SelectItem value="90">&gt; 90 días</SelectItem>
              </SelectContent>
            </Select>

            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 px-2 text-muted-foreground hover:text-foreground ml-auto sm:ml-0">
                Limpiar
              </Button>
            )}
          </div>
        </div>
      )}

      {clientesList.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <Star className="h-12 w-12 mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground mb-1">Sin clientes con saldo</h3>
            <p>No hay clientes con saldo pendiente en este momento.</p>
          </CardContent>
        </Card>
      ) : filteredClientes.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <Filter className="h-12 w-12 mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground mb-1">Sin resultados</h3>
            <p>No hay clientes que coincidan con los filtros aplicados.</p>
            <Button variant="outline" className="mt-4" onClick={resetFilters}>
              Limpiar filtros
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClientes.map((c) => {
            const isHighRisk = c.categoria === "critico" || c.categoria === "riesgoso";
            const isMedRisk = c.categoria === "regular";

            return (
              <Card key={c.clienteId} className={`flex flex-col shadow-sm hover:shadow-md transition-shadow hover-elevate ${isHighRisk ? 'border-red-500/50 dark:border-red-900/50' : isMedRisk ? 'border-amber-500/50 dark:border-amber-900/50' : ''}`}>
                <CardContent className="p-5 flex-1 flex flex-col gap-4">
                  <div className="flex justify-between items-start gap-2">
                    <Link href={`/clientes/${c.clienteId}`} className="font-bold text-lg leading-tight hover:text-primary transition-colors line-clamp-2 flex-1">
                      {c.clienteNombre}
                    </Link>
                    <Badge variant={isHighRisk ? "destructive" : isMedRisk ? "secondary" : "outline"} className={isMedRisk ? "bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300" : ""}>
                      {CATEGORIA_LABELS[c.categoria] || c.categoria}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1 bg-secondary/30 p-2.5 rounded-lg">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Pendiente</p>
                      <p className="font-semibold text-base text-foreground flex items-center">
                        <DollarSign className="h-3.5 w-3.5 mr-0.5 text-muted-foreground" />
                        {formatCurrency(c.totalPendiente)}
                      </p>
                    </div>
                    <div className="space-y-1 bg-secondary/30 p-2.5 rounded-lg">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider flex items-center gap-1">
                        Score <Activity className="h-3 w-3" />
                      </p>
                      <p className={`font-semibold text-base ${(c.score || 0) < 50 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {c.score != null ? c.score : '—'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground bg-secondary/20 p-2 rounded-md">
                      <Clock className="h-4 w-4 shrink-0" />
                      <span className="font-medium text-foreground">{c.diasMora}</span>
                      <span className="text-xs">días mora</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground bg-secondary/20 p-2 rounded-md">
                      <Percent className="h-4 w-4 shrink-0" />
                      <span className="font-medium text-foreground">
                        {c.probabilidadPago != null ? `${c.probabilidadPago}%` : "Sin datos"}
                      </span>
                      <span className="text-xs truncate">prob. pago</span>
                    </div>
                  </div>

                  {c.recomendacion && (
                    <div className="text-sm text-muted-foreground leading-snug mt-1 bg-muted/40 p-3 rounded-md border border-border/50">
                      <span className="font-medium text-foreground block mb-1 text-xs uppercase tracking-wider">Sugerencia NextCob</span>
                      {c.recomendacion}
                    </div>
                  )}

                  <div className="mt-auto pt-4 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                      <TrendingDown className="h-3 w-3" /> Monto en riesgo: {formatCurrency(c.prioridad)} CLP
                    </div>
                    <Button size="sm" asChild>
                      <Link href={`/clientes/${c.clienteId}`}>
                        Gestionar <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
