import { useMemo, useState } from "react";
import {
  useListCobros,
  useGetRendimientoEquipo,
  getGetRendimientoEquipoQueryKey,
} from "@workspace/api-client-react";
import type { Cobro } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  format,
  parseISO,
  startOfDay,
  endOfDay,
  startOfWeek,
  startOfMonth,
  subDays,
  subMonths,
  subYears,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  differenceInCalendarDays,
} from "date-fns";
import { es } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { Download, TrendingUp, Receipt, Percent, ListChecks, TicketPercent, RefreshCcw } from "lucide-react";

type Estado = "pendiente" | "pagado" | "parcial" | "fallido" | "cancelado";
type Gran = "dia" | "semana" | "mes";

const ESTADO_META: Record<Estado, { label: string; color: string }> = {
  pagado: { label: "Pagado", color: "#16a34a" },
  pendiente: { label: "Pendiente", color: "#f59e0b" },
  parcial: { label: "Parcial", color: "#3b82f6" },
  fallido: { label: "Fallido", color: "#ef4444" },
  cancelado: { label: "Cancelado", color: "#6b7280" },
};

const METODO_COLOR = {
  Flow: "#2563eb",
  MercadoPago: "#009ee3",
  Manual: "#f59e0b",
} as const;

type PresetKey = "7d" | "1m" | "3m" | "1y" | "all" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d", label: "Últimos 7 días" },
  { key: "1m", label: "Último mes" },
  { key: "3m", label: "Último trimestre" },
  { key: "1y", label: "Último año" },
  { key: "all", label: "Todo el tiempo" },
];

function bucketStart(d: Date, g: Gran): Date {
  if (g === "dia") return startOfDay(d);
  if (g === "semana") return startOfWeek(d, { weekStartsOn: 1 });
  return startOfMonth(d);
}

function bucketLabel(d: Date, g: Gran): string {
  if (g === "mes") return format(d, "MMM yy", { locale: es });
  return format(d, "d MMM", { locale: es });
}

function metodoLabel(c: Cobro): keyof typeof METODO_COLOR | "Flow + MercadoPago" {
  if (c.flowLinkPago && c.mpPaymentLinkUrl) return "Flow + MercadoPago";
  if (c.flowLinkPago) return "Flow";
  if (c.mpPaymentLinkUrl) return "MercadoPago";
  return "Manual";
}

const compactCLP = (v: number) =>
  new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export default function Informes() {
  const [preset, setPreset] = useState<PresetKey>("1m");
  const [customDesde, setCustomDesde] = useState("");
  const [customHasta, setCustomHasta] = useState("");
  const [granSel, setGranSel] = useState<Gran | "auto">("auto");

  const { user } = useAuth();
  const isOrgAdmin = user?.orgRole === "admin_org";

  const { data: cobros, isLoading } = useListCobros(
    {},
    { query: { queryKey: ["listCobros", {}] as const } },
  );

  const { data: rendimiento } = useGetRendimientoEquipo({
    query: { enabled: isOrgAdmin, queryKey: getGetRendimientoEquipoQueryKey() },
  });

  const minDate = useMemo(() => {
    if (!cobros || cobros.length === 0) return null;
    return cobros.reduce<Date | null>((min, c) => {
      const d = parseISO(c.creadoEn);
      return !min || d < min ? d : min;
    }, null);
  }, [cobros]);

  const range = useMemo(() => {
    const now = new Date();
    const hasta =
      preset === "custom" && customHasta ? endOfDay(parseISO(customHasta)) : endOfDay(now);
    let desde: Date;
    switch (preset) {
      case "7d":
        desde = startOfDay(subDays(now, 6));
        break;
      case "3m":
        desde = startOfDay(subMonths(now, 3));
        break;
      case "1y":
        desde = startOfDay(subYears(now, 1));
        break;
      case "all":
        desde = startOfDay(minDate ?? subYears(now, 1));
        break;
      case "custom":
        desde = customDesde ? startOfDay(parseISO(customDesde)) : startOfDay(subMonths(now, 1));
        break;
      case "1m":
      default:
        desde = startOfDay(subMonths(now, 1));
        break;
    }
    return { desde, hasta };
  }, [preset, customDesde, customHasta, minDate]);

  const filtered = useMemo(() => {
    if (!cobros) return [] as Cobro[];
    return cobros.filter((c) => {
      const d = parseISO(c.creadoEn);
      return d >= range.desde && d <= range.hasta;
    });
  }, [cobros, range]);

  const gran: Gran = useMemo(() => {
    if (granSel !== "auto") return granSel;
    const days = differenceInCalendarDays(range.hasta, range.desde);
    if (days <= 31) return "dia";
    if (days <= 180) return "semana";
    return "mes";
  }, [granSel, range]);

  const recaudadoData = useMemo(() => {
    let starts: Date[];
    try {
      if (gran === "dia") starts = eachDayOfInterval({ start: range.desde, end: range.hasta });
      else if (gran === "semana")
        starts = eachWeekOfInterval({ start: range.desde, end: range.hasta }, { weekStartsOn: 1 });
      else starts = eachMonthOfInterval({ start: range.desde, end: range.hasta });
    } catch {
      starts = [];
    }
    const buckets = new Map<number, number>();
    for (const s of starts) buckets.set(bucketStart(s, gran).getTime(), 0);
    for (const c of filtered) {
      if (c.estado !== "pagado") continue;
      const key = bucketStart(parseISO(c.creadoEn), gran).getTime();
      const recaudado = c.montoACobrar ?? c.monto - (c.montoDescuento ?? 0);
      buckets.set(key, (buckets.get(key) ?? 0) + recaudado);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, monto]) => ({ label: bucketLabel(new Date(t), gran), monto }));
  }, [filtered, range, gran]);

  const metodoData = useMemo(() => {
    let flow = 0;
    let mp = 0;
    let manual = 0;
    for (const c of filtered) {
      if (c.flowLinkPago) flow++;
      else if (c.mpPaymentLinkUrl) mp++;
      else manual++;
    }
    return [
      { name: "Flow", value: flow, color: METODO_COLOR.Flow },
      { name: "MercadoPago", value: mp, color: METODO_COLOR.MercadoPago },
      { name: "Manual", value: manual, color: METODO_COLOR.Manual },
    ].filter((d) => d.value > 0);
  }, [filtered]);

  const estadoData = useMemo(() => {
    const counts: Record<Estado, number> = {
      pagado: 0,
      pendiente: 0,
      parcial: 0,
      fallido: 0,
      cancelado: 0,
    };
    for (const c of filtered) counts[c.estado as Estado] = (counts[c.estado as Estado] ?? 0) + 1;
    return (Object.keys(ESTADO_META) as Estado[]).map((e) => ({
      estado: e,
      label: ESTADO_META[e].label,
      cantidad: counts[e],
      color: ESTADO_META[e].color,
    }));
  }, [filtered]);

  const montoCobrar = (c: Cobro) => c.montoACobrar ?? c.monto - (c.montoDescuento ?? 0);
  const tieneDescuento = (c: Cobro) => (c.montoDescuento ?? 0) > 0;

  const summary = useMemo(() => {
    const pagados = filtered.filter((c) => c.estado === "pagado");
    const totalRecaudado = pagados.reduce((a, c) => a + montoCobrar(c), 0);
    const countPagado = pagados.length;
    const totalCobros = filtered.length;
    const ticket = countPagado > 0 ? totalRecaudado / countPagado : 0;
    const tasa = totalCobros > 0 ? (countPagado / totalCobros) * 100 : 0;

    // Discount metrics across all filtered cobros.
    const conDescuento = filtered.filter(tieneDescuento);
    const countConDescuento = conDescuento.length;
    const totalDescuento = conDescuento.reduce((a, c) => a + (c.montoDescuento ?? 0), 0);

    // Recovery rate: amount actually collected on paid cobros vs their original value.
    const originalPagado = pagados.reduce((a, c) => a + c.monto, 0);
    const tasaRecuperacion = originalPagado > 0 ? (totalRecaudado / originalPagado) * 100 : 0;

    return {
      totalRecaudado,
      countPagado,
      totalCobros,
      ticket,
      tasa,
      countConDescuento,
      totalDescuento,
      tasaRecuperacion,
    };
  }, [filtered]);

  // Paid cobros: full price vs. with discount (for the chart).
  const recuperacionData = useMemo(() => {
    const pagados = filtered.filter((c) => c.estado === "pagado");
    const completos = pagados.filter((c) => !tieneDescuento(c));
    const conDescuento = pagados.filter(tieneDescuento);
    return [
      {
        name: "Pago completo",
        cantidad: completos.length,
        monto: completos.reduce((a, c) => a + montoCobrar(c), 0),
        color: "#16a34a",
      },
      {
        name: "Pago con descuento",
        cantidad: conDescuento.length,
        monto: conDescuento.reduce((a, c) => a + montoCobrar(c), 0),
        color: "#f59e0b",
      },
    ];
  }, [filtered]);

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const detalle = filtered.map((c) => ({
      Fecha: format(parseISO(c.creadoEn), "dd-MM-yyyy HH:mm", { locale: es }),
      Descripción: c.descripcion,
      Cliente: c.clienteNombre ?? "",
      "Monto original": c.monto,
      "Neto (sin IVA)": c.incluyeIva ? c.montoNeto ?? 0 : "",
      "IVA (19%)": c.incluyeIva ? c.montoIva ?? 0 : "",
      "Descuento aplicado": c.montoDescuento ?? 0,
      "Monto a cobrar": montoCobrar(c),
      Estado: ESTADO_META[c.estado as Estado]?.label ?? c.estado,
      Método: metodoLabel(c),
      ...(isOrgAdmin ? { "Ejecutivo responsable": c.responsableNombre ?? "Sin asignar" } : {}),
      Referencia: c.referencia ?? "",
    }));
    const wsDetalle = XLSX.utils.json_to_sheet(detalle);
    wsDetalle["!cols"] = [
      { wch: 18 },
      { wch: 40 },
      { wch: 24 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      ...(isOrgAdmin ? [{ wch: 24 }] : []),
      { wch: 22 },
    ];

    const resumenRows: (string | number)[][] = [
      ["Informe de cobros — NextCob"],
      ["Período", `${format(range.desde, "dd-MM-yyyy")} a ${format(range.hasta, "dd-MM-yyyy")}`],
      [],
      ["Total recaudado (CLP)", Math.round(summary.totalRecaudado)],
      ["Cobros pagados", summary.countPagado],
      ["Total de cobros generados", summary.totalCobros],
      ["Ticket promedio (CLP)", Math.round(summary.ticket)],
      ["Tasa de cobro efectiva (%)", Number(summary.tasa.toFixed(1))],
      ["Cobros con descuento", summary.countConDescuento],
      ["Total descontado (CLP)", Math.round(summary.totalDescuento)],
      ["Tasa de recuperación (%)", Number(summary.tasaRecuperacion.toFixed(1))],
      [],
      ["Cobros por estado", "Cantidad"],
      ...estadoData.map((e) => [e.label, e.cantidad]),
      [],
      ["Cobros por método", "Cantidad"],
      ...metodoData.map((m) => [m.name, m.value]),
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    wsResumen["!cols"] = [{ wch: 30 }, { wch: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle");
    XLSX.writeFile(
      wb,
      `informe-cobros-${format(range.desde, "yyyyMMdd")}-${format(range.hasta, "yyyyMMdd")}.xlsx`,
    );
  }

  const sinDatos = !isLoading && filtered.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Informes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading
              ? "Cargando..."
              : `${filtered.length} cobro${filtered.length !== 1 ? "s" : ""} en el período`}
          </p>
        </div>
        <Button onClick={exportExcel} disabled={isLoading || filtered.length === 0} className="gap-2">
          <Download className="h-4 w-4" />
          Descargar Excel
        </Button>
      </div>

      {/* Period selector */}
      <Card className="p-4 shadow-sm space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Desde</label>
            <Input
              type="date"
              value={customDesde}
              max={customHasta || undefined}
              onChange={(e) => {
                setCustomDesde(e.target.value);
                setPreset("custom");
              }}
              className="h-8 w-[150px] text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Hasta</label>
            <Input
              type="date"
              value={customHasta}
              min={customDesde || undefined}
              onChange={(e) => {
                setCustomHasta(e.target.value);
                setPreset("custom");
              }}
              className="h-8 w-[150px] text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Agrupar por</label>
            <Select value={granSel} onValueChange={(v) => setGranSel(v as Gran | "auto")}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-xs">Automático</SelectItem>
                <SelectItem value="dia" className="text-xs">Día</SelectItem>
                <SelectItem value="semana" className="text-xs">Semana</SelectItem>
                <SelectItem value="mes" className="text-xs">Mes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground ml-auto self-center">
            {format(range.desde, "d MMM yyyy", { locale: es })} —{" "}
            {format(range.hasta, "d MMM yyyy", { locale: es })}
          </p>
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total recaudado"
          value={formatCurrency(summary.totalRecaudado)}
          accent="text-emerald-600"
        />
        <SummaryCard
          icon={<Receipt className="h-4 w-4" />}
          label="Ticket promedio"
          value={formatCurrency(summary.ticket)}
        />
        <SummaryCard
          icon={<Percent className="h-4 w-4" />}
          label="Tasa de cobro efectiva"
          value={`${summary.tasa.toFixed(1)}%`}
          sub={`${summary.countPagado} de ${summary.totalCobros} pagados`}
        />
        <SummaryCard
          icon={<RefreshCcw className="h-4 w-4" />}
          label="Tasa de recuperación"
          value={`${summary.tasaRecuperacion.toFixed(1)}%`}
          sub="Recaudado vs. monto original (pagados)"
          accent="text-emerald-600"
        />
        <SummaryCard
          icon={<TicketPercent className="h-4 w-4" />}
          label="Cobros con descuento"
          value={String(summary.countConDescuento)}
          sub={`${formatCurrency(summary.totalDescuento)} descontado`}
          accent="text-amber-600"
        />
        <SummaryCard
          icon={<ListChecks className="h-4 w-4" />}
          label="Total de cobros"
          value={String(summary.totalCobros)}
        />
      </div>

      {/* Counts by estado chips */}
      <div className="flex flex-wrap gap-2">
        {estadoData.map((e) => (
          <span
            key={e.estado}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
            {e.label}
            <span className="font-semibold">{e.cantidad}</span>
          </span>
        ))}
      </div>

      {/* Recaudado over time */}
      <Card className="p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Monto recaudado por período</h2>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {gran === "dia" ? "Por día" : gran === "semana" ? "Por semana" : "Por mes"}
          </span>
        </div>
        {sinDatos ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            {recaudadoData.length > 31 ? (
              <BarChart data={recaudadoData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactCLP} width={48} />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v), "Recaudado"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="monto" fill="#16a34a" radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={recaudadoData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactCLP} width={48} />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v), "Recaudado"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Line
                  type="monotone"
                  dataKey="monto"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </Card>

      {/* Pie método + Bar estado */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4">Cobros por método de pago</h2>
          {sinDatos || metodoData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={metodoData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  labelLine={false}
                  style={{ fontSize: 11 }}
                >
                  {metodoData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number, n) => [`${v} cobro${v !== 1 ? "s" : ""}`, n]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4">Cobros por estado</h2>
          {sinDatos ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={estadoData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                <Tooltip
                  formatter={(v: number) => [`${v} cobro${v !== 1 ? "s" : ""}`, "Cantidad"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  cursor={{ fill: "hsl(var(--muted))" }}
                />
                <Bar dataKey="cantidad" radius={[3, 3, 0, 0]}>
                  {estadoData.map((d) => (
                    <Cell key={d.estado} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Recuperación: pago completo vs. con descuento */}
      <Card className="p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Cobros pagados: completo vs. con descuento</h2>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Monto recaudado
          </span>
        </div>
        {sinDatos || summary.countPagado === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={recuperacionData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={compactCLP} width={48} />
              <Tooltip
                formatter={(v: number, _n, item) => [
                  `${formatCurrency(v)} · ${item?.payload?.cantidad ?? 0} cobro${(item?.payload?.cantidad ?? 0) !== 1 ? "s" : ""}`,
                  "Recaudado",
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                cursor={{ fill: "hsl(var(--muted))" }}
              />
              <Bar dataKey="monto" radius={[3, 3, 0, 0]}>
                {recuperacionData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Team performance (admin only) */}
      {isOrgAdmin && rendimiento && rendimiento.length > 0 && (
        <Card className="p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4">Rendimiento del equipo</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ejecutivo</TableHead>
                  <TableHead className="text-right">Asignados</TableHead>
                  <TableHead className="text-right">Pagados</TableHead>
                  <TableHead className="text-right">Pendientes</TableHead>
                  <TableHead className="text-right">Recaudado</TableHead>
                  <TableHead className="text-right">Por cobrar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rendimiento.map((r) => (
                  <TableRow key={r.usuarioId}>
                    <TableCell className="font-medium">
                      {r.nombre ?? r.email ?? "—"}
                      {r.orgRole === "admin_org" && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Admin
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{r.cobrosAsignados}</TableCell>
                    <TableCell className="text-right text-emerald-600">{r.cobrosPagados}</TableCell>
                    <TableCell className="text-right text-amber-600">{r.cobrosPendientes}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(r.montoRecaudado)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrency(r.montoPendiente)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-xl font-bold tracking-tight ${accent ?? ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
      Sin datos en el período seleccionado.
    </div>
  );
}
