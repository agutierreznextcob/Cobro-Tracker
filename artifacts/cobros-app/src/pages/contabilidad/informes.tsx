import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json() as Promise<T>;
}
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, BarChart3, BookOpen, FileText, Calculator, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── utilidades ─────────────────────────────────────────────────────────────

const CLP = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

const anioActual = new Date().getFullYear();
const ANIOS = Array.from({ length: 5 }, (_, i) => anioActual - i);
const MESES = [
  { v: "", l: "Todo el año" },
  { v: "1", l: "Enero" }, { v: "2", l: "Febrero" }, { v: "3", l: "Marzo" },
  { v: "4", l: "Abril" }, { v: "5", l: "Mayo" }, { v: "6", l: "Junio" },
  { v: "7", l: "Julio" }, { v: "8", l: "Agosto" }, { v: "9", l: "Septiembre" },
  { v: "10", l: "Octubre" }, { v: "11", l: "Noviembre" }, { v: "12", l: "Diciembre" },
];

function StatCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: "up" | "down" | "neutral" }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn(
          "text-2xl font-bold mt-1",
          trend === "up" && "text-emerald-600 dark:text-emerald-400",
          trend === "down" && "text-red-600 dark:text-red-400",
        )}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Tab 1: Resumen financiero ───────────────────────────────────────────────

function ResumenTab() {
  const [anio, setAnio] = useState(String(anioActual));
  const [mes, setMes] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["contabilidad-resumen", anio, mes],
    queryFn: () =>
      apiFetch<any>(`/api/contabilidad/informes/resumen-financiero?anio=${anio}${mes ? `&mes=${mes}` : ""}`),
  });

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <Select value={anio} onValueChange={setAnio}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ANIOS.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Todo el año" /></SelectTrigger>
          <SelectContent>
            {MESES.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Ingresos cobrados"
              value={CLP(data.totales.ingresos)}
              sub={`${data.serie.reduce((s: number, m: any) => s + m.cantidadCobros, 0)} cobros pagados`}
              trend="up"
            />
            <StatCard
              label="Gastos (compras)"
              value={CLP(data.totales.gastos)}
              sub={`${data.serie.reduce((s: number, m: any) => s + m.cantidadCompras, 0)} facturas registradas`}
              trend="down"
            />
            <StatCard
              label="Resultado"
              value={CLP(data.totales.resultado)}
              sub={data.totales.resultado >= 0 ? "Superávit" : "Déficit"}
              trend={data.totales.resultado >= 0 ? "up" : "down"}
            />
          </div>

          {/* Tabla mensual */}
          {data.serie.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Detalle por mes</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-2.5 font-medium">Mes</th>
                        <th className="text-right px-4 py-2.5 font-medium text-emerald-700 dark:text-emerald-400">Ingresos</th>
                        <th className="text-right px-4 py-2.5 font-medium text-red-700 dark:text-red-400">Gastos</th>
                        <th className="text-right px-4 py-2.5 font-medium">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.serie.map((s: any) => (
                        <tr key={s.mes} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-medium">{s.label}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                            {s.ingresos > 0 ? CLP(s.ingresos) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-red-700 dark:text-red-400">
                            {s.gastos > 0 ? CLP(s.gastos) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={cn(
                            "px-4 py-2.5 text-right tabular-nums font-medium",
                            s.resultado > 0 ? "text-emerald-700 dark:text-emerald-400" : s.resultado < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground",
                          )}>
                            {s.ingresos === 0 && s.gastos === 0 ? "—" : CLP(s.resultado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/50 font-semibold">
                        <td className="px-4 py-2.5">Total</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{CLP(data.totales.ingresos)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-red-700 dark:text-red-400">{CLP(data.totales.gastos)}</td>
                        <td className={cn(
                          "px-4 py-2.5 text-right tabular-nums",
                          data.totales.resultado >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
                        )}>
                          {CLP(data.totales.resultado)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {data.serie.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No hay cobros pagados ni compras registradas para este período.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 2: Presupuesto proyectado ──────────────────────────────────────────

function PresupuestoTab() {
  const [mesesHistorico, setMesesHistorico] = useState("6");

  const { data, isLoading } = useQuery({
    queryKey: ["contabilidad-presupuesto-real", mesesHistorico],
    queryFn: () =>
      apiFetch<any>(`/api/contabilidad/informes/presupuesto-real?meses=${mesesHistorico}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex gap-3 items-center flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Base histórica</p>
          <Select value={mesesHistorico} onValueChange={setMesesHistorico}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Último año</SelectItem>
              <SelectItem value="24">Últimos 2 años</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {data && (
          <div className="text-xs text-muted-foreground mt-4">
            Basado en datos del {data.fechaDesde} al {data.fechaHasta}
          </div>
        )}
      </div>

      {isLoading && <Skeleton className="h-64" />}

      {data && (
        <>
          {/* Resumen histórico */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Promedio ingresos/mes"
              value={CLP(data.historico.promedioIngresos)}
              sub={`sobre ${data.mesesHistorico} meses`}
              trend="up"
            />
            <StatCard
              label="Promedio gastos/mes"
              value={CLP(data.historico.promedioGastos)}
              sub={`sobre ${data.mesesHistorico} meses`}
              trend="down"
            />
            <StatCard
              label="Resultado promedio/mes"
              value={CLP(data.historico.promedioIngresos - data.historico.promedioGastos)}
              sub="proyectado mensual"
              trend={(data.historico.promedioIngresos - data.historico.promedioGastos) >= 0 ? "up" : "down"}
            />
          </div>

          {/* Proyección 12 meses */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Proyección próximos 12 meses</CardTitle>
              <CardDescription className="text-xs">
                Calculado en base al promedio histórico de los últimos {data.mesesHistorico} meses
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium">Período</th>
                      <th className="text-right px-4 py-2.5 font-medium text-emerald-700 dark:text-emerald-400">Ingresos proy.</th>
                      <th className="text-right px-4 py-2.5 font-medium text-red-700 dark:text-red-400">Gastos proy.</th>
                      <th className="text-right px-4 py-2.5 font-medium">Resultado proy.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.proyeccion.map((p: any) => (
                      <tr key={`${p.anio}-${p.mes}`} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-medium">{p.label}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{CLP(p.ingresosProyectados)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-red-700 dark:text-red-400">{CLP(p.gastosProyectados)}</td>
                        <td className={cn(
                          "px-4 py-2.5 text-right tabular-nums font-medium",
                          p.resultadoProyectado >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
                        )}>
                          {CLP(p.resultadoProyectado)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-semibold">
                      <td className="px-4 py-2.5">Total anual proyectado</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                        {CLP(data.proyeccion.reduce((s: number, p: any) => s + p.ingresosProyectados, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-red-700 dark:text-red-400">
                        {CLP(data.proyeccion.reduce((s: number, p: any) => s + p.gastosProyectados, 0))}
                      </td>
                      <td className={cn(
                        "px-4 py-2.5 text-right tabular-nums",
                        data.historico.promedioIngresos >= data.historico.promedioGastos
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-red-700 dark:text-red-400",
                      )}>
                        {CLP(data.proyeccion.reduce((s: number, p: any) => s + p.resultadoProyectado, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {data.historico.mesesConIngresos === 0 && data.historico.mesesConGastos === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No hay datos históricos suficientes para calcular una proyección. Registra cobros y compras para ver el presupuesto.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 3: Libro diario (desde asientos) ───────────────────────────────────

function LibroDiarioTab() {
  const [periodoDesde, setPeriodoDesde] = useState(() => {
    const h = new Date();
    return `${h.getFullYear()}${String(h.getMonth() + 1).padStart(2, "0")}`;
  });
  const [periodoHasta, setPeriodoHasta] = useState(periodoDesde);

  const { data, isLoading } = useQuery({
    queryKey: ["libro-diario", periodoDesde, periodoHasta],
    queryFn: () =>
      apiFetch<any[]>(`/api/contabilidad/informes/libro-diario?periodoDesde=${periodoDesde}&periodoHasta=${periodoHasta}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex gap-3 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Período desde (AAAAMM)</p>
          <input
            className="border rounded px-3 py-1.5 text-sm w-32 bg-background"
            value={periodoDesde}
            onChange={(e) => setPeriodoDesde(e.target.value)}
            maxLength={6}
          />
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Período hasta (AAAAMM)</p>
          <input
            className="border rounded px-3 py-1.5 text-sm w-32 bg-background"
            value={periodoHasta}
            onChange={(e) => setPeriodoHasta(e.target.value)}
            maxLength={6}
          />
        </div>
      </div>

      {isLoading && <Skeleton className="h-48" />}

      {data && data.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay asientos contabilizados en este período.
          </CardContent>
        </Card>
      )}

      {data && data.map((asiento: any) => (
        <Card key={asiento.id} className="overflow-hidden">
          <CardHeader className="py-3 px-4 bg-muted/30 border-b">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-muted-foreground">{asiento.numero}</span>
                <span className="font-medium text-sm">{asiento.descripcion}</span>
              </div>
              <span className="text-xs text-muted-foreground">{asiento.fecha}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Cuenta</th>
                  <th className="text-right px-4 py-2">Debe</th>
                  <th className="text-right px-4 py-2">Haber</th>
                </tr>
              </thead>
              <tbody>
                {asiento.lineas?.map((l: any) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{l.cuentaCodigo}</span>
                      {l.cuentaNombre}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {parseFloat(l.debe) > 0 ? CLP(parseFloat(l.debe)) : ""}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {parseFloat(l.haber) > 0 ? CLP(parseFloat(l.haber)) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Tab 4: Cálculo IVA F29 ─────────────────────────────────────────────────

function CalculoIvaTab() {
  const [periodo, setPeriodo] = useState(() => {
    const h = new Date();
    return `${h.getFullYear()}${String(h.getMonth() + 1).padStart(2, "0")}`;
  });

  const { data, isLoading } = useQuery({
    queryKey: ["calculo-iva", periodo],
    queryFn: () => apiFetch<any>(`/api/contabilidad/informes/calculo-iva?periodo=${periodo}`),
    enabled: /^\d{6}$/.test(periodo),
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Período (AAAAMM)</p>
        <input
          className="border rounded px-3 py-1.5 text-sm w-32 bg-background"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          maxLength={6}
        />
      </div>

      {isLoading && <Skeleton className="h-64" />}

      {data?.f29 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Ventas */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Ventas del período</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Neto</span><span className="tabular-nums font-medium">{CLP(data.f29.ventasNetas)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Exento</span><span className="tabular-nums">{CLP(data.f29.ventasExentas)}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-semibold">IVA débito (19%)</span><span className="tabular-nums font-bold">{CLP(data.f29.ivaDebito)}</span></div>
            </CardContent>
          </Card>

          {/* Compras */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-red-700 dark:text-red-400">Compras del período</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Neto</span><span className="tabular-nums font-medium">{CLP(data.f29.comprasNetas)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IVA no recuperable</span><span className="tabular-nums">{CLP(data.f29.ivaNoRecuperable)}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-semibold">IVA crédito</span><span className="tabular-nums font-bold">{CLP(data.f29.ivaCredito)}</span></div>
            </CardContent>
          </Card>

          {/* Determinación */}
          <Card className={cn(
            "md:col-span-2 border-2",
            data.f29.situacion === "pago" && "border-red-500",
            data.f29.situacion === "remanente" && "border-emerald-500",
            data.f29.situacion === "cero" && "border-muted",
          )}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Determinación IVA — Formulario 29</p>
                  <p className={cn(
                    "text-3xl font-bold mt-1",
                    data.f29.situacion === "pago" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
                  )}>
                    {CLP(Math.abs(data.f29.ivaDeterminar))}
                  </p>
                </div>
                <Badge
                  className={cn(
                    "text-sm px-4 py-1.5 uppercase font-semibold",
                    data.f29.situacion === "pago" && "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                    data.f29.situacion === "remanente" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
                  )}
                >
                  {data.f29.situacion === "pago" ? "🔴 A pagar al SII" : data.f29.situacion === "remanente" ? "🟢 Remanente crédito" : "Sin movimiento"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {data && !data.f29.ventasNetas && !data.f29.comprasNetas && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay documentos en el libro SII para este período. Importa el libro de compras y ventas primero.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

interface Props { hideHeader?: boolean }

export default function InformesPage({ hideHeader }: Props) {
  const TABS = [
    { value: "resumen", label: "Resumen financiero", icon: BarChart3 },
    { value: "presupuesto", label: "Presupuesto", icon: TrendingUp },
    { value: "libro-diario", label: "Libro diario", icon: BookOpen },
    { value: "iva", label: "Cálculo IVA (F29)", icon: Calculator },
  ];

  return (
    <div className="p-5 space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Informes</h1>
        </div>
      )}

      <Tabs defaultValue="resumen" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="resumen"><ResumenTab /></TabsContent>
        <TabsContent value="presupuesto"><PresupuestoTab /></TabsContent>
        <TabsContent value="libro-diario"><LibroDiarioTab /></TabsContent>
        <TabsContent value="iva"><CalculoIvaTab /></TabsContent>
      </Tabs>
    </div>
  );
}
