import { useState, useMemo } from "react";
import { useListCobros, useGetDashboardMetrics, useListClientes, useGetGestionesAgenda, useGetSaludCartera, GestionTipo } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatShortDate, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { ScoreBadge } from "@/components/score-badge";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Clock, XCircle, ArrowUpRight, User, Filter, TrendingUp, Wallet, AlertCircle, Minus, ShieldAlert, CalendarClock, TrendingDown, MoveRight, MessageSquare, Sparkles } from "lucide-react";
import { EvolucionCarteraChart } from "@/components/evolucion-cartera-chart";
import type { SaludCarteraBloque, SaludCarteraAccion } from "@workspace/api-client-react";

function TendenciaIcon({ tendencia }: { tendencia: SaludCarteraBloque["tendencia"] }) {
  if (tendencia === "mejor")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600" title="Mejor que la semana pasada">
        <TrendingUp className="h-3.5 w-3.5" /> Mejor
      </span>
    );
  if (tendencia === "peor")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600" title="Peor que la semana pasada">
        <TrendingDown className="h-3.5 w-3.5" /> Peor
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground" title="Sin cambios significativos">
      <MoveRight className="h-3.5 w-3.5" /> Igual
    </span>
  );
}

function razonDe(a: SaludCarteraAccion): string {
  const partes: string[] = [];
  if (a.diasMora != null) partes.push(a.diasMora === 1 ? "Vencido hace 1 día" : `Vencido hace ${a.diasMora} días`);
  else if (a.diasParaVencer != null)
    partes.push(a.diasParaVencer === 0 ? "Vence hoy" : a.diasParaVencer === 1 ? "Vence mañana" : `Vence en ${a.diasParaVencer} días`);
  partes.push(formatCurrency(a.saldoPendiente));
  const catLabel: Record<string, string> = {
    excelente: "Score Excelente",
    bueno: "Score Bueno",
    regular: "Score Regular",
    riesgoso: "Score Riesgoso",
    critico: "Score Crítico",
  };
  if (catLabel[a.categoria]) partes.push(catLabel[a.categoria]);
  if (!a.ultimoContactoEn) partes.push("sin contacto registrado");
  return partes.join(" · ");
}

function SaludCarteraPanel() {
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

  const { semaforo, acciones, resumen } = data;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Salud de cartera</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="shadow-sm border-green-500/30 bg-green-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-semibold text-green-700 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-green-500 inline-block" /> Cartera sana
              </CardTitle>
              <TendenciaIcon tendencia={semaforo.sana.tendencia} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-green-700">{formatCurrency(semaforo.sana.monto)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {semaforo.sana.cantidad} {semaforo.sana.cantidad === 1 ? "cobro dentro del plazo" : "cobros dentro del plazo"}
              </p>
              <p className="text-xs font-medium text-green-700 mt-2">Sin riesgo inmediato</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-yellow-500/30 bg-yellow-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-semibold text-yellow-700 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-yellow-400 inline-block" /> Cartera en riesgo
              </CardTitle>
              <TendenciaIcon tendencia={semaforo.riesgo.tendencia} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-yellow-700">{formatCurrency(semaforo.riesgo.monto)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {semaforo.riesgo.cantidad} {semaforo.riesgo.cantidad === 1 ? "cobro vence" : "cobros vencen"} en los próximos 7 días
              </p>
              <p className="text-xs font-medium text-yellow-700 mt-2">Requieren seguimiento pronto</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-red-500/30 bg-red-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-semibold text-red-700 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-500 inline-block" /> Cartera crítica
              </CardTitle>
              <TendenciaIcon tendencia={semaforo.critica.tendencia} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-red-700">{formatCurrency(semaforo.critica.monto)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {semaforo.critica.cantidad} {semaforo.critica.cantidad === 1 ? "cobro vencido" : "cobros vencidos"}
                {semaforo.critica.cantidad > 0 && semaforo.critica.diasPromedioMora != null
                  ? ` · ${semaforo.critica.diasPromedioMora} días promedio de mora`
                  : ""}
              </p>
              <p className="text-xs font-medium text-red-700 mt-2">Acción inmediata requerida</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <EvolucionCarteraChart />

      {acciones.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Acciones recomendadas para hoy</h2>
          </div>

          <Card className="shadow-sm border-primary/25 bg-primary/5 mb-4">
            <CardContent className="p-4 flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-primary shrink-0" />
              <p className="text-sm">
                Esta semana podrías recuperar hasta{" "}
                <span className="font-bold font-mono">{formatCurrency(resumen.montoRecuperable)}</span> si contactas a{" "}
                {resumen.clientes === 1 ? "este cliente prioritario" : `estos ${resumen.clientes} clientes prioritarios`}.
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-0 divide-y">
              {acciones.map((a) => (
                <div key={a.clienteId} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/clientes/${a.clienteId}`} className="font-semibold text-sm truncate hover:text-primary transition-colors">
                        {a.clienteNombre}
                      </Link>
                      <ScoreBadge score={a.score ?? null} categoria={a.categoria} size="xs" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{razonDe(a)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono font-semibold text-sm">{formatCurrency(a.saldoPendiente)}</span>
                    {a.cobroId != null && (
                      <Link
                        href={`/cobros/${a.cobroId}?contactar=1`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Contactar
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

const GESTION_TIPO_LABEL: Record<GestionTipo, string> = {
  llamada: "Llamada",
  email: "Email",
  whatsapp: "WhatsApp",
  visita: "Visita",
  otro: "Otro",
};

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
    ...(responsableParam ? { responsable: responsableParam } : {}),
  });
  const { data: cobros, isLoading: isLoadingCobros } = useListCobros();
  const { data: clientes } = useListClientes();
  const { data: agenda } = useGetGestionesAgenda();

  const clientesPrioritarios = useMemo(() => {
    if (!clientes) return [];
    return clientes
      .filter((c) => c.score != null && c.totalPendiente > 0)
      .sort((a, b) => (a.score ?? 100) - (b.score ?? 100) || b.totalPendiente - a.totalPendiente)
      .slice(0, 5);
  }, [clientes]);

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

      <SaludCarteraPanel />

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
              <CardTitle className="text-sm font-medium text-green-700">Monto recaudado</CardTitle>
              <Wallet className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-green-700">{formatCurrency(metrics.montoRecaudado)}</div>
              <p className="text-xs text-muted-foreground mt-1">{metrics.transaccionesPagadas} transacciones pagadas</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Ticket promedio</CardTitle>
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
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(metrics.pendientesMonto)} por cobrar</p>
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

      {clientesPrioritarios.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="h-5 w-5 text-orange-500" />
            <h2 className="text-xl font-semibold tracking-tight">Clientes prioritarios</h2>
            <span className="text-sm text-muted-foreground">— con saldo pendiente y bajo score</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {clientesPrioritarios.map((c) => (
              <Link key={c.id} href={`/clientes/${c.id}`}>
                <Card className="shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group h-full">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                        {c.nombre}
                      </p>
                      <ScoreBadge score={c.score} categoria={c.categoria} size="xs" showLabel={false} />
                    </div>
                    <div>
                      <p className="text-lg font-bold font-mono text-foreground">{formatCurrency(c.totalPendiente)}</p>
                      <p className="text-xs text-muted-foreground">
                        pendiente
                        {c.cobrosVencidos > 0 && (
                          <span className="text-red-600 font-medium">
                            {" · "}
                            {c.cobrosVencidos} vencido{c.cobrosVencidos !== 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {agenda && agenda.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <CalendarClock className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Próximas gestiones</h2>
            <span className="text-sm text-muted-foreground">— agenda de cobranza programada</span>
          </div>
          <Card className="shadow-sm overflow-hidden">
            <div className="divide-y divide-border/60">
              {agenda.map((g) => (
                <Link key={g.gestionId} href={`/cobros/${g.cobroId}`}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {g.clienteNombre || g.cobroDescripcion || `Cobro #${g.cobroId}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {GESTION_TIPO_LABEL[g.proximaGestionTipo]}
                        {g.responsableNombre && ` · ${g.responsableNombre}`}
                        {typeof g.saldo === "number" && g.saldo > 0 && ` · ${formatCurrency(g.saldo)} pendiente`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-medium ${g.vencida ? "text-red-600" : "text-foreground"}`}>
                        {formatDate(g.proximaGestionEn)}
                      </p>
                      {g.vencida && <p className="text-[10px] text-red-600 font-medium">Vencida</p>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </div>
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
                      {formatCurrency(cobro.monto)}
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
