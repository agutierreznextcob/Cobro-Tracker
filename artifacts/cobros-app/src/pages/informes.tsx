import { useMemo, useState } from "react";
import {
  useListCobros,
  useListClientes,
  useGetRendimientoEquipo,
  getGetRendimientoEquipoQueryKey,
  useGetGestionesMetricas,
  useGetEncuestasResumen,
  useListCobrosRecurrentes,
  getListCobrosRecurrentesQueryKey,
  getGetEncuestasResumenQueryKey,
} from "@workspace/api-client-react";
import type { Cobro, ClienteConScore, GestionMetricaEjecutivo } from "@workspace/api-client-react";
import { ScoreBadge } from "@/components/score-badge";
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
  addMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePreferencias, decimalesPref } from "@/hooks/use-preferencias";
import { formatCurrency, formatMoney, monedaDe, MONEDAS, type Moneda } from "@/lib/format";
import {
  TIPO_DOCUMENTO_VALUES,
  TIPO_DOCUMENTO_LABELS,
  tipoDocumentoLabel,
  type TipoDocumento,
} from "@/lib/tipo-documento";
import { SaludCarteraPanel } from "@/components/salud-cartera-panel";
import { Download, TrendingUp, Receipt, Percent, ListChecks, TicketPercent, RefreshCcw, Wallet, AlertTriangle, CalendarClock, Star, Loader2, MessageSquare, Gauge } from "lucide-react";
import { formatDate } from "@/lib/format";
import { ProductosMasVendidos, MenorMovimiento } from "@/components/informes/ventas-productos";

type Estado = "pendiente" | "pagado" | "parcial" | "fallido" | "cancelado";
type Gran = "dia" | "semana" | "mes";

const TIPO_DOC_COLOR: Record<TipoDocumento, string> = {
  factura_afecta: "#6C5CE7",
  factura_exenta: "#a78bfa",
  boleta_afecta: "#0ea5e9",
  boleta_exenta: "#38bdf8",
  boleta_manual: "#0284c7",
  boleta_electronica: "#0ea5e9",
  boleta_electronica_stock: "#0369a1",
  factura_electronica: "#6C5CE7",
  factura_electronica_stock: "#7c3aed",
  factura_no_afecta: "#a78bfa",
  liquidacion_factura: "#9333ea",
  nota_credito: "#16a34a",
  nota_credito_exenta: "#4ade80",
  nota_credito_stock: "#15803d",
  nota_debito: "#ea580c",
  nota_debito_exenta: "#fb923c",
  vale_comprobante: "#0d9488",
  sin_documento: "#94a3b8",
};

function tipoDocumentoOf(c: Cobro): TipoDocumento {
  const t = c.tipoDocumento;
  return t && TIPO_DOCUMENTO_VALUES.includes(t as TipoDocumento)
    ? (t as TipoDocumento)
    : "sin_documento";
}

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
  const { prefs: prefsInformes } = usePreferencias();
  const [preset, setPreset] = useState<PresetKey>("1m");
  const [customDesde, setCustomDesde] = useState("");
  const [customHasta, setCustomHasta] = useState("");
  const [granSel, setGranSel] = useState<Gran | "auto">("auto");
  const [filterTipoDoc, setFilterTipoDoc] = useState<TipoDocumento | "todos">("todos");

  const { user } = useAuth();
  const planUser = user as (typeof user & { subscriptionStatus?: string; plan?: string }) | null;
  const nextCob = user?.role === "admin" || user?.esDemo || planUser?.subscriptionStatus === "prueba" || planUser?.plan !== "starter";
  const { data: reporteRecurrentes, isLoading: recurrentesLoading, isError: recurrentesError, refetch: refetchRecurrentes } = useListCobrosRecurrentes({ query: { enabled: nextCob, queryKey: getListCobrosRecurrentesQueryKey(), refetchOnMount: "always", refetchInterval: 60000 } });
  const recurrentes = reporteRecurrentes?.schedules ?? [];
  const [exportandoRecurrentes, setExportandoRecurrentes] = useState(false);
  const [errorExportRecurrentes, setErrorExportRecurrentes] = useState<string | null>(null);
  const isOrgAdmin = user?.orgRole === "admin_org";
  const isSupervisor = user?.orgRole === "supervisor";
  const veRendimiento = isOrgAdmin || isSupervisor;
  const [filtroSupervisor, setFiltroSupervisor] = useState<string>("todos");

  const { data: cobros, isLoading } = useListCobros(
    {},
    { query: { queryKey: ["listCobros", {}] as const } },
  );

  const { data: rendimiento } = useGetRendimientoEquipo(undefined, {
    query: { enabled: veRendimiento, queryKey: getGetRendimientoEquipoQueryKey() },
  });

  const { data: clientesConScore } = useListClientes();

  // Client-side totals never mix currencies: every amount below belongs to the
  // selected document currency only (legacy cobros = CLP).
  const [monedaInforme, setMonedaInforme] = useState<Moneda>("CLP");
  const monedasPresentes = useMemo(() => {
    const set = new Set<Moneda>(["CLP"]);
    for (const c of cobros ?? []) set.add(monedaDe(c.moneda));
    return MONEDAS.filter((m) => set.has(m));
  }, [cobros]);
  const fmtSel = (n: number) => formatMoney(n, monedaInforme, monedaInforme === "CLP" ? 0 : 2);

  // Estimated recovery: every open cobro weighted by its client's payment
  // probability (fallback 50% for clientes sin probabilidad calculada).
  const recuperacionEstimada = useMemo(() => {
    if (!cobros) return null;
    const probPorCliente = new Map<number, number | null>();
    for (const cl of clientesConScore ?? []) probPorCliente.set(cl.id, cl.probabilidadPago ?? null);
    let pendienteTotal = 0;
    let esperado = 0;
    for (const c of cobros) {
      if (monedaDe(c.moneda) !== monedaInforme) continue;
      if (c.estado !== "pendiente" && c.estado !== "parcial") continue;
      const saldo = c.saldo ?? (c.montoACobrar ?? c.monto - (c.montoDescuento ?? 0));
      if (saldo <= 0) continue;
      const prob = c.clienteId != null ? (probPorCliente.get(c.clienteId) ?? 50) : 50;
      pendienteTotal += saldo;
      esperado += saldo * ((prob ?? 50) / 100);
    }
    if (pendienteTotal <= 0) return null;
    return {
      pendienteTotal,
      esperado,
      pct: Math.round((esperado / pendienteTotal) * 100),
    };
  }, [cobros, clientesConScore, monedaInforme]);

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
      // Paid cobros are scoped by payment date (revenue belongs to the period
      // it was collected); other states by creation date.
      const d = parseISO(c.estado === "pagado" ? (c.pagadoEn ?? c.creadoEn) : c.creadoEn);
      if (d < range.desde || d > range.hasta) return false;
      if (filterTipoDoc !== "todos" && tipoDocumentoOf(c) !== filterTipoDoc) return false;
      if (monedaDe(c.moneda) !== monedaInforme) return false;
      return true;
    });
  }, [cobros, range, filterTipoDoc, monedaInforme]);

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
      if (c.estado === "pagado") {
        // Bucket by the payment confirmation date when available (accurate
        // revenue reporting); fall back to the creation date for legacy rows.
        const fecha = c.pagadoEn ?? c.creadoEn;
        const key = bucketStart(parseISO(fecha), gran).getTime();
        const recaudado = c.montoACobrar ?? c.monto - (c.montoDescuento ?? 0);
        buckets.set(key, (buckets.get(key) ?? 0) + recaudado);
      } else if (c.estado === "parcial") {
        // Confirmed abonos on partially-paid cobros are real revenue too.
        const abonado = Math.max((c.montoACobrar ?? c.monto) - (c.saldo ?? 0), 0);
        if (abonado <= 0) continue;
        const key = bucketStart(parseISO(c.creadoEn), gran).getTime();
        buckets.set(key, (buckets.get(key) ?? 0) + abonado);
      }
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

  const tipoDocData = useMemo(() => {
    const counts = new Map<TipoDocumento, number>();
    for (const c of filtered) {
      const t = tipoDocumentoOf(c);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return TIPO_DOCUMENTO_VALUES.map((t) => ({
      tipo: t,
      name: TIPO_DOCUMENTO_LABELS[t],
      value: counts.get(t) ?? 0,
      color: TIPO_DOC_COLOR[t],
    })).filter((d) => d.value > 0);
  }, [filtered]);

  const montoCobrar = (c: Cobro) => c.montoACobrar ?? c.monto - (c.montoDescuento ?? 0);
  const tieneDescuento = (c: Cobro) => (c.montoDescuento ?? 0) > 0;

  const summary = useMemo(() => {
    const pagados = filtered.filter((c) => c.estado === "pagado");
    // Total collected = fully paid cobros + confirmed abonos on parcial cobros.
    const abonadoParcial = filtered
      .filter((c) => c.estado === "parcial")
      .reduce((a, c) => a + Math.max((c.montoACobrar ?? c.monto) - (c.saldo ?? 0), 0), 0);
    const totalRecaudado = pagados.reduce((a, c) => a + montoCobrar(c), 0) + abonadoParcial;
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

  const proyeccionRecurrente = reporteRecurrentes?.proyeccion30Dias ?? 0;
  // Schedules snapshot their own precision; the projection uses the widest of
  // schedule data and the current global setting so decimals are never truncated.
  const decRecurrente = (r: object) => Number((r as { decimales?: number | null }).decimales ?? 0) || 0;
  const decProyeccion = Math.max(decimalesPref(prefsInformes), ...recurrentes.map(decRecurrente));

  async function exportRecurrentes() {
    setExportandoRecurrentes(true);
    setErrorExportRecurrentes(null);
    try {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(recurrentes.map((r) => ({
      Cliente: r.clienteNombre, "Monto programado (CLP)": r.monto, Frecuencia: r.frecuencia,
      "Próxima fecha de generación": r.proximaGeneracion,
    })));
    ws["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cobros recurrentes");
    const detalle = XLSX.utils.json_to_sheet((reporteRecurrentes?.ocurrencias30Dias ?? []).map((o) => ({
      "Programación": o.programacionId,
      "Fecha programada": o.fecha,
      "Monto programado (CLP)": o.monto,
    })));
    XLSX.utils.book_append_sheet(wb, detalle, "Próximos 30 días");
    const content = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const url = URL.createObjectURL(new Blob([content], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cobros-recurrentes-${format(new Date(), "yyyyMMdd")}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setErrorExportRecurrentes("No se pudo generar el archivo Excel. Inténtalo nuevamente.");
    } finally {
      setExportandoRecurrentes(false);
    }
  }

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
      "Tipo de documento": tipoDocumentoLabel(c.tipoDocumento),
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
      { wch: 26 },
      { wch: 12 },
      { wch: 18 },
      ...(isOrgAdmin ? [{ wch: 24 }] : []),
      { wch: 22 },
    ];

    const resumenRows: (string | number)[][] = [
      ["Informe de cobros — NextCob"],
      ["Período", `${format(range.desde, "dd-MM-yyyy")} a ${format(range.hasta, "dd-MM-yyyy")}`],
      [],
      [`Total recaudado (${monedaInforme})`, summary.totalRecaudado],
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
      [],
      ["Cobros por tipo de documento", "Cantidad"],
      ...tipoDocData.map((t) => [t.name, t.value]),
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
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Informes</p>
        <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Analiza tu recaudación, tus cuentas por cobrar y qué productos se venden.
        </p>
      </div>

      <Tabs defaultValue="resumen" className="space-y-6">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="cuentas">Cuentas por Cobrar</TabsTrigger>
          <TabsTrigger value="ranking">Ranking de clientes</TabsTrigger>
          <TabsTrigger value="gestiones">Gestiones</TabsTrigger>
          <TabsTrigger value="satisfaccion">Satisfacción</TabsTrigger>
          <TabsTrigger value="recurrentes">Recurrentes</TabsTrigger>
          <TabsTrigger value="mas-vendidos" data-testid="tab-mas-vendidos">Productos y servicios más vendidos</TabsTrigger>
          <TabsTrigger value="menor-movimiento" data-testid="tab-menor-movimiento">Menor movimiento</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="space-y-6 mt-0">
          {/* Resumen toolbar */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? "Cargando..."
                : `${filtered.length} cobro${filtered.length !== 1 ? "s" : ""} en el período`}
            </p>
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
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Tipo de documento</label>
            <Select
              value={filterTipoDoc}
              onValueChange={(v) => setFilterTipoDoc(v as TipoDocumento | "todos")}
            >
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                {TIPO_DOCUMENTO_VALUES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {TIPO_DOCUMENTO_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Moneda</label>
            <Select value={monedaInforme} onValueChange={(v) => setMonedaInforme(v as Moneda)}>
              <SelectTrigger className="h-8 w-[110px] text-xs" data-testid="select-moneda-informe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monedasPresentes.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground ml-auto self-center">
            <span className="mr-2 rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground" data-testid="label-moneda-informe">Importes en {monedaInforme}</span>
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
          value={fmtSel(summary.totalRecaudado)}
          accent="text-emerald-600"
        />
        <SummaryCard
          icon={<Receipt className="h-4 w-4" />}
          label="Ticket promedio"
          value={fmtSel(summary.ticket)}
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
          sub={`${fmtSel(summary.totalDescuento)} descontado`}
          accent="text-amber-600"
        />
        <SummaryCard
          icon={<ListChecks className="h-4 w-4" />}
          label="Total de cobros"
          value={String(summary.totalCobros)}
        />
        {recuperacionEstimada && (
          <SummaryCard
            icon={<Gauge className="h-4 w-4" />}
            label="Probabilidad de recuperación de cartera"
            value={`${fmtSel(recuperacionEstimada.esperado)} (${recuperacionEstimada.pct}%)`}
            sub={`De ${fmtSel(recuperacionEstimada.pendienteTotal)} pendientes, según probabilidad de pago por cliente`}
            accent="text-primary"
          />
        )}
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
                  formatter={(v: number) => [fmtSel(v), "Recaudado"]}
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
                  formatter={(v: number) => [fmtSel(v), "Recaudado"]}
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

      {/* Distribución por tipo de documento */}
      <Card className="p-5 shadow-sm">
        <h2 className="text-sm font-semibold mb-4">Distribución por tipo de documento</h2>
        {sinDatos || tipoDocData.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={tipoDocData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={55}
                paddingAngle={2}
                label={(entry) => `${entry.value}`}
                labelLine={false}
                style={{ fontSize: 11 }}
              >
                {tipoDocData.map((d) => (
                  <Cell key={d.tipo} fill={d.color} />
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
                  `${fmtSel(v)} · ${item?.payload?.cantidad ?? 0} cobro${(item?.payload?.cantidad ?? 0) !== 1 ? "s" : ""}`,
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

      <SaludCarteraPanel />

      {/* Team performance (admin: all; supervisor: their team) */}
      {veRendimiento && rendimiento && rendimiento.length > 0 && (
        <Card className="p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold">
              {isSupervisor ? "Rendimiento de mi equipo" : "Rendimiento del equipo"}
              <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Importes en CLP</span>
            </h2>
            {isOrgAdmin && rendimiento.some((r) => r.orgRole === "supervisor") && (
              <Select value={filtroSupervisor} onValueChange={setFiltroSupervisor}>
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">
                    Todos los equipos
                  </SelectItem>
                  {rendimiento
                    .filter((r) => r.orgRole === "supervisor")
                    .map((s) => (
                      <SelectItem key={s.usuarioId} value={s.usuarioId} className="text-xs">
                        Equipo de {s.nombre ?? s.email ?? "supervisor"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Miembro</TableHead>
                  {isOrgAdmin && <TableHead>Supervisor</TableHead>}
                  <TableHead className="text-right">Asignados</TableHead>
                  <TableHead className="text-right">Pagados</TableHead>
                  <TableHead className="text-right">Pendientes</TableHead>
                  <TableHead className="text-right">Recaudado</TableHead>
                  <TableHead className="text-right">Por cobrar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rendimiento
                  .filter(
                    (r) =>
                      filtroSupervisor === "todos" ||
                      r.usuarioId === filtroSupervisor ||
                      r.supervisorId === filtroSupervisor,
                  )
                  .map((r) => (
                  <TableRow key={r.usuarioId}>
                    <TableCell className="font-medium">
                      {r.nombre ?? r.email ?? "—"}
                      {r.orgRole === "admin_org" && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Admin
                        </span>
                      )}
                      {r.orgRole === "supervisor" && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Supervisor
                        </span>
                      )}
                    </TableCell>
                    {isOrgAdmin && (
                      <TableCell className="text-muted-foreground text-xs">
                        {r.supervisorNombre ?? "—"}
                      </TableCell>
                    )}
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
        </TabsContent>

        <TabsContent value="cuentas" className="space-y-6 mt-0">
          <AgingReport moneda={monedaInforme} cobros={(cobros ?? []).filter((c) => monedaDe(c.moneda) === monedaInforme)} isOrgAdmin={isOrgAdmin} loading={isLoading} />
        </TabsContent>

        <TabsContent value="ranking" className="space-y-6 mt-0">
          <RankingClientes />
        </TabsContent>

        <TabsContent value="gestiones" className="space-y-6 mt-0">
          <GestionesEjecutivos />
        </TabsContent>

        <TabsContent value="satisfaccion" className="space-y-6 mt-0">
          <SatisfaccionReport />
        </TabsContent>
        <TabsContent value="recurrentes" className="space-y-4 mt-0">
          {!nextCob ? (
            <Card className="p-8 text-center">
              <p className="font-medium">🔒 Disponible en plan NextCob</p>
              <p className="mt-1 text-sm text-muted-foreground">Programa cobros recurrentes y consulta su proyección.</p>
            </Card>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Cobros recurrentes programados <span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground align-middle">Importes en CLP</span></h2>
              {recurrentesLoading && <p className="text-sm text-muted-foreground">Cargando programación…</p>}
              {recurrentesError && <Card className="p-4 text-sm text-destructive">No se pudo cargar la programación. <Button variant="outline" onClick={() => refetchRecurrentes()}>Reintentar</Button></Card>}
              <Card className="p-5">
                <p className="text-sm font-semibold">Proyección de ingresos futuros</p>
                <p className="mt-2 text-2xl font-bold">{formatMoney(proyeccionRecurrente, "CLP", decProyeccion)}</p>
                <p className="text-xs text-muted-foreground">En los próximos 30 días se generarán {formatMoney(proyeccionRecurrente, "CLP", decProyeccion)} en cobros recurrentes programados. No corresponde a ingresos garantizados ni recibidos.</p>
              </Card>
              <div className="flex justify-end"><Button onClick={exportRecurrentes} disabled={!recurrentes.length || exportandoRecurrentes} className="gap-2"><Download className="h-4 w-4" />{exportandoRecurrentes ? "Preparando Excel…" : "Descargar Excel"}</Button></div>
              {errorExportRecurrentes && <p role="alert" className="text-sm text-destructive">{errorExportRecurrentes}</p>}
              <Card className="overflow-hidden">
                <Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Frecuencia</TableHead><TableHead>Próxima generación</TableHead></TableRow></TableHeader>
                  <TableBody>{recurrentes.length ? recurrentes.map((r) => <TableRow key={r.id}><TableCell>{r.clienteNombre}</TableCell><TableCell className="text-right font-mono">{formatMoney(r.monto, "CLP", decRecurrente(r))}</TableCell><TableCell className="capitalize">{r.frecuencia}</TableCell><TableCell>{r.proximaGeneracion}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">No hay cobros recurrentes activos.</TableCell></TableRow>}</TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="mas-vendidos" className="mt-0">
          <ProductosMasVendidos />
        </TabsContent>
        <TabsContent value="menor-movimiento" className="mt-0">
          <MenorMovimiento />
        </TabsContent>
      </Tabs>
    </div>
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

const AGING_BUCKETS = [
  { key: "por_vencer", label: "Por vencer", color: "#16a34a" },
  { key: "b1", label: "1–30 días", color: "#f59e0b" },
  { key: "b2", label: "31–60 días", color: "#fb923c" },
  { key: "b3", label: "61–90 días", color: "#f97316" },
  { key: "b4", label: "+90 días", color: "#ef4444" },
] as const;

type BucketKey = (typeof AGING_BUCKETS)[number]["key"];

function bucketForDays(days: number | null): BucketKey {
  if (days == null || days <= 0) return "por_vencer";
  if (days <= 30) return "b1";
  if (days <= 60) return "b2";
  if (days <= 90) return "b3";
  return "b4";
}

function AgingReport({
  moneda,
  cobros,
  isOrgAdmin,
  loading,
}: {
  moneda: Moneda;
  cobros: Cobro[];
  isOrgAdmin: boolean;
  loading: boolean;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  // Only cobros of one currency reach this report; render in that currency.
  const formatCurrency = (n: number) => formatMoney(n, moneda, moneda === "CLP" ? 0 : 2);
  // Outstanding balance: prefer backend `saldo` (montoACobrar minus confirmed
  // abonos) so `parcial` cobros are not overstated; fall back when absent.
  const saldoCobrar = (c: Cobro) => c.saldo ?? c.montoACobrar ?? c.monto - (c.montoDescuento ?? 0);

  // Outstanding receivables = pending or partially paid cobros.
  const pendientes = useMemo(
    () => cobros.filter((c) => c.estado === "pendiente" || c.estado === "parcial"),
    [cobros],
  );

  const rows = useMemo(
    () =>
      pendientes.map((c) => {
        const due = c.fechaVencimiento ? startOfDay(parseISO(c.fechaVencimiento)) : null;
        const days = due ? differenceInCalendarDays(today, due) : null;
        return { cobro: c, due, days, bucket: bucketForDays(days), saldo: saldoCobrar(c) };
      }),
    [pendientes, today],
  );

  const totalPorCobrar = rows.reduce((a, r) => a + r.saldo, 0);
  const totalVencido = rows.filter((r) => r.bucket !== "por_vencer").reduce((a, r) => a + r.saldo, 0);
  const totalPorVencer = totalPorCobrar - totalVencido;

  const bucketData = useMemo(
    () =>
      AGING_BUCKETS.map((b) => {
        const rs = rows.filter((r) => r.bucket === b.key);
        return {
          key: b.key,
          label: b.label,
          color: b.color,
          cantidad: rs.length,
          monto: rs.reduce((a, r) => a + r.saldo, 0),
        };
      }),
    [rows],
  );

  // Outstanding balance broken down by document type.
  const tipoData = useMemo(
    () =>
      TIPO_DOCUMENTO_VALUES.map((t) => {
        const rs = rows.filter((r) => tipoDocumentoOf(r.cobro) === t);
        return {
          tipo: t,
          label: TIPO_DOCUMENTO_LABELS[t],
          color: TIPO_DOC_COLOR[t],
          cantidad: rs.length,
          monto: rs.reduce((a, r) => a + r.saldo, 0),
        };
      }).filter((d) => d.cantidad > 0),
    [rows],
  );

  // Cash-flow projection: outstanding amounts grouped by due month for the next 6 months.
  const proyeccion = useMemo(() => {
    const months: { key: number; label: string; monto: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const m = startOfMonth(addMonths(today, i));
      months.push({ key: m.getTime(), label: format(m, "MMM yy", { locale: es }), monto: 0 });
    }
    const lastMonth = months[months.length - 1].key;
    let vencido = 0;
    for (const r of rows) {
      if (!r.due || (r.days ?? 0) > 0) {
        // overdue or no due date → expected to collect now
        vencido += r.saldo;
        continue;
      }
      const mKey = startOfMonth(r.due).getTime();
      const target = months.find((m) => m.key === mKey);
      if (target) target.monto += r.saldo;
      else if (mKey > lastMonth) {
        // beyond projection window — fold into last bucket
        months[months.length - 1].monto += r.saldo;
      }
    }
    return [{ key: 0, label: "Vencido", monto: vencido }, ...months];
  }, [rows, today]);

  // Top debtors by outstanding balance.
  const porCliente = useMemo(() => {
    const map = new Map<string, { nombre: string; total: number; vencido: number; cantidad: number }>();
    for (const r of rows) {
      const nombre = r.cobro.clienteNombre ?? "Sin cliente";
      const key = `${r.cobro.clienteId ?? "x"}-${nombre}`;
      const cur = map.get(key) ?? { nombre, total: 0, vencido: 0, cantidad: 0 };
      cur.total += r.saldo;
      cur.cantidad += 1;
      if (r.bucket !== "por_vencer") cur.vencido += r.saldo;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  async function exportAging() {
    const XLSX = await import("xlsx");
    const detalle = rows
      .slice()
      .sort((a, b) => (b.days ?? -9999) - (a.days ?? -9999))
      .map((r) => ({
        Cliente: r.cobro.clienteNombre ?? "Sin cliente",
        Descripción: r.cobro.descripcion,
        "Fecha vencimiento": r.due ? format(r.due, "dd-MM-yyyy") : "Sin fecha",
        "Días vencido": r.days != null && r.days > 0 ? r.days : 0,
        Antigüedad: AGING_BUCKETS.find((b) => b.key === r.bucket)?.label ?? "",
        Estado: ESTADO_META[r.cobro.estado as Estado]?.label ?? r.cobro.estado,
        [`Saldo (${moneda})`]: r.saldo,
        ...(isOrgAdmin ? { "Ejecutivo responsable": r.cobro.responsableNombre ?? "Sin asignar" } : {}),
      }));
    const wsDetalle = XLSX.utils.json_to_sheet(detalle);
    wsDetalle["!cols"] = [
      { wch: 26 },
      { wch: 40 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      ...(isOrgAdmin ? [{ wch: 24 }] : []),
    ];

    const resumenRows: (string | number)[][] = [
      ["Cuentas por cobrar — NextCob"],
      ["Generado", format(new Date(), "dd-MM-yyyy")],
      [],
      [`Total por cobrar (${moneda})`, Math.round(totalPorCobrar)],
      [`Total vencido (${moneda})`, Math.round(totalVencido)],
      [`Total por vencer (${moneda})`, Math.round(totalPorVencer)],
      [],
      ["Antigüedad", "Cantidad", `Saldo (${moneda})`],
      ...bucketData.map((b) => [b.label, b.cantidad, Math.round(b.monto)]),
      [],
      ["Tipo de documento", "Cantidad", `Saldo (${moneda})`],
      ...tipoData.map((t) => [t.label, t.cantidad, Math.round(t.monto)]),
      [],
      ["Proyección de flujo", `Monto esperado (${moneda})`],
      ...proyeccion.map((p) => [p.label, Math.round(p.monto)]),
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    wsResumen["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle");
    XLSX.writeFile(wb, `cuentas-por-cobrar-${format(new Date(), "yyyyMMdd")}.xlsx`);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando...</p>;
  }

  if (rows.length === 0) {
    return (
      <Card className="p-10 shadow-sm text-center">
        <div className="mb-4 flex justify-end">
          <Button disabled className="gap-2" title="Sin cuentas por cobrar para exportar" data-testid="button-excel-cuentas-vacias">
            <Download className="h-4 w-4" />
            Descargar Excel
          </Button>
        </div>
        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
          <Wallet className="h-6 w-6 text-emerald-600" />
        </div>
        <p className="font-medium">No tienes cuentas por cobrar</p>
        <p className="text-sm text-muted-foreground mt-1">
          Todos tus cobros están pagados o no hay cobros pendientes.
        </p>
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <Button onClick={exportAging} className="gap-2">
          <Download className="h-4 w-4" />
          Descargar Excel
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total por cobrar"
          value={formatCurrency(totalPorCobrar)}
          sub={`${rows.length} cobro${rows.length !== 1 ? "s" : ""} pendiente${rows.length !== 1 ? "s" : ""}`}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Vencido"
          value={formatCurrency(totalVencido)}
          sub={`${((totalVencido / (totalPorCobrar || 1)) * 100).toFixed(0)}% del total`}
          accent="text-red-600"
        />
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Por vencer"
          value={formatCurrency(totalPorVencer)}
          accent="text-emerald-600"
        />
      </div>

      {/* Aging table + bar chart */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4">Antigüedad de saldos</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tramo</TableHead>
                <TableHead className="text-right">Cobros</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bucketData.map((b) => (
                <TableRow key={b.key}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                      {b.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{b.cantidad}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(b.monto)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {((b.monto / (totalPorCobrar || 1)) * 100).toFixed(0)}%
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{rows.length}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(totalPorCobrar)}</TableCell>
                <TableCell className="text-right">100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>

        <Card className="p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4">Saldo por antigüedad</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={bucketData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={compactCLP} width={48} />
              <Tooltip
                formatter={(v: number, _n, item) => [
                  `${formatCurrency(v)} · ${item?.payload?.cantidad ?? 0} cobro${(item?.payload?.cantidad ?? 0) !== 1 ? "s" : ""}`,
                  "Saldo",
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                cursor={{ fill: "hsl(var(--muted))" }}
              />
              <Bar dataKey="monto" radius={[3, 3, 0, 0]}>
                {bucketData.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Outstanding by document type */}
      <Card className="p-5 shadow-sm">
        <h2 className="text-sm font-semibold mb-4">Saldo por tipo de documento</h2>
        {tipoData.length === 0 ? (
          <EmptyChart />
        ) : (
          <div className="grid lg:grid-cols-2 gap-4 items-center">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo de documento</TableHead>
                  <TableHead className="text-right">Cobros</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tipoData.map((t) => (
                  <TableRow key={t.tipo}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{t.cantidad}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(t.monto)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {((t.monto / (totalPorCobrar || 1)) * 100).toFixed(0)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={tipoData}
                  dataKey="monto"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                  labelLine={false}
                  style={{ fontSize: 11 }}
                >
                  {tipoData.map((d) => (
                    <Cell key={d.tipo} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number, n) => [formatCurrency(v), n]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Cash-flow projection */}
      <Card className="p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Proyección de flujo de caja</h2>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Cobranza esperada
          </span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={proyeccion} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={compactCLP} width={48} />
            <Tooltip
              formatter={(v: number) => [formatCurrency(v), "Esperado"]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              cursor={{ fill: "hsl(var(--muted))" }}
            />
            <Bar dataKey="monto" radius={[3, 3, 0, 0]}>
              {proyeccion.map((p) => (
                <Cell key={p.key} fill={p.label === "Vencido" ? "#ef4444" : "#6C5CE7"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* By-cliente table */}
      <Card className="p-5 shadow-sm">
        <h2 className="text-sm font-semibold mb-4">Deudores</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Cobros</TableHead>
                <TableHead className="text-right">Vencido</TableHead>
                <TableHead className="text-right">Total adeudado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porCliente.map((c) => (
                <TableRow key={c.nombre}>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell className="text-right">{c.cantidad}</TableCell>
                  <TableCell className="text-right text-red-600">
                    {c.vencido > 0 ? formatCurrency(c.vencido) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {formatCurrency(c.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
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

function GestionesEjecutivos() {
  const { data: metricas, isLoading } = useGetGestionesMetricas();

  const rows = useMemo(() => {
    const list = (metricas ?? []).slice();
    return list.sort((a, b) => b.gestionesRealizadas - a.gestionesRealizadas);
  }, [metricas]);

  const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

  const exportar = async () => {
    const XLSX = await import("xlsx");
    const data = rows.map((m: GestionMetricaEjecutivo) => ({
      Ejecutivo: m.usuarioNombre ?? m.usuarioId,
      "Gestiones realizadas": m.gestionesRealizadas,
      Intentos: m.intentos,
      Contactados: m.contactados,
      "Tasa contacto efectivo": fmtPct(m.tasaContactoEfectivo),
      "Cobros gestionados": m.cobrosGestionados,
      "Cobros recuperados": m.cobrosRecuperados,
      "Tasa recuperación": fmtPct(m.tasaRecuperacion),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gestiones por ejecutivo");
    XLSX.writeFile(wb, `gestiones-ejecutivos-${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Cargando..."
            : `${rows.length} ejecutivo${rows.length !== 1 ? "s" : ""} con actividad de cobranza.`}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={exportar}
          disabled={rows.length === 0}
        >
          <Download className="h-4 w-4" />
          Exportar Excel
        </Button>
      </div>

      <Card className="shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs">Ejecutivo</TableHead>
              <TableHead className="text-xs text-right">Gestiones</TableHead>
              <TableHead className="text-xs text-right">Intentos</TableHead>
              <TableHead className="text-xs text-right">Contactados</TableHead>
              <TableHead className="text-xs text-right">Tasa contacto</TableHead>
              <TableHead className="text-xs text-right">Cobros gestionados</TableHead>
              <TableHead className="text-xs text-right">Recuperados</TableHead>
              <TableHead className="text-xs text-right">Tasa recuperación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <TableRow key={i} className="animate-pulse">
                  <TableCell><div className="h-4 w-40 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground text-sm">
                  Sin gestiones de cobranza registradas.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((m) => (
                <TableRow key={m.usuarioId} className="hover:bg-muted/40 transition-colors">
                  <TableCell className="font-medium text-sm">{m.usuarioNombre ?? m.usuarioId}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.gestionesRealizadas}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.intentos}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.contactados}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums font-medium">{fmtPct(m.tasaContactoEfectivo)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.cobrosGestionados}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.cobrosRecuperados}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums font-medium">{fmtPct(m.tasaRecuperacion)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
