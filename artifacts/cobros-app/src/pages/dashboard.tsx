import { useState, useMemo } from "react";
import { useListCobros, useGetCobrosSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "wouter";
import { ArrowRight, Wallet, CheckCircle2, Clock, XCircle, ArrowUpRight, User, Filter } from "lucide-react";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetCobrosSummary();
  const { data: cobros, isLoading: isLoadingCobros } = useListCobros();

  const [filtroResponsable, setFiltroResponsable] = useState<string>("todos");
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");

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
    return cobros.filter((c) => {
      const matchResponsable =
        filtroResponsable === "todos" ||
        (filtroResponsable === "sin_asignar" ? !c.responsableId : c.responsableId === filtroResponsable);
      const matchEstado = filtroEstado === "todos" || c.estado === filtroEstado;
      return matchResponsable && matchEstado;
    });
  }, [cobros, filtroResponsable, filtroEstado]);

  const hayFiltros = filtroResponsable !== "todos" || filtroEstado !== "todos";

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Resumen en tiempo real de cobros e ingresos.</p>
      </div>

      {isLoadingSummary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-10 bg-muted/50" />
              <CardContent className="h-16 bg-muted/20" />
            </Card>
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="shadow-sm border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Total ingresos</CardTitle>
              <Wallet className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-primary">{formatCurrency(summary.montoTotal)}</div>
              <p className="text-xs text-muted-foreground mt-1">{summary.total} cobros en total</p>
            </CardContent>
          </Card>

          {summary.porEstado.map(stat => {
            const icons: Record<string, React.ElementType> = {
              pagado: CheckCircle2,
              pendiente: Clock,
              fallido: XCircle,
              cancelado: XCircle,
            };
            const Icon = icons[stat.estado] || ArrowRight;
            return (
              <Card key={stat.estado} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium capitalize">{stat.estado}</CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">{formatCurrency(stat.monto)}</div>
                  <p className="text-xs text-muted-foreground mt-1">{stat.cantidad} cobros</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

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
                {cobros?.some(c => !c.responsableId) && (
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
                <TableHead>Responsable</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingCobros ? (
                [1, 2, 3, 4, 5].map(i => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell><div className="h-4 w-20 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-4 w-48 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-4 w-28 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-6 w-24 bg-muted rounded" /></TableCell>
                    <TableCell><div className="h-4 w-16 bg-muted rounded ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : cobrosFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    {hayFiltros
                      ? "Ningún cobro coincide con los filtros seleccionados."
                      : "Sin cobros registrados. Crea uno para comenzar."}
                  </TableCell>
                </TableRow>
              ) : (
                cobrosFiltrados.slice(0, 20).map((cobro) => (
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
                      {cobro.responsableNombre ? (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-semibold shrink-0">
                            {cobro.responsableNombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <span className="truncate max-w-[110px]">{cobro.responsableNombre}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={cobro.estado} />
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatCurrency(cobro.monto)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {cobrosFiltrados.length > 20 && (
            <div className="px-4 py-3 border-t text-sm text-muted-foreground text-center">
              Mostrando 20 de {cobrosFiltrados.length} cobros
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
