import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, FileText, TrendingUp, Calculator, FileSpreadsheet, BarChart3 } from "lucide-react";
import PlanCuentasPage from "./plan-cuentas";
import AsientosPage from "./asientos";
import InformesPage from "./informes";
import PresupuestoPage from "./presupuesto";
import LibroSiiPage from "./libro-sii";

const TABS = [
  { value: "asientos", label: "Asientos", icon: FileText },
  { value: "informes", label: "Informes", icon: BarChart3 },
  { value: "plan-cuentas", label: "Plan de cuentas", icon: BookOpen },
  { value: "presupuesto", label: "Presupuesto", icon: TrendingUp },
  { value: "libro-sii", label: "Libro SII", icon: FileSpreadsheet },
];

export default function ContabilidadPage() {
  const [tab, setTab] = useState("asientos");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Módulo</p>
        <h1 className="text-2xl font-bold tracking-tight">Contabilidad</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Asientos, informes, plan de cuentas, presupuesto e importación SII</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="asientos" className="mt-0">
          <AsientosPage hideHeader />
        </TabsContent>
        <TabsContent value="informes" className="mt-0">
          <InformesPage hideHeader />
        </TabsContent>
        <TabsContent value="plan-cuentas" className="mt-0">
          <PlanCuentasPage hideHeader />
        </TabsContent>
        <TabsContent value="presupuesto" className="mt-0">
          <PresupuestoPage hideHeader />
        </TabsContent>
        <TabsContent value="libro-sii" className="mt-0">
          <LibroSiiPage hideHeader />
        </TabsContent>
      </Tabs>
    </div>
  );
}
