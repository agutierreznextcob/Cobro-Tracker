import { useListAreas } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderKanban, TrendingUp, TrendingDown, DollarSign, FileText, ShoppingCart, ArrowRight } from "lucide-react";
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

function TipoBadge({ tipo }: { tipo: AreaTipo }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_COLOR[tipo]}`}>
      {TIPO_LABEL[tipo]}
    </span>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30">
      <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

export default function InformesAreasPage() {
  const { data: areas, isLoading } = useListAreas();
  const { user } = useAuth();

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-primary" />
            Informes por Área
          </h1>
          <p className="text-muted-foreground mt-1">
            Indicadores de rendimiento por área, departamento o centro de costo.
          </p>
        </div>
        <Link href="/configuracion/areas">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Gestionar áreas <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total áreas"
          value={areas.filter((a) => a.tipo === "area").length}
          icon={FolderKanban}
          color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
        />
        <StatCard
          label="Departamentos"
          value={areas.filter((a) => a.tipo === "departamento").length}
          icon={FolderKanban}
          color="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400"
        />
        <StatCard
          label="Centros de Costo"
          value={areas.filter((a) => a.tipo === "centro_costo").length}
          icon={DollarSign}
          color="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
        />
        <StatCard
          label="Total unidades"
          value={areas.length}
          icon={FileText}
          color="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
        />
      </div>

      {/* Area cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {areas.map((area) => (
          <Card key={area.id} className="shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate">{area.nombre}</CardTitle>
                  {area.descripcion && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{area.descripcion}</p>
                  )}
                </div>
                <TipoBadge tipo={area.tipo as AreaTipo} />
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {/* Placeholder KPI rows — these will be wired to real data once
                  the reports backend exposes area-scoped aggregates */}
              <div className="space-y-2">
                <KpiRow
                  icon={DollarSign}
                  label="Cobros (total)"
                  value="—"
                  note="próximamente"
                  color="text-green-600"
                />
                <KpiRow
                  icon={FileText}
                  label="Cotizaciones"
                  value="—"
                  note="próximamente"
                  color="text-blue-600"
                />
                <KpiRow
                  icon={ShoppingCart}
                  label="Pedidos"
                  value="—"
                  note="próximamente"
                  color="text-violet-600"
                />
                <KpiRow
                  icon={TrendingUp}
                  label="Utilidad estimada"
                  value="—"
                  note="próximamente"
                  color="text-emerald-600"
                />
                <KpiRow
                  icon={TrendingDown}
                  label="Costos"
                  value="—"
                  note="próximamente"
                  color="text-orange-600"
                />
              </div>

              {area.responsableId && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Responsable: <span className="text-foreground font-medium">{area.responsableNombre ?? area.responsableId}</span>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center pt-2">
        Los KPIs por área se calcularán automáticamente a medida que se registren cobros, cotizaciones y pedidos asociados a cada área.
      </p>
    </div>
  );
}

function KpiRow({
  icon: Icon,
  label,
  value,
  note,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  note?: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
        <span className="text-muted-foreground truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="font-medium tabular-nums">{value}</span>
        {note && <span className="text-xs text-muted-foreground">({note})</span>}
      </div>
    </div>
  );
}
