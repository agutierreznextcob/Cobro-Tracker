import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  FileText,
  TrendingUp,
  FileSpreadsheet,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import PlanCuentasPage from "./plan-cuentas";
import AsientosPage from "./asientos";
import InformesPage from "./informes";
import PresupuestoPage from "./presupuesto";
import LibroSiiPage from "./libro-sii";

const SUBMODULOS = [
  {
    id: "asientos",
    label: "Asientos contables",
    icon: FileText,
    desc: "Registros de doble entrada",
    component: AsientosPage,
  },
  {
    id: "informes",
    label: "Informes",
    icon: BarChart3,
    desc: "Balances, estado de resultado, libros",
    component: InformesPage,
  },
  {
    id: "plan-cuentas",
    label: "Plan de cuentas",
    icon: BookOpen,
    desc: "PCGCh / IFRS Chile",
    component: PlanCuentasPage,
  },
  {
    id: "presupuesto",
    label: "Presupuesto",
    icon: TrendingUp,
    desc: "Proyección basada en datos reales",
    component: PresupuestoPage,
  },
  {
    id: "libro-sii",
    label: "Libro SII",
    icon: FileSpreadsheet,
    desc: "Importar compras y ventas",
    component: LibroSiiPage,
  },
];

export default function ContabilidadPage() {
  const [activo, setActivo] = useState("asientos");

  const submodulo = SUBMODULOS.find((s) => s.id === activo)!;
  const PageComponent = submodulo.component;

  return (
    <div className="flex gap-0 min-h-[calc(100vh-8rem)]">
      {/* Sidebar izquierdo */}
      <aside className="w-56 shrink-0 border-r bg-muted/30 flex flex-col">
        <div className="px-4 py-4 border-b">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Módulo</p>
          <h1 className="text-base font-bold tracking-tight mt-0.5">Contabilidad</h1>
        </div>
        <nav className="flex-1 py-2">
          {SUBMODULOS.map((s) => {
            const Icon = s.icon;
            const isActive = activo === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActivo(s.id)}
                className={cn(
                  "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                  isActive && "bg-background border-r-2 border-primary shadow-sm"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 mt-0.5 shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium leading-tight",
                      isActive ? "text-primary" : "text-foreground"
                    )}
                  >
                    {s.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.desc}</p>
                </div>
                {isActive && <ChevronRight className="h-3 w-3 ml-auto mt-1 shrink-0 text-primary" />}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Contenido principal */}
      <main className="flex-1 min-w-0 overflow-auto">
        <PageComponent hideHeader />
      </main>
    </div>
  );
}
