import { useMemo } from "react";
import {
  useListClientes,
  useGetEncuestasResumen,
  getGetEncuestasResumenQueryKey,
} from "@workspace/api-client-react";
import type { ClienteConScore } from "@workspace/api-client-react";
import { ScoreBadge } from "@/components/score-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Star, Loader2, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency, formatDate } from "@/lib/format";

const CATEGORIA_LABEL: Record<string, string> = {
  excelente: "Excelente",
  bueno: "Bueno",
  regular: "Regular",
  riesgoso: "Riesgoso",
  critico: "Crítico",
  sin_datos: "Sin historial",
};

function RankingClientes() {
  const { data: clientes, isLoading } = useListClientes();

  const ranking = useMemo(() => {
    const list = (clientes ?? []).slice();
    return list.sort((a, b) => {
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      if (sb !== sa) return sb - sa;
      return b.totalCobrado - a.totalCobrado;
    });
  }, [clientes]);

  const exportar = async () => {
    const XLSX = await import("xlsx");
    const rows = ranking.map((c: ClienteConScore) => ({
      Cliente: c.nombre,
      Score: c.score ?? "Sin historial",
      Categoría: CATEGORIA_LABEL[c.categoria] ?? c.categoria,
      "Total cobrado": c.totalCobrado,
      "Total pendiente": c.totalPendiente,
      "Cobros vencidos": c.cobrosVencidos,
      "Prom. días de atraso": c.promedioDiasAtraso,
      "Total cobros": c.totalCobros,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ranking clientes");
    XLSX.writeFile(wb, `ranking-clientes-${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Cargando..." : `${ranking.length} cliente${ranking.length !== 1 ? "s" : ""} ordenados por score de comportamiento de pago.`}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={exportar}
          disabled={ranking.length === 0}
        >
          <Download className="h-4 w-4" />
          Exportar Excel
        </Button>
      </div>

      <Card className="shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs w-10">#</TableHead>
              <TableHead className="text-xs">Cliente</TableHead>
              <TableHead className="text-xs">Score</TableHead>
              <TableHead className="text-xs text-right">Total cobrado (CLP)</TableHead>
              <TableHead className="text-xs text-right">Total pendiente (CLP)</TableHead>
              <TableHead className="text-xs text-right">Prom. días atraso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i} className="animate-pulse">
                  <TableCell><div className="h-4 w-4 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-40 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-5 w-24 bg-muted rounded-full" /></TableCell>
                  <TableCell><div className="h-4 w-20 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-20 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : ranking.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-sm">
                  Sin clientes registrados.
                </TableCell>
              </TableRow>
            ) : (
              ranking.map((c, i) => (
                <TableRow key={c.id} className="hover:bg-muted/40 transition-colors">
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-medium text-sm">{c.nombre}</TableCell>
                  <TableCell>
                    <ScoreBadge score={c.score} categoria={c.categoria} size="sm" />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCurrency(c.totalCobrado)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {c.totalPendiente > 0 ? (
                      <span className="text-amber-700 font-medium">{formatCurrency(c.totalPendiente)}</span>
                    ) : (
                      <span className="text-muted-foreground">{formatCurrency(0)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.score == null ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      `${c.promedioDiasAtraso} d`
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function SatisfaccionStars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

function SatisfaccionReport() {
  const { data, isLoading } = useGetEncuestasResumen({
    query: { queryKey: getGetEncuestasResumenQueryKey() },
  });

  const maxDist = Math.max(1, ...(data?.distribucion.map((d) => d.cantidad) ?? [1]));

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const exportarSatisfaccion = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Indicador", "Valor"], ["Encuestas enviadas", data.total], ["Respondidas", data.respondidas], ["Promedio (1-5)", Number(data.promedio.toFixed(2))], ["Clientes redirigidos a Google este mes (clics, no reseñas publicadas)", data.googleRedirigidosMes ?? 0]]), "Resumen");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.distribucion.map((d) => ({ Calificación: d.calificacion, Cantidad: d.cantidad }))), "Distribución");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.recientes.map((r) => ({ Cliente: r.clienteNombre ?? "", Calificación: r.calificacion, Comentario: r.comentario ?? "", "Redirigido a Google": r.googleRedirigido ? "Sí" : "No", Fecha: r.respondidoEn ?? "" }))), "Recientes");
    XLSX.writeFile(wb, `satisfaccion-${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={exportarSatisfaccion} disabled={data.total === 0} data-testid="button-excel-satisfaccion">
          <Download className="h-4 w-4" />
          Exportar Excel
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        <p className="text-sm text-muted-foreground">
          Encuestas de satisfacción enviadas automáticamente al confirmarse cada pago.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-2xl font-bold tabular-nums">
              {data.promedio.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground"> / 5</span>
            </div>
            <div className="mt-1">
              <SatisfaccionStars value={Math.round(data.promedio)} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Promedio</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-2xl font-bold tabular-nums">{data.respondidas}</div>
            <div className="mt-1 text-xs text-muted-foreground">Respuestas recibidas</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-2xl font-bold tabular-nums">{data.total}</div>
            <div className="mt-1 text-xs text-muted-foreground">Encuestas enviadas</div>
          </CardContent>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="text-google-redirigidos-informe">
        <span className="font-semibold text-foreground tabular-nums">{data.googleRedirigidosMes ?? 0}</span> clientes redirigidos a Google este mes
        <span className="ml-1 text-xs">(clics en el botón, no reseñas publicadas)</span>
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distribución</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[...data.distribucion].reverse().map((d) => (
            <div key={d.calificacion} className="flex items-center gap-3">
              <span className="flex w-16 items-center gap-1 text-sm">
                {d.calificacion} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{ width: `${(d.cantidad / maxDist) * 100}%` }}
                />
              </div>
              <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">
                {d.cantidad}
                {data.respondidas > 0 && (
                  <span className="ml-1 text-xs">
                    ({Math.round((d.cantidad / data.respondidas) * 100)}%)
                  </span>
                )}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comentarios recientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.recientes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Aún no hay respuestas.</p>
          ) : (
            data.recientes.map((r, i) => (
              <div key={i} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{r.clienteNombre ?? "Cliente"}</span>
                  <SatisfaccionStars value={r.calificacion} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Redirigido a Google: <span className={r.googleRedirigido ? "font-medium text-emerald-700" : ""}>{r.googleRedirigido ? "Sí" : "No"}</span></p>
                {r.comentario && <p className="mt-1 text-sm text-muted-foreground">{r.comentario}</p>}
                {r.respondidoEn && (
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(r.respondidoEn)}</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function InformesClientes() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Informes</p>
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Comportamiento de pago, ranking y satisfacción de tus clientes.</p>
      </div>
      <Tabs defaultValue="ranking" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="ranking">Ranking de clientes</TabsTrigger>
          <TabsTrigger value="satisfaccion">Satisfacción</TabsTrigger>
        </TabsList>
        <TabsContent value="ranking" className="space-y-6 mt-0">
          <RankingClientes />
        </TabsContent>
        <TabsContent value="satisfaccion" className="space-y-6 mt-0">
          <SatisfaccionReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
