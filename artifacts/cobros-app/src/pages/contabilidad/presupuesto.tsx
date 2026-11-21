/**
 * Módulo Presupuesto
 * El presupuesto se calcula automáticamente desde datos reales de cobros y compras.
 * La proyección se muestra en la pestaña "Presupuesto" dentro de Informes.
 * Este componente redirige al usuario a esa sección.
 */
import { TrendingUp, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props { hideHeader?: boolean }

export default function PresupuestoPage({ hideHeader }: Props) {
  return (
    <div className="p-5 space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Presupuesto</h1>
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <TrendingUp className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-base">Presupuesto automático</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              El presupuesto se calcula automáticamente en base a los cobros pagados y compras registradas en la plataforma.
              La proyección para los próximos 12 meses está disponible en <strong>Informes → Presupuesto</strong>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
