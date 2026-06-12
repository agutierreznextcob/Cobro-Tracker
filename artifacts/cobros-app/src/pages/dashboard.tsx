import { useListCobros, useGetCobrosSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "wouter";
import { ArrowRight, Wallet, CheckCircle2, Clock, XCircle, ArrowUpRight, User } from "lucide-react";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetCobrosSummary();
  const { data: cobros, isLoading: isLoadingCobros } = useListCobros();

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
              "pagado": CheckCircle2,
              "pendiente": Clock,
              "fallido": XCircle,
              "cancelado": XCircle,
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight">Cobros recientes</h2>
          <Link href="/cobros/nuevo" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
            Nuevo cobro <ArrowUpRight className="h-3 w-3" />
          </Link>
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
              ) : cobros?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    Sin cobros registrados. Crea uno para comenzar.
                  </TableCell>
                </TableRow>
              ) : (
                cobros?.slice(0, 10).map((cobro) => (
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
                          <User className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate max-w-[120px]">{cobro.responsableNombre}</span>
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
        </Card>
      </div>
    </div>
  );
}
