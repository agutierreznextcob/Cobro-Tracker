import { useState, Component, type ErrorInfo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, BookOpen, Calculator, TrendingUp, AlertCircle, Scale, BookMarked } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Error boundary ──────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  componentDidCatch(_e: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.error) {
      return (
        <Card className="border-destructive">
          <CardContent className="py-10 text-center space-y-2">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="font-medium text-destructive">Error al cargar el informe</p>
            <p className="text-sm text-muted-foreground">{this.state.error}</p>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const CLP = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

const anioActual = new Date().getFullYear();
const mesActual = String(new Date().getMonth() + 1).padStart(2, "0");
const periodoActual = `${anioActual}${mesActual}`;

const ANIOS = Array.from({ length: 5 }, (_, i) => anioActual - i);
const MESES = [
  { v: "01", l: "Enero" }, { v: "02", l: "Febrero" }, { v: "03", l: "Marzo" },
  { v: "04", l: "Abril" }, { v: "05", l: "Mayo" }, { v: "06", l: "Junio" },
  { v: "07", l: "Julio" }, { v: "08", l: "Agosto" }, { v: "09", l: "Septiembre" },
  { v: "10", l: "Octubre" }, { v: "11", l: "Noviembre" }, { v: "12", l: "Diciembre" },
];

function PeriodoSelector({
  anio, setAnio, mesDesde, setMesDesde, mesHasta, setMesHasta,
}: {
  anio: string; setAnio: (v: string) => void;
  mesDesde: string; setMesDesde: (v: string) => void;
  mesHasta: string; setMesHasta: (v: string) => void;
}) {
  return (
    <div className="flex gap-3 flex-wrap items-end">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Año</p>
        <Select value={anio} onValueChange={setAnio}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{ANIOS.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Mes desde</p>
        <Select value={mesDesde} onValueChange={setMesDesde}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{MESES.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Mes hasta</p>
        <Select value={mesHasta} onValueChange={setMesHasta}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{MESES.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: "up" | "down" }) {
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

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

// ─── Tab 1: Estado de Resultados ─────────────────────────────────────────────

function EstadoResultadoTab() {
  const [anio, setAnio] = useState(String(anioActual));
  const [mesDesde, setMesDesde] = useState("01");
  const [mesHasta, setMesHasta] = useState(mesActual);

  const periodoDesde = `${anio}${mesDesde}`;
  const periodoHasta = `${anio}${mesHasta}`;

  // Datos reales de cobros y compras
  const { data: resumen, isLoading: loadingResumen } = useQuery({
    queryKey: ["resumen-financiero", anio],
    queryFn: () => apiFetch<any>(`/api/contabilidad/informes/resumen-financiero?anio=${anio}`),
  });

  // Datos contables de asientos
  const { data, isLoading, error } = useQuery({
    queryKey: ["estado-resultado", periodoDesde, periodoHasta],
    queryFn: () => apiFetch<any>(`/api/contabilidad/informes/estado-resultado?periodoDesde=${periodoDesde}&periodoHasta=${periodoHasta}`),
  });

  const ingresos = data?.lineas?.filter((r: any) => r.tipo === "ingreso") ?? [];
  const egresos = data?.lineas?.filter((r: any) => r.tipo === "egreso") ?? [];
  const totalIngresos: number = data?.totalIngresos ?? 0;
  const totalEgresos: number = data?.totalEgresos ?? 0;
  const resultado: number = data?.utilidadNeta ?? 0;

  // Totales del resumen real (cobros + compras)
  const totalesReales = resumen?.totales ?? { ingresos: 0, gastos: 0, resultado: 0 };
  const hayDatosReales = totalesReales.ingresos > 0 || totalesReales.gastos > 0;

  return (
    <div className="space-y-5">
      <PeriodoSelector anio={anio} setAnio={setAnio} mesDesde={mesDesde} setMesDesde={setMesDesde} mesHasta={mesHasta} setMesHasta={setMesHasta} />

      {/* Resumen financiero real (cobros + compras) */}
      {loadingResumen && <Skeleton className="h-20" />}
      {!loadingResumen && hayDatosReales && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Datos reales del año {anio} (cobros y compras)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label="Ingresos cobrados" value={CLP(totalesReales.ingresos)} trend="up" sub={`${resumen?.serie?.reduce((s: number, m: any) => s + m.cantidadCobros, 0) ?? 0} cobros pagados`} />
            <StatCard label="Gastos (compras)" value={CLP(totalesReales.gastos)} trend="down" sub={`${resumen?.serie?.reduce((s: number, m: any) => s + m.cantidadCompras, 0) ?? 0} compras`} />
            <StatCard label="Resultado real" value={CLP(totalesReales.resultado)} trend={totalesReales.resultado >= 0 ? "up" : "down"} sub={totalesReales.resultado >= 0 ? "Excedente" : "Déficit"} />
          </div>
        </div>
      )}

      {/* Divisor */}
      <div className="border-t pt-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Estado de resultado contable (asientos)</p>
      </div>

      {isLoading && <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>}
      {error && <EmptyState text={`Error: ${(error as Error).message}`} />}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total Ingresos" value={CLP(totalIngresos)} trend="up" />
            <StatCard label="Total Egresos" value={CLP(totalEgresos)} trend="down" />
            <StatCard
              label="Resultado"
              value={CLP(resultado)}
              sub={resultado >= 0 ? "Utilidad del período" : "Pérdida del período"}
              trend={resultado >= 0 ? "up" : "down"}
            />
          </div>

          {ingresos.length === 0 && egresos.length === 0 ? (
            <EmptyState text="No hay asientos contabilizados en este período. Registra asientos contables para ver el estado de resultados." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium">Cuenta</th>
                      <th className="text-right px-4 py-2.5 font-medium">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingresos.length > 0 && (
                      <>
                        <tr className="bg-emerald-50 dark:bg-emerald-950/20">
                          <td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider">Ingresos</td>
                        </tr>
                        {ingresos.map((r: any) => (
                          <tr key={r.cuentaId} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-2.5">
                              <span className="font-mono text-xs text-muted-foreground mr-2">{r.codigo}</span>
                              {r.nombre}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{CLP(r.neto)}</td>
                          </tr>
                        ))}
                        <tr className="border-b bg-emerald-50/60 dark:bg-emerald-950/10 font-semibold">
                          <td className="px-4 py-2.5">Total Ingresos</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{CLP(totalIngresos)}</td>
                        </tr>
                      </>
                    )}
                    {egresos.length > 0 && (
                      <>
                        <tr className="bg-red-50 dark:bg-red-950/20">
                          <td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase text-red-700 dark:text-red-400 tracking-wider">Egresos</td>
                        </tr>
                        {egresos.map((r: any) => (
                          <tr key={r.cuentaId} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-2.5">
                              <span className="font-mono text-xs text-muted-foreground mr-2">{r.codigo}</span>
                              {r.nombre}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-red-700 dark:text-red-400">{CLP(r.neto)}</td>
                          </tr>
                        ))}
                        <tr className="border-b bg-red-50/60 dark:bg-red-950/10 font-semibold">
                          <td className="px-4 py-2.5">Total Egresos</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-red-700 dark:text-red-400">{CLP(totalEgresos)}</td>
                        </tr>
                      </>
                    )}
                    <tr className={cn("font-bold", resultado >= 0 ? "bg-emerald-100 dark:bg-emerald-900/20" : "bg-red-100 dark:bg-red-900/20")}>
                      <td className="px-4 py-3">{resultado >= 0 ? "✅ Utilidad del período" : "🔴 Pérdida del período"}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", resultado >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>{CLP(Math.abs(resultado))}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 2: Libro Diario ─────────────────────────────────────────────────────

function LibroDiarioTab() {
  const [periodoDesde, setPeriodoDesde] = useState(periodoActual);
  const [periodoHasta, setPeriodoHasta] = useState(periodoActual);

  const { data, isLoading, error } = useQuery({
    queryKey: ["libro-diario", periodoDesde, periodoHasta],
    queryFn: () => apiFetch<any[]>(`/api/contabilidad/informes/libro-diario?periodoDesde=${periodoDesde}&periodoHasta=${periodoHasta}`),
    enabled: /^\d{6}$/.test(periodoDesde) && /^\d{6}$/.test(periodoHasta),
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
      {error && <EmptyState text={`Error: ${(error as Error).message}`} />}

      {data && data.length === 0 && (
        <EmptyState text="No hay asientos contabilizados en este período." />
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

// ─── Tab 3: Cálculo IVA F29 ──────────────────────────────────────────────────

function CalculoIvaTab() {
  const [periodo, setPeriodo] = useState(periodoActual);

  const { data, isLoading, error } = useQuery({
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
      {error && <EmptyState text={`Error: ${(error as Error).message}`} />}

      {data?.f29 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <Badge className={cn(
                  "text-sm px-4 py-1.5 uppercase font-semibold",
                  data.f29.situacion === "pago" && "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                  data.f29.situacion === "remanente" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
                )}>
                  {data.f29.situacion === "pago" ? "🔴 A pagar al SII" : data.f29.situacion === "remanente" ? "🟢 Remanente crédito" : "Sin movimiento"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {data && !data.f29?.ventasNetas && !data.f29?.comprasNetas && (
        <EmptyState text="No hay documentos en el libro SII para este período. Importa el libro de compras y ventas primero." />
      )}
    </div>
  );
}

// ─── Tab 4: Balance 8 Columnas ───────────────────────────────────────────────

function Balance8ColTab() {
  const [anio, setAnio] = useState(String(anioActual));
  const [mesDesde, setMesDesde] = useState("01");
  const [mesHasta, setMesHasta] = useState(mesActual);

  const periodoDesde = `${anio}${mesDesde}`;
  const periodoHasta = `${anio}${mesHasta}`;

  const { data, isLoading, error } = useQuery({
    queryKey: ["balance-8col", periodoDesde, periodoHasta],
    queryFn: () => apiFetch<any[]>(`/api/contabilidad/informes/balance-8col?periodoDesde=${periodoDesde}&periodoHasta=${periodoHasta}`),
  });

  const filas = data?.filter((r: any) => r.saldoAntDebe + r.saldoAntHaber + r.movDebe + r.movHaber > 0) ?? [];

  return (
    <div className="space-y-5">
      <PeriodoSelector anio={anio} setAnio={setAnio} mesDesde={mesDesde} setMesDesde={setMesDesde} mesHasta={mesHasta} setMesHasta={setMesHasta} />

      {isLoading && <Skeleton className="h-64" />}
      {error && <EmptyState text={`Error: ${(error as Error).message}`} />}

      {data && filas.length === 0 && (
        <EmptyState text="No hay movimientos en el período. El balance de 8 columnas requiere asientos contabilizados y un plan de cuentas activo." />
      )}

      {filas.length > 0 && (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium" rowSpan={2}>Cuenta</th>
                <th className="text-center px-2 py-1 font-medium border-l" colSpan={2}>Saldo Anterior</th>
                <th className="text-center px-2 py-1 font-medium border-l" colSpan={2}>Movimientos</th>
                <th className="text-center px-2 py-1 font-medium border-l" colSpan={2}>Saldo Final</th>
              </tr>
              <tr className="border-b bg-muted/20 text-muted-foreground">
                <th className="text-right px-2 py-1 border-l">Debe</th>
                <th className="text-right px-2 py-1">Haber</th>
                <th className="text-right px-2 py-1 border-l">Debe</th>
                <th className="text-right px-2 py-1">Haber</th>
                <th className="text-right px-2 py-1 border-l">Debe</th>
                <th className="text-right px-2 py-1">Haber</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((r: any) => (
                <tr key={r.cuentaId} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <span className="font-mono text-muted-foreground mr-1">{r.codigo}</span>
                    <span>{r.nombre}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums border-l">{r.saldoAntDebe > 0 ? CLP(r.saldoAntDebe) : ""}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.saldoAntHaber > 0 ? CLP(r.saldoAntHaber) : ""}</td>
                  <td className="px-2 py-2 text-right tabular-nums border-l">{r.movDebe > 0 ? CLP(r.movDebe) : ""}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.movHaber > 0 ? CLP(r.movHaber) : ""}</td>
                  <td className="px-2 py-2 text-right tabular-nums border-l font-medium">{r.saldoFinalDebe > 0 ? CLP(r.saldoFinalDebe) : ""}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium">{r.saldoFinalHaber > 0 ? CLP(r.saldoFinalHaber) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab 5: Libro Mayor ──────────────────────────────────────────────────────

function LibroMayorTab() {
  const [anio, setAnio] = useState(String(anioActual));
  const [mesDesde, setMesDesde] = useState("01");
  const [mesHasta, setMesHasta] = useState(mesActual);
  const [cuentaId, setCuentaId] = useState<string>("");

  const periodoDesde = `${anio}${mesDesde}`;
  const periodoHasta = `${anio}${mesHasta}`;

  // Cargar plan de cuentas para el selector
  const { data: cuentas = [] } = useQuery({
    queryKey: ["plan-cuentas-lista"],
    queryFn: () => apiFetch<any[]>("/api/contabilidad/plan-cuentas"),
    select: (d: any[]) => d.filter((c) => c.esHoja && c.activa).sort((a, b) => a.codigo.localeCompare(b.codigo)),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["libro-mayor", cuentaId, periodoDesde, periodoHasta],
    queryFn: () => apiFetch<any>(`/api/contabilidad/informes/libro-mayor?cuentaId=${cuentaId}&periodoDesde=${periodoDesde}&periodoHasta=${periodoHasta}`),
    enabled: !!cuentaId && /^\d{6}$/.test(periodoDesde) && /^\d{6}$/.test(periodoHasta),
  });

  const movimientos: any[] = data?.movimientos ?? [];
  const saldoAnterior: number = data?.saldoAnterior ?? 0;
  const cuenta = data?.cuenta;

  return (
    <div className="space-y-5">
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-56">
          <p className="text-xs text-muted-foreground mb-1">Cuenta contable</p>
          <Select value={cuentaId} onValueChange={setCuentaId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar cuenta..." />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {cuentas.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  <span className="font-mono text-xs text-muted-foreground mr-2">{c.codigo}</span>{c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <PeriodoSelector anio={anio} setAnio={setAnio} mesDesde={mesDesde} setMesDesde={setMesDesde} mesHasta={mesHasta} setMesHasta={setMesHasta} />
      </div>

      {!cuentaId && (
        <EmptyState text="Selecciona una cuenta del plan de cuentas para ver su libro mayor." />
      )}

      {isLoading && <Skeleton className="h-48" />}
      {error && <EmptyState text={`Error: ${(error as Error).message}`} />}

      {data && cuenta && (
        <>
          {/* Encabezado cuenta */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border">
            <div>
              <p className="font-mono text-sm font-semibold text-muted-foreground">{cuenta.codigo}</p>
              <p className="font-semibold">{cuenta.nombre}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-muted-foreground">Saldo anterior</p>
              <p className={cn("font-bold tabular-nums", saldoAnterior >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{CLP(saldoAnterior)}</p>
            </div>
          </div>

          {movimientos.length === 0 ? (
            <EmptyState text="No hay movimientos para esta cuenta en el período seleccionado." />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2.5 font-medium text-xs">Fecha</th>
                    <th className="text-left px-3 py-2.5 font-medium text-xs">N° Asiento</th>
                    <th className="text-left px-3 py-2.5 font-medium text-xs">Descripción</th>
                    <th className="text-right px-3 py-2.5 font-medium text-xs">Debe</th>
                    <th className="text-right px-3 py-2.5 font-medium text-xs">Haber</th>
                    <th className="text-right px-3 py-2.5 font-medium text-xs">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Fila de saldo anterior */}
                  <tr className="border-b bg-muted/20">
                    <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={3}>
                      <span className="font-semibold">Saldo anterior al período</span>
                    </td>
                    <td className="px-3 py-2 text-right" />
                    <td className="px-3 py-2 text-right" />
                    <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", saldoAnterior >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                      {CLP(saldoAnterior)}
                    </td>
                  </tr>
                  {movimientos.map((m: any, idx: number) => {
                    const debe = parseFloat(m.debe ?? "0");
                    const haber = parseFloat(m.haber ?? "0");
                    return (
                      <tr key={m.lineaId ?? idx} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{m.fecha}</td>
                        <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{m.numero}</td>
                        <td className="px-3 py-2 text-xs">
                          <p>{m.descripcionAsiento}</p>
                          {m.descripcionLinea && m.descripcionLinea !== m.descripcionAsiento && (
                            <p className="text-muted-foreground">{m.descripcionLinea}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs">{debe > 0 ? CLP(debe) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs">{haber > 0 ? CLP(haber) : ""}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums text-xs font-semibold", m.saldo >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                          {CLP(m.saldo)}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totales */}
                  <tr className="border-t-2 bg-muted/40 font-semibold">
                    <td className="px-3 py-2.5 text-xs" colSpan={3}>Totales del período</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {CLP(movimientos.reduce((s: number, m: any) => s + parseFloat(m.debe ?? "0"), 0))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {CLP(movimientos.reduce((s: number, m: any) => s + parseFloat(m.haber ?? "0"), 0))}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums text-xs",
                      (movimientos[movimientos.length - 1]?.saldo ?? 0) >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-red-700 dark:text-red-400"
                    )}>
                      {CLP(movimientos[movimientos.length - 1]?.saldo ?? 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 6: Balance Comparativo ──────────────────────────────────────────────

function BalanceComparativoTab() {
  const [anio1, setAnio1] = useState(String(anioActual));
  const [mes1Desde, setMes1Desde] = useState("01");
  const [mes1Hasta, setMes1Hasta] = useState(mesActual);

  const [anio2, setAnio2] = useState(String(anioActual - 1));
  const [mes2Desde, setMes2Desde] = useState("01");
  const [mes2Hasta, setMes2Hasta] = useState(mesActual);

  const [areaId, setAreaId] = useState<string>("_todas");

  // Cargar áreas
  const { data: areas = [] } = useQuery({
    queryKey: ["areas-org"],
    queryFn: () => apiFetch<any[]>("/api/areas"),
  });

  // Generar lista de períodos para ambos rangos
  const buildPeriodos = (anio: string, mesD: string, mesH: string): string[] => {
    const from = parseInt(mesD);
    const to = parseInt(mesH);
    const a = parseInt(anio);
    const result: string[] = [];
    for (let m = from; m <= to; m++) {
      result.push(`${a}${String(m).padStart(2, "0")}`);
    }
    return result;
  };

  const periodos1 = buildPeriodos(anio1, mes1Desde, mes1Hasta);
  const periodos2 = buildPeriodos(anio2, mes2Desde, mes2Hasta);
  const todosLosPeriodos = [...new Set([...periodos1, ...periodos2])];

  const { data: rawData, isLoading, error } = useQuery({
    queryKey: ["balance-comparativo", todosLosPeriodos.join(",")],
    queryFn: () => apiFetch<any>(`/api/contabilidad/informes/balance-comparativo?periodos=${todosLosPeriodos.join(",")}`),
    enabled: todosLosPeriodos.length > 0,
  });

  // Procesar datos: agrupar movimientos por cuenta y período
  const movimientos: any[] = rawData?.movimientos ?? [];

  // Filtrar por área si aplica
  const movsFiltrados = areaId === "_todas"
    ? movimientos
    : movimientos.filter((m: any) => String(m.areaId) === areaId);

  // Agrupar por cuenta y calcular saldo neto por período
  const cuentaMap: Record<string, {
    cuentaId: number; cuentaCodigo: string; cuentaNombre: string;
    p1: number; p2: number;
  }> = {};

  for (const m of movsFiltrados) {
    const key = String(m.cuentaId);
    if (!cuentaMap[key]) {
      cuentaMap[key] = {
        cuentaId: m.cuentaId,
        cuentaCodigo: m.cuentaCodigo,
        cuentaNombre: m.cuentaNombre,
        p1: 0, p2: 0,
      };
    }
    const neto = (m.sumaDebe ?? 0) - (m.sumaHaber ?? 0);
    if (periodos1.includes(m.periodo)) cuentaMap[key].p1 += neto;
    if (periodos2.includes(m.periodo)) cuentaMap[key].p2 += neto;
  }

  const filas = Object.values(cuentaMap)
    .filter((r) => r.p1 !== 0 || r.p2 !== 0)
    .sort((a, b) => a.cuentaCodigo.localeCompare(b.cuentaCodigo));

  const totalP1 = filas.reduce((s, r) => s + r.p1, 0);
  const totalP2 = filas.reduce((s, r) => s + r.p2, 0);

  const label1 = `${anio1} (${MESES.find(m => m.v === mes1Desde)?.l} – ${MESES.find(m => m.v === mes1Hasta)?.l})`;
  const label2 = `${anio2} (${MESES.find(m => m.v === mes2Desde)?.l} – ${MESES.find(m => m.v === mes2Hasta)?.l})`;

  return (
    <div className="space-y-5">
      {/* Período 1 */}
      <div className="border rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Período 1 (actual)</p>
        <PeriodoSelector anio={anio1} setAnio={setAnio1} mesDesde={mes1Desde} setMesDesde={setMes1Desde} mesHasta={mes1Hasta} setMesHasta={setMes1Hasta} />
      </div>

      {/* Período 2 */}
      <div className="border rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Período 2 (comparativo)</p>
        <PeriodoSelector anio={anio2} setAnio={setAnio2} mesDesde={mes2Desde} setMesDesde={setMes2Desde} mesHasta={mes2Hasta} setMesHasta={setMes2Hasta} />
      </div>

      {/* Filtro área */}
      {areas.length > 0 && (
        <div className="flex items-end gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Centro de negocio / Área</p>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_todas">Todas las áreas</SelectItem>
                {areas.map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {isLoading && <Skeleton className="h-64" />}
      {error && <EmptyState text={`Error: ${(error as Error).message}`} />}

      {rawData && filas.length === 0 && (
        <EmptyState text="No hay movimientos contabilizados en los períodos seleccionados." />
      )}

      {filas.length > 0 && (
        <>
          {/* Resumen rápido */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label={`Total ${anio1}`} value={CLP(Math.abs(totalP1))} trend={totalP1 >= 0 ? "up" : "down"} />
            <StatCard label={`Total ${anio2}`} value={CLP(Math.abs(totalP2))} trend={totalP2 >= 0 ? "up" : "down"} />
            <StatCard
              label="Variación"
              value={totalP2 !== 0 ? `${((totalP1 - totalP2) / Math.abs(totalP2) * 100).toFixed(1)}%` : "—"}
              trend={totalP1 >= totalP2 ? "up" : "down"}
              sub={CLP(totalP1 - totalP2)}
            />
          </div>

          {/* Tabla comparativa */}
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-3 py-2.5 text-xs font-medium">Cuenta</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium">{label1}</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium">{label2}</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium">Variación $</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium">Variación %</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => {
                  const variacion = r.p1 - r.p2;
                  const pct = r.p2 !== 0 ? (variacion / Math.abs(r.p2)) * 100 : null;
                  return (
                    <tr key={r.cuentaId} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-muted-foreground mr-2">{r.cuentaCodigo}</span>
                        {r.cuentaNombre}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{CLP(r.p1)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{CLP(r.p2)}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums font-medium", variacion > 0 ? "text-emerald-700 dark:text-emerald-400" : variacion < 0 ? "text-red-700 dark:text-red-400" : "")}>
                        {variacion !== 0 ? (variacion > 0 ? "+" : "") + CLP(variacion) : "—"}
                      </td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", pct !== null && pct > 0 ? "text-emerald-700 dark:text-emerald-400" : pct !== null && pct < 0 ? "text-red-700 dark:text-red-400" : "")}>
                        {pct !== null ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/40 font-bold">
                  <td className="px-3 py-2.5 text-xs">Total general</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{CLP(totalP1)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{CLP(totalP2)}</td>
                  <td className={cn("px-3 py-2.5 text-right tabular-nums", (totalP1 - totalP2) > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                    {(totalP1 - totalP2) > 0 ? "+" : ""}{CLP(totalP1 - totalP2)}
                  </td>
                  <td className={cn("px-3 py-2.5 text-right tabular-nums", totalP2 !== 0 && (totalP1 - totalP2) / Math.abs(totalP2) > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                    {totalP2 !== 0 ? `${((totalP1 - totalP2) / Math.abs(totalP2) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

interface Props { hideHeader?: boolean }

export default function InformesPage({ hideHeader }: Props) {
  const TABS = [
    { value: "estado-resultado", label: "Estado de Resultado", icon: TrendingUp },
    { value: "libro-diario", label: "Libro Diario", icon: BookOpen },
    { value: "iva", label: "Cálculo IVA (F29)", icon: Calculator },
    { value: "balance", label: "Balance 8 Col.", icon: BarChart3 },
    { value: "libro-mayor", label: "Libro Mayor", icon: BookMarked },
    { value: "balance-comparativo", label: "Balance Comparativo", icon: Scale },
  ];

  return (
    <div className="p-5 space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Informes</h1>
        </div>
      )}

      <Tabs defaultValue="estado-resultado" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="estado-resultado">
          <ErrorBoundary><EstadoResultadoTab /></ErrorBoundary>
        </TabsContent>
        <TabsContent value="libro-diario">
          <ErrorBoundary><LibroDiarioTab /></ErrorBoundary>
        </TabsContent>
        <TabsContent value="iva">
          <ErrorBoundary><CalculoIvaTab /></ErrorBoundary>
        </TabsContent>
        <TabsContent value="balance">
          <ErrorBoundary><Balance8ColTab /></ErrorBoundary>
        </TabsContent>
        <TabsContent value="libro-mayor">
          <ErrorBoundary><LibroMayorTab /></ErrorBoundary>
        </TabsContent>
        <TabsContent value="balance-comparativo">
          <ErrorBoundary><BalanceComparativoTab /></ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
