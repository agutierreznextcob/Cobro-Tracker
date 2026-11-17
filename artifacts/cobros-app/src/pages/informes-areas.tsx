import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListAreas } from "@workspace/api-client-react";
import { FiltroBArra, useFiltroBarra } from "@/components/informes/filtro-barra";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  FolderKanban,
  TrendingUp,
  DollarSign,
  FileText,
  ShoppingCart,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  Clock,
  Percent,
  Package,
} from "lucide-react";
import { Link } from "wouter";

type AreaTipo = "area" | "departamento" | "centro_costo";

const TIPO_LABEL: Record<AreaTipo, string> = {
  area: "Área",
  departamento: "Departamento",
  centro_costo: "Centro de Costo",
};

const TIPO_COLOR: Record<AreaTipo, string> = {
  area: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  departamento: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  centro_costo: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

interface KpiArea {
  areaId: number;
  moneda: string;
  totalCobrado: number;
  totalCobros: number;
  cobrosPageados: number;
  cobrosPendientes: number;
  ticketPromedioCobros: number;
  totalCotizaciones: number;
  montoCotizaciones: number;
  tasaConversionCotizaciones: number | null;
  totalPedidos: number;
  montoPedidos: number;
  pedidosPendientes: number;
  pedidosEntregados: number;
  utilidadEstimada: number | null;
  desde: string;
  hasta: string;
}

function formatMoney(value: number, moneda = "CLP"): string {
  if (moneda === "CLP") {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function KpiCard({
  icon: Icon,
  label,
  value,
  subvalue,
  iconColor,
  bgColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subvalue?: string;
  iconColor: string;
  bgColor: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border bg-card">
      <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${bgColor}`}>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
        {subvalue && <p className="text-xs text-muted-foreground mt-0.5">{subvalue}</p>}
      </div>
    </div>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${accent ?? ""}`}>{value}</span>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function AreaKpis({ areaId, moneda }: { areaId: number; moneda: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<KpiArea>({
    queryKey: ["kpi-area", areaId, moneda],
    queryFn: async () => {
      const r = await fetch(`/api/informes/area/${areaId}?moneda=${moneda}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar KPIs");
      return r.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) return <KpiSkeleton />;

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
        <p className="text-sm text-destructive font-medium">No se pudo cargar el informe</p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </button>
      </div>
    );
  }

  const hasData = data.totalCobros > 0 || data.totalCotizaciones > 0 || data.totalPedidos > 0;

  return (
    <div className="space-y-6">
      {/* Período */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Desde {data.desde} hasta {data.hasta}
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {!hasData && (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
          <FolderKanban className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Sin actividad registrada</p>
          <p className="text-xs text-muted-foreground">
            Aún no hay cobros, cotizaciones ni pedidos asignados a esta área.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* KPIs principales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              icon={DollarSign}
              label="Total cobrado"
              value={formatMoney(data.totalCobrado, data.moneda)}
              subvalue={`${data.cobrosPageados} cobro${data.cobrosPageados !== 1 ? "s" : ""} pagado${data.cobrosPageados !== 1 ? "s" : ""}`}
              iconColor="text-green-600 dark:text-green-400"
              bgColor="bg-green-100 dark:bg-green-900/30"
            />
            <KpiCard
              icon={FileText}
              label="Cotizaciones"
              value={String(data.totalCotizaciones)}
              subvalue={
                data.tasaConversionCotizaciones != null
                  ? `${data.tasaConversionCotizaciones.toFixed(0)}% conversión`
                  : "Sin datos de conversión"
              }
              iconColor="text-blue-600 dark:text-blue-400"
              bgColor="bg-blue-100 dark:bg-blue-900/30"
            />
            <KpiCard
              icon={ShoppingCart}
              label="Pedidos"
              value={String(data.totalPedidos)}
              subvalue={`${data.pedidosEntregados} entregado${data.pedidosEntregados !== 1 ? "s" : ""}`}
              iconColor="text-violet-600 dark:text-violet-400"
              bgColor="bg-violet-100 dark:bg-violet-900/30"
            />
            <KpiCard
              icon={TrendingUp}
              label="Utilidad estimada"
              value={data.utilidadEstimada != null ? formatMoney(data.utilidadEstimada, data.moneda) : "—"}
              subvalue={data.utilidadEstimada != null ? "según ítems de cobros" : "sin ítems de costo"}
              iconColor="text-emerald-600 dark:text-emerald-400"
              bgColor="bg-emerald-100 dark:bg-emerald-900/30"
            />
          </div>

          {/* Detalle en 3 columnas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Cobros */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  Cobros
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <StatRow label="Total cobros" value={String(data.totalCobros)} />
                <StatRow
                  label="Pagados"
                  value={String(data.cobrosPageados)}
                  accent="text-green-600 dark:text-green-400"
                />
                <StatRow
                  label="Pendientes"
                  value={String(data.cobrosPendientes)}
                  accent={data.cobrosPendientes > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
                />
                <StatRow
                  label="Ticket promedio"
                  value={data.cobrosPageados > 0 ? formatMoney(data.ticketPromedioCobros, data.moneda) : "—"}
                />
                <StatRow
                  label="Total cobrado"
                  value={formatMoney(data.totalCobrado, data.moneda)}
                  accent="font-semibold text-foreground"
                />
              </CardContent>
            </Card>

            {/* Cotizaciones */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-600" />
                  Cotizaciones
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <StatRow label="Total cotizaciones" value={String(data.totalCotizaciones)} />
                <StatRow
                  label="Monto total cotizado"
                  value={data.totalCotizaciones > 0 ? formatMoney(data.montoCotizaciones, data.moneda) : "—"}
                />
                <StatRow
                  label="Tasa de conversión"
                  value={
                    data.tasaConversionCotizaciones != null
                      ? `${data.tasaConversionCotizaciones.toFixed(1)}%`
                      : "—"
                  }
                  accent={
                    data.tasaConversionCotizaciones != null && data.tasaConversionCotizaciones >= 50
                      ? "text-green-600 dark:text-green-400"
                      : data.tasaConversionCotizaciones != null
                      ? "text-amber-600 dark:text-amber-400"
                      : undefined
                  }
                />
              </CardContent>
            </Card>

            {/* Pedidos */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-violet-600" />
                  Pedidos
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <StatRow label="Total pedidos" value={String(data.totalPedidos)} />
                <StatRow
                  label="Pendientes / Aprobados"
                  value={String(data.pedidosPendientes)}
                  accent={data.pedidosPendientes > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
                />
                <StatRow
                  label="Entregados"
                  value={String(data.pedidosEntregados)}
                  accent="text-green-600 dark:text-green-400"
                />
                <StatRow
                  label="Monto total pedidos"
                  value={data.totalPedidos > 0 ? formatMoney(data.montoPedidos, data.moneda) : "—"}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function InformesAreasPage() {
  const { data: areas, isLoading } = useListAreas();
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [moneda, setMoneda] = useState("CLP");
  const filtro = useFiltroBarra("1m");

  const barraExtras = (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">Moneda</label>
      <Select value={moneda} onValueChange={setMoneda}>
        <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="CLP">CLP</SelectItem>
          <SelectItem value="USD">USD</SelectItem>
          <SelectItem value="EUR">EUR</SelectItem>
          <SelectItem value="UF">UF</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full max-w-sm" />
      </div>
    );
  }

  if (!areas || areas.length === 0) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-primary" />
            Informes por Área
          </h1>
          <p className="text-muted-foreground mt-1">KPIs por área, departamento o centro de costo.</p>
        </div>
        <Card className="shadow-sm border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <FolderKanban className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Sin áreas registradas</p>
              <p className="text-sm text-muted-foreground mt-1">
                Crea áreas, departamentos o centros de costo para ver sus indicadores aquí.
              </p>
            </div>
            <Link href="/configuracion/areas">
              <span className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium mt-1">
                Ir a Configuración de Áreas <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedArea = selectedAreaId != null ? areas.find((a) => a.id === selectedAreaId) : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-primary" />
            Informes por Área
          </h1>
          <p className="text-muted-foreground mt-1">
            Selecciona un área para ver sus indicadores de rendimiento.
          </p>
        </div>
        <Link href="/configuracion/areas">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Gestionar áreas <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>

      <FiltroBArra {...filtro} extras={barraExtras} />

      {/* Selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-full max-w-sm">
          <Select
            value={selectedAreaId != null ? String(selectedAreaId) : ""}
            onValueChange={(v) => setSelectedAreaId(v ? Number(v) : null)}
          >
            <SelectTrigger className="h-11 text-base">
              <SelectValue placeholder="Seleccionar área / departamento / centro de costo…" />
            </SelectTrigger>
            <SelectContent>
              {/* Grouped by tipo */}
              {(["area", "departamento", "centro_costo"] as AreaTipo[]).map((tipo) => {
                const group = areas.filter((a) => a.tipo === tipo);
                if (!group.length) return null;
                return group.map((area, idx) => (
                  <SelectItem key={area.id} value={String(area.id)}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TIPO_COLOR[tipo]}`}
                      >
                        {TIPO_LABEL[tipo]}
                      </span>
                      <span>{area.nombre}</span>
                    </div>
                  </SelectItem>
                ));
              })}
            </SelectContent>
          </Select>
        </div>

        {selectedArea && (
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TIPO_COLOR[selectedArea.tipo as AreaTipo]}`}
            >
              {TIPO_LABEL[selectedArea.tipo as AreaTipo]}
            </span>
            {selectedArea.descripcion && (
              <span className="text-sm text-muted-foreground">{selectedArea.descripcion}</span>
            )}
          </div>
        )}
      </div>

      {/* KPIs del área seleccionada */}
      {selectedAreaId == null ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-3">
          <FolderKanban className="h-10 w-10 text-muted-foreground mx-auto" />
          <div>
            <p className="font-medium text-base">Selecciona un área para ver su informe</p>
            <p className="text-sm text-muted-foreground mt-1">
              Tienes <strong>{areas.length}</strong> área{areas.length !== 1 ? "s" : ""} registrada{areas.length !== 1 ? "s" : ""}.
            </p>
          </div>
          {/* Mini resumen de áreas */}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {areas.map((area) => (
              <button
                key={area.id}
                onClick={() => setSelectedAreaId(area.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm hover:bg-muted transition-colors"
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    area.tipo === "area"
                      ? "bg-blue-500"
                      : area.tipo === "departamento"
                      ? "bg-violet-500"
                      : "bg-amber-500"
                  }`}
                />
                {area.nombre}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <AreaKpis areaId={selectedAreaId} moneda={moneda} />
      )}
    </div>
  );
}
