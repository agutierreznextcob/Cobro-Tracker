import { useState, useMemo } from "react";
import { useListCobros, useGetDashboardMetrics, useGetInventarioResumen, getGetInventarioResumenQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatShortDate, formatMoney } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Clock, XCircle, ArrowUpRight, User, Filter, TrendingUp, Wallet, AlertCircle, Minus, AlertTriangle, Boxes } from "lucide-react";

function PasarelaBadge({ flowLinkPago, mpPaymentLinkUrl }: { flowLinkPago?: string | null; mpPaymentLinkUrl?: string | null }) {
  if (flowLinkPago && mpPaymentLinkUrl) {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-semibold leading-none border border-blue-200">Flow</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#009ee3]/10 text-[#009ee3] px-2 py-0.5 text-[10px] font-semibold leading-none border border-[#009ee3]/30">MP</span>
      </div>
    );
  }
  if (flowLinkPago) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-semibold leading-none border border-blue-200">Flow</span>;
  }
  if (mpPaymentLinkUrl) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-[#009ee3]/10 text-[#009ee3] px-2 py-0.5 text-[10px] font-semibold leading-none border border-[#009ee3]/30">MP</span>;
  }
  return <span className="inline-flex items-center gap-1 text-muted-foreground/50 text-xs"><Minus className="h-3 w-3" /></span>;
}

type Periodo = "hoy" | "semana" | "mes" | "total";

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mes" },
  { value: "total", label: "Todo el tiempo" },
];

export default function Dashboard() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [filtroResponsable, setFiltroResponsable] = useState<string>("todos");
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");

  const responsableParam =
    filtroResponsable !== "todos" && filtroResponsable !== "sin_asignar"
      ? filtroResponsable
      : undefined;
  const { data: metrics, isLoading: isLoadingMetrics } = useGetDashboardMetrics({
    periodo,
  });
  const { data: cobros, isLoading: isLoadingCobros } = useListCobros();
  const { data: inventario } = useGetInventarioResumen({ query: { queryKey: getGetInventarioResumenQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });

  const responsablesUnicos = useMemo(() => {
    if (!cobros) return [];
    const seen = new Map<string, string>();
    for (const c of cobros) {
      if (c.responsableId && c.responsableNombre && !seen.has(c.responsableId)) {
        seen.set(c.responsableId, c.responsableNombre);
      }
    }
    return Array.from(seen.entries()).map(([id, nombre]) => ({ id, nombre }));
  }, [cobros]);

  const cobrosFiltrados = useMemo(() => {
    if (!cobros) return [];
    return cobros
      .filter((c) => {
        const matchResponsable =
          filtroResponsable === "todos" ||
          (filtroResponsable === "sin_asignar" ? !c.responsableId : c.responsableId === filtroResponsable);
        const matchEstado = filtroEstado === "todos" || c.estado === filtroEstado;
        return matchResponsable && matchEstado;
      })
      .sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime());
  }, [cobros, filtroResponsable, filtroEstado]);

  const cobrosRecientes = useMemo(() => cobrosFiltrados.slice(0, 10), [cobrosFiltrados]);

  const hayFiltros = filtroResponsable !== "todos" || filtroEstado !== "todos";

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Métricas y resumen de tu actividad.</p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg overflow-x-auto max-w-full">
          {PERIODOS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriodo(p.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                periodo === p.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoadingMetrics ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-10 bg-muted/50" />
              <CardContent className="h-16 bg-muted/20" />
            </Card>
          ))}
        </div>
      ) : metrics ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="shadow-sm border-green-500/20 bg-green-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-green-700">Monto recaudado <span className="ml-1 text-[10px] font-normal text-muted-foreground" data-testid="label-importes-clp">Importes en CLP</span></CardTitle>
              <Wallet className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-green-700">{formatCurrency(metrics.montoRecaudado)}</div>
              <p className="text-xs text-muted-foreground mt-1">{metrics.transaccionesPagadas} transacciones pagadas</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Ticket promedio <span className="ml-1 text-[10px] font-normal text-muted-foreground">CLP</span></CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-primary">{formatCurrency(metrics.ticketPromedio)}</div>
              <p className="text-xs text-muted-foreground mt-1">Por transacción pagada</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-amber-500/20 bg-amber-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-amber-700">Pendientes</CardTitle>
              <Clock className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-amber-700">{metrics.pendientesCantidad}</div>
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(metrics.pendientesMonto)} por cobrar (CLP)</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Transacciones pagadas</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">{metrics.transaccionesPagadas}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {periodo === "hoy" ? "Hoy" : periodo === "semana" ? "Esta semana" : periodo === "mes" ? "Este mes" : "Histórico"}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {inventario && (inventario.productos > 0 || inventario.servicios > 0) && (
        <Link
          href="/inventario?filtro=alerta"
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
            inventario.criticos > 0 ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100" : "bg-card hover:bg-muted/40"
          }`}
          data-testid="link-stock-critico"
        >
          <div className="flex items-center gap-3">
            {inventario.criticos > 0 ? <AlertTriangle className="h-5 w-5 text-red-600" /> : <Boxes className="h-5 w-5 text-muted-foreground" />}
            <div>
              <p className="text-sm font-semibold">
                {inventario.criticos > 0
                  ? `${inventario.criticos} producto${inventario.criticos === 1 ? "" : "s"} con stock crítico`
                  : "Inventario sin alertas de stock"}
              </p>
              <p className="text-xs opacity-80">{inventario.agotados} agotado{inventario.agotados === 1 ? "" : "s"} · {inventario.productos} productos · {inventario.servicios} servicios</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      )}

      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Cobros recientes</h2>
            {hayFiltros && (
              <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                <Filter className="h-3 w-3" />
                Filtrado
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={filtroResponsable} onValueChange={setFiltroResponsable}>
              <SelectTrigger className="h-8 text-sm w-[170px] gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Responsable" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los responsables</SelectItem>
                {responsablesUnicos.map(({ id, nombre }) => (
                  <SelectItem key={id} value={id}>{nombre}</SelectItem>
                ))}
                {cobros?.some((c) => !c.responsableId) && (
                  <SelectItem value="sin_asignar">Sin asignar</SelectItem>
                )}
              </SelectContent>
            </Select>

            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger className="h-8 text-sm w-[140px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="pagado">Pagado</SelectItem>
                <SelectItem value="fallido">Fallido</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>

            {hayFiltros && (
              <button
                onClick={() => { setFiltroResponsable("todos"); setFiltroEstado("todos"); }}
                className="h-8 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Limpiar
              </button>
            )}

            <Link href="/cobros/nuevo" className="text-sm font-medium text-primary hover:underline flex items-center gap-1 ml-1">
              Nuevo <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        <Card className="shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Fecha</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Cliente / Responsable</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Pasarela</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingCobros ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell><div className="h-4 w-20 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-4 w-48 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-4 w-28 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-6 w-24 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-5 w-14 bg-muted rounded-full" /></TableCell>
                    <TableCell><div className="h-4 w-16 bg-muted rounded ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : cobrosRecientes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    {hayFiltros
                      ? "Ningún cobro coincide con los filtros seleccionados."
                      : "Sin cobros registrados. Crea uno para comenzar."}
                  </TableCell>
                </TableRow>
              ) : (
                cobrosRecientes.map((cobro) => (
                  <TableRow key={cobro.id} className="group hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground text-sm">
                      {formatShortDate(cobro.creadoEn)}
                    </TableCell>
                    <TableCell>
                      <Link href={`/cobros/${cobro.id}`} className="font-medium hover:underline text-foreground">
                        {cobro.descripcion}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {cobro.clienteNombre && (
                          <span className="text-sm font-medium text-foreground">{cobro.clienteNombre}</span>
                        )}
                        {cobro.responsableNombre ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <div className="h-4 w-4 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[9px] font-semibold shrink-0">
                              {cobro.responsableNombre.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <span className="truncate max-w-[100px]">{cobro.responsableNombre}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={cobro.estado} />
                    </TableCell>
                    <TableCell>
                      <PasarelaBadge flowLinkPago={cobro.flowLinkPago} mpPaymentLinkUrl={cobro.mpPaymentLinkUrl} />
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatMoney(cobro.monto, cobro.moneda, cobro.decimales)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {cobrosFiltrados.length > 10 && (
            <div className="px-4 py-3 border-t text-sm text-muted-foreground text-center">
              Mostrando 10 de {cobrosFiltrados.length} cobros
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
