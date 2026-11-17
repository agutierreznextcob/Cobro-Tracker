import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { ProductosMasVendidos, MenorMovimiento } from "@/components/informes/ventas-productos";
import { useGetInformeArea, getGetInformeAreaQueryKey, useListBodegas, useListLocales, type GetInformeAreaParams } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Moneda } from "@/lib/format";
import {
  BotonExcel, CHART_COLOR, ErrorReporte, FiltroMoneda, KpiCard, NotaInforme, SkeletonReporte, VacioReporte,
  descargarXlsx, fechaCorta, fmtNum, money, type Periodo,
} from "@/components/informes/shared";
import { FiltroBArra, useFiltroBarra, type FiltroBarra } from "@/components/informes/filtro-barra";

/** Mapea preset a Periodo del backend */
function presetToPeriodo(preset: string): Periodo {
  switch (preset) {
    case "7d": return "7dias";
    case "3m": return "trimestre";
    case "1y": return "año";
    case "all": return "todo";
    default: return "mes";
  }
}

function useInforme(params: GetInformeAreaParams) {
  return useGetInformeArea(params, { query: { queryKey: getGetInformeAreaQueryKey(params) } });
}

function Header({ children, excel }: { children: React.ReactNode; excel: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap gap-2">{children}</div>{excel}</div>;
}

function MasVendidosInventario({ filtro, moneda }: { filtro: FiltroBarra; moneda: Moneda }) {
  const periodo: Periodo = filtro.preset === "custom" ? "mes" : presetToPeriodo(filtro.preset);
  const params: GetInformeAreaParams = { area: "inventario", periodo, moneda };
  const { data, isLoading, isError, refetch } = useInforme(params);
  const rows = data?.ventas ?? [];
  const top = useMemo(() => rows.slice(0, 10).map((r) => ({ nombre: r.nombre.length > 14 ? `${r.nombre.slice(0, 13)}…` : r.nombre, full: r.nombre, unidades: r.unidades })), [rows]);
  const exportar = () => descargarXlsx(`inventario-mas-vendidos-${periodo}-${moneda}`, [
    { name: "Más vendidos", cols: [6, 32, 14, 18, 12, 14, 12], rows: rows.map((r, i) => ({ "#": i + 1, Producto: r.nombre, "Unidades salidas": r.unidades, [`Ingresos asociados (${moneda})`]: r.ingresos, "Stock actual": r.stockActual, "Stock promedio": Number(r.stockPromedio.toFixed(2)), "Rotación estimada": r.rotacion == null ? "N/D" : Number(r.rotacion.toFixed(2)) })) },
    { name: "Notas", rows: [{ Período: `${data?.desde ?? ""} a ${data?.hasta ?? ""}`, Notas: data?.notas ?? "" }] },
  ]);
  return (
    <div className="space-y-5">
      <Header excel={<BotonExcel onExport={exportar} disabled={isLoading || isError || !rows.length} testId="button-excel-inv-vendidos" />}>{null}</Header>
      {isLoading ? <SkeletonReporte /> : isError || !data ? <ErrorReporte onRetry={() => refetch()} /> : (
        <>
          <NotaInforme desde={data.desde} hasta={data.hasta} moneda={data.moneda} notas={data.notas} />
          {rows.length === 0 ? <Card><VacioReporte titulo="Sin salidas de stock por ventas" detalle="No hay movimientos de salida asociados a cobros en el período." /></Card> : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{top[0]?.full} es el que más stock mueve</CardTitle>
                  <p className="text-xs text-muted-foreground">Top {top.length} de {rows.length} por unidades descontadas del stock por ventas</p>
                </CardHeader>
                <CardContent>
                  <div className="h-72" data-testid="chart-top-inventario">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={top} margin={{ left: 0, right: 8, top: 18, bottom: 4 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="nombre" type="category" interval={0} angle={-25} textAnchor="end" height={56} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis type="number" tickFormatter={(v: number) => fmtNum(v)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} formatter={(v: number) => [`${fmtNum(v, 2)} unidades`, "Unidades salidas"]} labelFormatter={(_l, p) => (p?.[0]?.payload?.full as string) ?? ""} />
                        <Bar dataKey="unidades" fill={CHART_COLOR} radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="unidades" position="top" formatter={(v: number) => fmtNum(v)} style={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader><TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Producto</TableHead><TableHead className="text-xs text-right">Unidades salidas</TableHead><TableHead className="text-xs text-right">Ingresos asociados</TableHead><TableHead className="text-xs text-right">Stock actual</TableHead><TableHead className="text-xs text-right">Rotación estimada</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{rows.map((r) => (
                    <TableRow key={r.id} data-testid={`row-inv-vendido-${r.id}`}>
                      <TableCell className="font-medium">{r.nombre}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.unidades, 2)}</TableCell>
                      <TableCell className="text-right font-mono">{money(r.ingresos, moneda)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.stockActual, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums" title={`Stock promedio ${fmtNum(r.stockPromedio, 2)}`}>{r.rotacion == null ? <span className="text-muted-foreground">N/D</span> : `${r.rotacion.toFixed(2)}x`}</TableCell>
                    </TableRow>))}</TableBody>
                </Table>
              </Card>
              <p className="text-xs text-muted-foreground">Rotación = unidades vendidas ÷ stock promedio del período (ponderado por tiempo). N/D cuando el stock promedio fue 0.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function StockValorizado() {
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const [bodega, setBodega] = useState("todas");
  const [local, setLocal] = useState("todos");
  const { data: bodegas } = useListBodegas();
  const { data: locales } = useListLocales();
  const bodegasFiltradas = (bodegas ?? []).filter((b) => local === "todos" || String(b.localId) === local);
  const params: GetInformeAreaParams = { area: "inventario", periodo: "todo", moneda, ...(bodega !== "todas" ? { bodegaId: Number(bodega) } : {}), ...(local !== "todos" ? { localId: Number(local) } : {}) };
  const { data, isLoading, isError, refetch } = useInforme(params);
  const rows = data?.valorizado ?? [];
  const exportar = () => descargarXlsx(`stock-valorizado-${moneda}`, [
    { name: "Stock valorizado", cols: [32, 22, 22, 12, 16, 18], rows: rows.map((r) => ({ Producto: r.nombre, Bodega: r.bodega, Local: r.local, "Stock actual": r.stock, [`Costo unitario neto (${moneda})`]: r.costo, [`Valor total (${moneda})`]: r.valor })) },
    { name: "Notas", rows: [{ "Total valorizado": data?.totalStock ?? 0, Moneda: moneda, Bodega: bodega, Local: local, Notas: data?.notas ?? "" }] },
  ]);
  return (
    <div className="space-y-5">
      <Header excel={<BotonExcel onExport={exportar} disabled={isLoading || isError || !rows.length} testId="button-excel-valorizado" />}>
        <FiltroMoneda value={moneda} onChange={setMoneda} />
        <Select value={local} onValueChange={(v) => { setLocal(v); setBodega("todas"); }}>
          <SelectTrigger className="w-[190px] h-9" data-testid="select-local"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos los locales</SelectItem>{(locales ?? []).map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={bodega} onValueChange={setBodega}>
          <SelectTrigger className="w-[190px] h-9" data-testid="select-bodega"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todas">Todas las bodegas</SelectItem>{bodegasFiltradas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.nombre}</SelectItem>)}</SelectContent>
        </Select>
      </Header>
      {isLoading ? <SkeletonReporte /> : isError || !data ? <ErrorReporte onRetry={() => refetch()} /> : (
        <>
          <NotaInforme desde={data.desde} hasta={data.hasta} moneda={data.moneda} notas={data.notas} />
          <KpiCard label="Inventario valorizado al costo" value={money(data.totalStock, moneda)} hint={`${rows.length} línea${rows.length !== 1 ? "s" : ""} producto × bodega · costo neto actual`} />
          <Card className="overflow-hidden">
            {rows.length === 0 ? <VacioReporte titulo="Sin stock para valorizar" detalle={`No hay productos con costo en ${moneda} para los filtros seleccionados.`} /> : (
              <Table>
                <TableHeader><TableRow className="bg-muted/50">
                  <TableHead className="text-xs">Producto</TableHead><TableHead className="text-xs">Bodega</TableHead><TableHead className="text-xs text-right">Stock actual</TableHead><TableHead className="text-xs text-right">Costo unitario</TableHead><TableHead className="text-xs text-right">Valor total</TableHead>
                </TableRow></TableHeader>
                <TableBody>{rows.map((r) => (
                  <TableRow key={`${r.productoId}-${r.bodegaId}`} data-testid={`row-valorizado-${r.productoId}-${r.bodegaId}`}>
                    <TableCell className="font-medium">{r.nombre}</TableCell>
                    <TableCell className="text-sm">{r.bodega}<span className="block text-[11px] text-muted-foreground">{r.local}</span></TableCell>
                    <TableCell className={`text-right tabular-nums ${r.stock <= 0 ? "text-destructive" : ""}`}>{fmtNum(r.stock, 2)}</TableCell>
                    <TableCell className="text-right font-mono">{money(r.costo, moneda)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{money(r.valor, moneda)}</TableCell>
                  </TableRow>))}
                  <TableRow className="bg-muted/40 font-semibold"><TableCell colSpan={4}>Total general</TableCell><TableCell className="text-right font-mono" data-testid="text-total-valorizado">{money(data.totalStock, moneda)}</TableCell></TableRow>
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Quiebres({ filtro }: { filtro: FiltroBarra }) {
  const periodo: Periodo = filtro.preset === "custom" ? "trimestre" : presetToPeriodo(filtro.preset);
  const params: GetInformeAreaParams = { area: "inventario", periodo };
  const { data, isLoading, isError, refetch } = useInforme(params);
  const rows = useMemo(() => [...(data?.quiebres ?? [])].sort((a, b) => b.frecuencia - a.frecuencia), [data]);
  const criticos = new Set(rows.filter((r) => r.critico).map((r) => r.productoId)).size;
  const exportar = () => descargarXlsx(`quiebres-stock-${periodo}`, [
    { name: "Quiebres", cols: [32, 14, 14, 18, 22, 22, 12], rows: rows.map((r) => ({ Producto: r.nombre, "Fecha quiebre": fechaCorta(r.fecha), "Días sin stock": r.diasSinStock, "Frecuencia en período": r.frecuencia, "Stock crítico recurrente": r.critico ? "Sí" : "No", "Stock mínimo sugerido (1 día)": r.stockMinimo, "Aún sin stock": r.abierto ? "Sí" : "No" })) },
    { name: "Notas", rows: [{ Período: `${data?.desde ?? ""} a ${data?.hasta ?? ""}`, Notas: data?.notas ?? "" }] },
  ]);
  return (
    <div className="space-y-5">
      <Header excel={<BotonExcel onExport={exportar} disabled={isLoading || isError || !rows.length} testId="button-excel-quiebres" />}>{null}</Header>
      {isLoading ? <SkeletonReporte /> : isError || !data ? <ErrorReporte onRetry={() => refetch()} /> : (
        <>
          <NotaInforme desde={data.desde} hasta={data.hasta} notas={data.notas} />
          {criticos > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" data-testid="alert-stock-critico">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
              <span><strong>{criticos}</strong> producto{criticos !== 1 ? "s" : ""} con <strong>Stock crítico recurrente</strong> (más de 2 quiebres en el período).</span>
            </div>
          )}
          <Card className="overflow-hidden">
            {rows.length === 0 ? <VacioReporte titulo="Sin quiebres registrados" detalle="Ningún producto llegó a 0 unidades en el período, según el historial de movimientos registrado." /> : (
              <Table>
                <TableHeader><TableRow className="bg-muted/50">
                  <TableHead className="text-xs">Producto</TableHead><TableHead className="text-xs">Fecha quiebre</TableHead><TableHead className="text-xs text-right">Días sin stock</TableHead><TableHead className="text-xs text-right">Frecuencia</TableHead><TableHead className="text-xs text-right">Mínimo sugerido</TableHead>
                </TableRow></TableHeader>
                <TableBody>{rows.map((r, i) => (
                  <TableRow key={`${r.productoId}-${r.fecha}-${i}`} className={r.critico ? "bg-destructive/5" : ""} data-testid={`row-quiebre-${r.productoId}-${i}`}>
                    <TableCell>
                      <span className="font-medium">{r.nombre}</span>
                      {r.critico && <span className="ml-2 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] font-semibold text-destructive">Stock crítico recurrente</span>}
                    </TableCell>
                    <TableCell className="text-sm">{fechaCorta(r.fecha)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.diasSinStock}{r.abierto && <span className="ml-1 text-[10px] text-destructive">(aún sin stock)</span>}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{r.frecuencia}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.stockMinimo)} u.</TableCell>
                  </TableRow>))}</TableBody>
              </Table>
            )}
          </Card>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Mínimo sugerido = promedio de unidades vendidas por día redondeado hacia arriba: cubre un día de ventas. No considera el tiempo de reposición de tu proveedor; ajústalo según cuánto tarda en llegar.
          </p>
        </>
      )}
    </div>
  );
}

export default function InformesInventario() {
  const filtro = useFiltroBarra("1m");
  const [moneda, setMoneda] = useState<Moneda>("CLP");

  const barraExtras = (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">Moneda</label>
      <FiltroMoneda value={moneda} onChange={setMoneda} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Informes</p>
        <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Qué rota, cuánto vale tu bodega y dónde te quedas sin stock.</p>
      </div>

      <FiltroBArra {...filtro} extras={barraExtras} />

      <Tabs defaultValue="vendidos" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="vendidos" data-testid="tab-inv-vendidos">Productos más vendidos</TabsTrigger>
          <TabsTrigger value="valorizado" data-testid="tab-inv-valorizado">Stock actual valorizado</TabsTrigger>
          <TabsTrigger value="quiebres" data-testid="tab-inv-quiebres">Quiebres de stock</TabsTrigger>
          <TabsTrigger value="mas-vendidos" data-testid="tab-inv-mas-vendidos">Productos y servicios más vendidos</TabsTrigger>
          <TabsTrigger value="menor-movimiento" data-testid="tab-inv-menor-movimiento">Menor movimiento</TabsTrigger>
        </TabsList>
        <TabsContent value="vendidos" className="mt-0"><MasVendidosInventario filtro={filtro} moneda={moneda} /></TabsContent>
        <TabsContent value="valorizado" className="mt-0"><StockValorizado /></TabsContent>
        <TabsContent value="quiebres" className="mt-0"><Quiebres filtro={filtro} /></TabsContent>
        <TabsContent value="mas-vendidos" className="mt-0"><ProductosMasVendidos /></TabsContent>
        <TabsContent value="menor-movimiento" className="mt-0"><MenorMovimiento /></TabsContent>
      </Tabs>
    </div>
  );
}
