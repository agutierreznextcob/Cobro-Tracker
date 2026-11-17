import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Workflow, CalendarClock } from "lucide-react";
import WorkflowsPage from "./workflows";
import RecordatoriosConfig from "./recordatorios-config";

export default function ConfiguracionCobranza() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Configuración</p>
        <h1 className="text-2xl font-bold tracking-tight">Cobranza</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configura la automatización y los recordatorios de cobranza.
        </p>
      </div>

      <Tabs defaultValue="automatizacion" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="automatizacion" className="gap-1.5">
            <Workflow className="h-4 w-4" />
            Automatización
          </TabsTrigger>
          <TabsTrigger value="recordatorios" className="gap-1.5">
            <CalendarClock className="h-4 w-4" />
            Recordatorios
          </TabsTrigger>
        </TabsList>

        <TabsContent value="automatizacion" className="mt-0">
          <WorkflowsPage hideHeader />
        </TabsContent>

        <TabsContent value="recordatorios" className="mt-0">
          <RecordatoriosConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
}
