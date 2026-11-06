import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle } from "lucide-react";
import { useGetInformeArea, getGetInformeAreaQueryKey, type GetInformeAreaParams } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Moneda } from "@/lib/format";
import {
  BotonExcel, CHART_COLOR, ErrorReporte, FiltroMoneda, FiltroPeriodo, NotaInforme, SkeletonReporte, VacioReporte,
  descargarXlsx, fechaCorta, fmtNum, money, PERIODOS, type Periodo,
} from "./shared";

function periodoLabel(p: Periodo) {
  return PERIODOS.find((x) => x.value === p)?.label ?? p;
}

export function ProductosMasVendidos() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const params: GetInformeAreaParams = { area: "ventas", periodo, moneda };
  const { data, isLoading, isError, refetch } = useGetInformeArea(params, { query: { queryKey: getGetInformeAreaQueryKey(params) } });

  const rows = data?.ventas ?? [];
  const top10 = useMemo(
    () => rows.slice(0, 10).map((r) => ({ nombre: r.nombre.length > 26 ? `${r.nombre.slice(0, 25)}…` : r.nombre, full: r.nombre, ingresos: r.ingresos, unidades: r.unidades })),
    [rows],
  );
  const sumaPct = rows.reduce((s, r) => s + r.porcentaje, 0);

  const exportar = () =>
    descargarXlsx(`ventas-productos-${periodo}-${moneda}`, [
      {
        name: "Más vendidos",
        cols: [6, 34, 12, 14, 18, 14, 14],
        rows: rows.map((r, i) => ({
          "#": i + 1,
          "Producto/Servicio": r.nombre,
          Tipo: r.tipo,
          "Unidades vendidas": r.unidades,
          [`Ingresos generados (${moneda})`]: r.ingresos,
          "% del total de ventas": Number(r.porcentaje.toFixed(2)),
          "Última venta": fechaCorta(r.ultimaVenta),
        })),
      },
      { name: "Notas", rows: [{ Período: `${data?.desde ?? ""} a ${data?.hasta ?? ""}`, Moneda: moneda, Notas: data?.notas ?? "" }] },
    ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <FiltroPeriodo value={periodo} onChange={setPeriodo} />
          <FiltroMoneda value={moneda} onChange={setMoneda} />
        </div>
        <BotonExcel onExport={exportar} disabled={isLoading || isError || rows.length === 0} disabledReason={rows.length === 0 && !isLoading ? "Sin ventas para exportar" : undefined} testId="button-excel-mas-vendidos" />
      </div>

      {isLoading ? <SkeletonReporte /> : isError || !data ? <ErrorReporte onRetry={() => refetch()} /> : (
        <>
          <NotaInforme desde={data.desde} hasta={data.hasta} moneda={data.moneda} notas={data.notas} />
          {rows.length === 0 ? (
            <Card><VacioReporte titulo="Sin ventas de catálogo en el período" detalle={`No hay cobros pagados en ${moneda} con productos o servicios durante "${periodoLabel(periodo).toLowerCase()}".`} /></Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{top10[0]?.full} lidera en unidades vendidas</CardTitle>
                  <p className="text-xs text-muted-foreground">Top {top10.length} de {rows.length} por unidades vendidas · documentos en {moneda}</p>
                </CardHeader>
                <CardContent>
                  <div style={{ height: Math.max(180, top10.length * 34 + 30) }} data-testid="chart-top-ventas">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={top10} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 4 }}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tickFormatter={(v: number) => fmtNum(v, 3)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis type="category" dataKey="nombre" width={150} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--secondary))" }}
                          formatter={(v: number) => [fmtNum(v, 3), "Unidades vendidas"]}
                          labelFormatter={(_l, p) => (p?.[0]?.payload?.full as string) ?? ""}
                        />
                        <Bar dataKey="unidades" fill={CHART_COLOR} radius={[0, 4, 4, 0]}>
                          <LabelList dataKey="unidades" position="right" formatter={(v: number) => fmtNum(v, 3)} style={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-10 text-xs">#</TableHead>
                      <TableHead className="text-xs">Producto/Servicio</TableHead>
                      <TableHead className="text-xs text-right">Unidades vendidas</TableHead>
                      <TableHead className="text-xs text-right">Ingresos generados</TableHead>
                      <TableHead className="text-xs text-right">% del total de ventas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={r.id} data-testid={`row-producto-vendido-${r.id}`}>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{r.nombre}</span>
                            {i === 0 && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[11px] font-semibold dark:bg-amber-900/30 dark:text-amber-200" data-testid="badge-top-vendedor">
                                ⭐ Top vendedor
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground capitalize">{r.tipo}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(r.unidades, 2)}</TableCell>
                        <TableCell className="text-right font-mono">{money(r.ingresos, moneda)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="hidden sm:block h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.porcentaje)}%`, background: CHART_COLOR }} />
                            </div>
                            <span className="tabular-nums w-14">{r.porcentaje.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
              {sumaPct < 99.5 && (
                <p className="text-xs text-muted-foreground">
                  Los porcentajes suman {sumaPct.toFixed(1)}%: el resto corresponde a cobros pagados sin productos de catálogo (cobros manuales).
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export function MenorMovimiento() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const [umbralTxt, setUmbralTxt] = useState("5");
  const umbralNum = Number(umbralTxt);
  const umbralValido = umbralTxt.trim() !== "" && Number.isFinite(umbralNum) && umbralNum >= 0 && umbralNum <= 1_000_000;
  const umbral = umbralValido ? umbralNum : 5;
  const params: GetInformeAreaParams = { area: "ventas", periodo, moneda, umbral };
  const { data, isLoading, isError, refetch } = useGetInformeArea(params, { query: { queryKey: getGetInformeAreaQueryKey(params) } });
  const rows = data?.menorMovimiento ?? [];
  const sinVenta = rows.filter((r) => r.unidades === 0).length;
  const alerta30 = rows.filter((r) => r.diasSinMovimiento > 30).length;

  const exportar = () =>
    descargarXlsx(`menor-movimiento-${periodo}`, [
      {
        name: "Menor movimiento",
        cols: [34, 12, 16, 14, 18, 14, 18],
        rows: rows.map((r) => ({
          "Producto/Servicio": r.nombre,
          Tipo: r.tipo,
          "Unidades en período": r.unidades,
          "Última venta": r.ultimaVenta ? fechaCorta(r.ultimaVenta) : "Nunca vendido",
          "Días sin movimiento": r.diasSinMovimiento,
          "Stock actual": r.stockActual,
          "Alerta > 30 días": r.diasSinMovimiento > 30 ? "Sí" : "No",
        })),
      },
      { name: "Notas", rows: [{ Período: `${data?.desde ?? ""} a ${data?.hasta ?? ""}`, Umbral: umbral === 0 ? "Solo 0 ventas" : `Menos de ${umbral} unidades`, Notas: data?.notas ?? "" }] },
    ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <FiltroPeriodo value={periodo} onChange={setPeriodo} />
          <FiltroMoneda value={moneda} onChange={setMoneda} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Menos de (unidades)
            <Input type="number" min={0} value={umbralTxt} onChange={(e) => setUmbralTxt(e.target.value)} className="h-9 w-28" data-testid="input-umbral" aria-invalid={!umbralValido} />
          </label>
        </div>
        <BotonExcel onExport={exportar} label="Exportar lista" disabled={isLoading || isError || rows.length === 0} disabledReason={rows.length === 0 && !isLoading ? "Nada que exportar" : undefined} testId="button-exportar-lista" />
      </div>
      {!umbralValido && <p className="text-xs text-destructive">Ingresa un número entre 0 y 1.000.000. Mientras tanto se usa 5.</p>}
      <p className="text-xs text-muted-foreground">
        {umbral === 0 ? "Mostrando solo productos con 0 ventas en el período." : `Mostrando productos con menos de ${fmtNum(umbral)} unidades vendidas (incluye los que no se vendieron).`}
      </p>

      {isLoading ? <SkeletonReporte /> : isError || !data ? <ErrorReporte onRetry={() => refetch()} /> : (
        <>
          <NotaInforme desde={data.desde} hasta={data.hasta} notas={data.notas} />
          {alerta30 > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="alert-sin-venta-30">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong>{alerta30}</strong> producto{alerta30 !== 1 ? "s" : ""} sin venta hace más de 30 días. {sinVenta} sin ninguna venta en el período.</span>
            </div>
          )}
          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <VacioReporte titulo="Todo tu catálogo se está moviendo" detalle="Ningún producto o servicio está bajo el umbral en el período seleccionado." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Producto</TableHead>
                    <TableHead className="text-xs text-right">Unidades</TableHead>
                    <TableHead className="text-xs">Última venta</TableHead>
                    <TableHead className="text-xs text-right">Días sin movimiento</TableHead>
                    <TableHead className="text-xs text-right">Stock actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const alerta = r.diasSinMovimiento > 30;
                    return (
                      <TableRow key={r.id} className={alerta ? "bg-amber-50/60 dark:bg-amber-950/20" : ""} data-testid={`row-menor-movimiento-${r.id}`}>
                        <TableCell>
                          <span className="font-medium">{r.nombre}</span>
                          <span className="ml-2 text-[11px] text-muted-foreground capitalize">{r.tipo}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(r.unidades, 2)}</TableCell>
                        <TableCell className="text-sm">{r.ultimaVenta ? fechaCorta(r.ultimaVenta) : <span className="text-muted-foreground">Nunca vendido</span>}</TableCell>
                        <TableCell className="text-right">
                          <span className={`inline-flex items-center gap-1 tabular-nums ${alerta ? "font-semibold text-amber-800 dark:text-amber-300" : ""}`}>
                            {alerta && <AlertTriangle className="h-3.5 w-3.5" aria-label="Más de 30 días sin venta" />}
                            {fmtNum(r.diasSinMovimiento)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.tipo === "servicio" ? "—" : fmtNum(r.stockActual, 2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
