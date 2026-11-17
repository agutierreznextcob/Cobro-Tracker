import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Receipt, ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";
import { useGetInformeArea, getGetInformeAreaQueryKey, useListProveedores, type GetInformeAreaParams } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Moneda } from "@/lib/format";
import {
  BotonExcel, CHART_COLOR, ErrorReporte, FiltroMoneda, KpiCard, NotaInforme, SkeletonReporte, VacioReporte,
  compactMoney, descargarXlsx, fechaCorta, money, type Periodo,
} from "@/components/informes/shared";
import { FiltroBArra, useFiltroBarra } from "@/components/informes/filtro-barra";

const ESTADO_LABEL: Record<string, string> = { borrador: "Borrador", recibida: "Recibida", contabilizada: "Contabilizada" };

/** Mapea el preset de FiltroBarra al tipo Periodo que espera el backend */
function presetToPeriodo(preset: string): Periodo {
  switch (preset) {
    case "7d": return "7dias";
    case "3m": return "trimestre";
    case "1y": return "año";
    case "all": return "todo";
    case "1m":
    default: return "mes";
  }
}

export default function InformesCompras() {
  const filtro = useFiltroBarra("1m");
  const periodo: Periodo = filtro.preset === "custom" ? "mes" : presetToPeriodo(filtro.preset);
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const [proveedor, setProveedor] = useState("todos");
  const { data: proveedores } = useListProveedores();
  const params: GetInformeAreaParams = { area: "compras", periodo, moneda, ...(proveedor !== "todos" ? { proveedorId: Number(proveedor) } : {}) };
  const { data, isLoading, isError, refetch } = useGetInformeArea(params, { query: { queryKey: getGetInformeAreaQueryKey(params) } });
  const provNombre = proveedor === "todos" ? "Todos" : proveedores?.find((p) => String(p.id) === proveedor)?.razonSocial ?? proveedor;

  const serie = useMemo(() => (data?.evolucion ?? []).map((s) => ({ t: new Date(`${s.fecha.slice(0, 10)}T12:00:00`).getTime(), total: s.total })), [data]);
  const totalPend = (data?.pendientes ?? []).reduce((s, f) => s + f.monto, 0);
  const pend30 = (data?.pendientes ?? []).filter((f) => f.dias > 30);
  const meta = { Período: `${data?.desde ?? ""} a ${data?.hasta ?? ""}`, Moneda: moneda, Proveedor: provNombre, Notas: data?.notas ?? "" };
  const ok = !isLoading && !isError && !!data;

  const exportResumen = () => descargarXlsx(`compras-resumen-${periodo}-${moneda}`, [
    { name: "Resumen", cols: [34, 20], rows: [
      { Indicador: "Total comprado (todas las facturas)", Valor: data?.total ?? 0 },
      { Indicador: "Facturas ingresadas", Valor: data?.facturas ?? 0 },
      { Indicador: "Ticket promedio", Valor: data?.ticketPromedio ?? 0 },
      { Indicador: "Mes actual (a la fecha)", Valor: data?.mesActual ?? 0 },
      { Indicador: "Mes anterior (mismo tramo de días)", Valor: data?.mesAnterior ?? 0 },
      { Indicador: "Variación %", Valor: data?.variacion == null ? "Sin base de comparación" : Number(data.variacion.toFixed(2)) },
    ] },
    { name: "Evolución", cols: [14, 18], rows: (data?.evolucion ?? []).map((s) => ({ Fecha: fechaCorta(s.fecha), [`Total (${moneda})`]: s.total })) },
    { name: "Notas", rows: [meta] },
  ]);
  const exportProv = () => descargarXlsx(`compras-proveedores-${periodo}-${moneda}`, [
    { name: "Por proveedor", cols: [6, 32, 12, 18, 14, 40], rows: (data?.proveedores ?? []).map((p, i) => ({ Ranking: i + 1, Proveedor: p.nombre, "Nº facturas": p.facturas, [`Total comprado (${moneda})`]: p.total, "Última compra": fechaCorta(p.ultimaCompra), "Productos más comprados": p.productos })) },
    { name: "Notas", rows: [meta] },
  ]);
  const exportPend = () => descargarXlsx(`compras-por-pagar-${moneda}`, [
    { name: "Cuentas por pagar", cols: [16, 30, 12, 16, 12, 14, 10], rows: (data?.pendientes ?? []).map((f) => ({ "Nº Factura": f.numero, Proveedor: f.proveedor, Fecha: fechaCorta(f.fecha), [`Monto (${moneda})`]: f.monto, "Días transcurridos": f.dias, Estado: ESTADO_LABEL[f.estado] ?? f.estado, "> 30 días": f.dias > 30 ? "Sí" : "No" })) },
    { name: "Notas", rows: [{ ...meta, "Total pendiente": totalPend, Aclaración: "Estado contable (no contabilizada); no constituye prueba de pago." }] },
  ]);

  const body = (render: () => React.ReactNode) => isLoading ? <SkeletonReporte /> : isError || !data ? <ErrorReporte onRetry={() => refetch()} /> : render();
  const v = data?.variacion;

  const barraExtras = (
    <>
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground">Moneda</label>
        <FiltroMoneda value={moneda} onChange={setMoneda} />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground">Proveedor</label>
        <Select value={proveedor} onValueChange={setProveedor}>
          <SelectTrigger className="w-[220px] h-8 text-xs" data-testid="select-proveedor"><SelectValue placeholder="Proveedor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los proveedores</SelectItem>
            {(proveedores ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.razonSocial}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Informes</p>
        <h1 className="text-2xl font-bold tracking-tight">Compras</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Cuánto le compras a quién, y qué facturas siguen sin contabilizar.</p>
      </div>

      <FiltroBArra {...filtro} extras={barraExtras} />

      <Tabs defaultValue="resumen" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="resumen" data-testid="tab-compras-resumen">Resumen de compras</TabsTrigger>
          <TabsTrigger value="proveedor" data-testid="tab-compras-proveedor">Por proveedor</TabsTrigger>
          <TabsTrigger value="pagar" data-testid="tab-compras-pagar">Cuentas por pagar</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="space-y-5 mt-0">
          <div className="flex flex-wrap items-start justify-end gap-3"><BotonExcel onExport={exportResumen} disabled={!ok} testId="button-excel-compras-resumen" /></div>
          {body(() => data && (
            <>
              <NotaInforme desde={data.desde} hasta={data.hasta} moneda={data.moneda} notas={data.notas} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard label="Total comprado" value={money(data.total, moneda)} hint="Facturas en todos los estados" icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />} />
                <KpiCard label="Facturas ingresadas" value={data.facturas} icon={<Receipt className="h-4 w-4 text-muted-foreground" />} />
                <KpiCard label="Ticket promedio" value={money(data.ticketPromedio, moneda)} hint="Por factura" />
                <KpiCard
                  label="Vs. mes anterior"
                  value={v == null ? "—" : <span className="inline-flex items-center gap-1">{v >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>}
                  hint={v == null ? "Sin compras el mes anterior para comparar" : `${money(data.mesActual, moneda)} vs ${money(data.mesAnterior, moneda)} (mismos días transcurridos)`}
                />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Evolución de compras</CardTitle>
                  <p className="text-xs text-muted-foreground">Total comprado en {moneda} por fecha; eje temporal proporcional</p>
                </CardHeader>
                <CardContent>
                  {serie.length === 0 ? <VacioReporte titulo="Sin compras en el período" detalle="Prueba otro período, moneda o proveedor." /> : (
                    <div className="h-72" data-testid="chart-evolucion-compras">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={serie} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => new Date(t).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                          <YAxis tickFormatter={(x: number) => compactMoney(x, moneda)} tick={{ fontSize: 11 }} width={70} stroke="hsl(var(--muted-foreground))" />
                          <Tooltip labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("es-CL")} formatter={(x: number) => [money(x, moneda), `Compras (${moneda})`]} />
                          <Line type="monotone" dataKey="total" stroke={CHART_COLOR} strokeWidth={2} dot={serie.length < 10} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ))}
        </TabsContent>

        <TabsContent value="proveedor" className="space-y-5 mt-0">
          <div className="flex flex-wrap items-start justify-end gap-3"><BotonExcel onExport={exportProv} disabled={!ok || !data?.proveedores.length} testId="button-excel-compras-proveedor" /></div>
          {body(() => data && (
            <>
              <NotaInforme desde={data.desde} hasta={data.hasta} moneda={data.moneda} notas={data.notas} />
              <Card className="overflow-hidden">
                {data.proveedores.length === 0 ? <VacioReporte titulo="Sin compras a proveedores" detalle="No hay facturas en el período y moneda seleccionados." /> : (
                  <Table>
                    <TableHeader><TableRow className="bg-muted/50">
                      <TableHead className="w-10 text-xs">#</TableHead><TableHead className="text-xs">Proveedor</TableHead><TableHead className="text-xs text-right">Nº facturas</TableHead><TableHead className="text-xs text-right">Total comprado</TableHead><TableHead className="text-xs">Última compra</TableHead><TableHead className="text-xs">Productos más comprados</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{data.proveedores.map((p, i) => (
                      <TableRow key={p.id} data-testid={`row-proveedor-${p.id}`}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{p.nombre}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.facturas}</TableCell>
                        <TableCell className="text-right font-mono">{money(p.total, moneda)}</TableCell>
                        <TableCell className="text-sm">{fechaCorta(p.ultimaCompra)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs">{p.productos || "—"}</TableCell>
                      </TableRow>))}</TableBody>
                  </Table>
                )}
              </Card>
            </>
          ))}
        </TabsContent>

        <TabsContent value="pagar" className="space-y-5 mt-0">
          <div className="flex flex-wrap items-start justify-end gap-3"><BotonExcel onExport={exportPend} disabled={!ok || !data?.pendientes.length} testId="button-excel-compras-pagar" /></div>
          <p className="text-xs text-muted-foreground">Facturas en estado <strong>borrador</strong> o <strong>recibida</strong> (no contabilizadas). El estado contable no confirma un pago real al proveedor.</p>
          {body(() => data && (
            <>
              <NotaInforme desde={data.desde} hasta={data.hasta} moneda={data.moneda} notas={data.notas} />
              <div className="grid gap-4 sm:grid-cols-2">
                <KpiCard label="Monto total pendiente" value={money(totalPend, moneda)} hint={`${data.pendientes.length} factura${data.pendientes.length !== 1 ? "s" : ""}`} />
                <KpiCard label="Más de 30 días sin contabilizar" value={pend30.length} tone={pend30.length ? "warn" : undefined} icon={pend30.length ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : undefined} hint={pend30.length ? money(pend30.reduce((s, f) => s + f.monto, 0), moneda) : "Al día"} />
              </div>
              <Card className="overflow-hidden">
                {data.pendientes.length === 0 ? <VacioReporte titulo="No hay facturas pendientes" detalle="Todas las facturas de compra están contabilizadas." /> : (
                  <Table>
                    <TableHeader><TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Nº Factura</TableHead><TableHead className="text-xs">Proveedor</TableHead><TableHead className="text-xs">Fecha</TableHead><TableHead className="text-xs text-right">Monto</TableHead><TableHead className="text-xs text-right">Días transcurridos</TableHead><TableHead className="text-xs">Estado</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{data.pendientes.map((f) => {
                      const al = f.dias > 30;
                      return (
                        <TableRow key={f.id} className={al ? "bg-amber-50/60 dark:bg-amber-950/20" : ""} data-testid={`row-pendiente-${f.id}`}>
                          <TableCell className="font-mono text-sm">{f.numero}</TableCell>
                          <TableCell>{f.proveedor}</TableCell>
                          <TableCell className="text-sm">{fechaCorta(f.fecha)}</TableCell>
                          <TableCell className="text-right font-mono">{money(f.monto, moneda)}</TableCell>
                          <TableCell className="text-right"><span className={`inline-flex items-center gap-1 tabular-nums ${al ? "font-semibold text-amber-800 dark:text-amber-300" : ""}`}>{al && <AlertTriangle className="h-3.5 w-3.5" />}{f.dias}</span></TableCell>
                          <TableCell className="text-xs">{ESTADO_LABEL[f.estado] ?? f.estado}</TableCell>
                        </TableRow>
                      );
                    })}</TableBody>
                  </Table>
                )}
              </Card>
            </>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
