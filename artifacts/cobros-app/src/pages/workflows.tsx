import { useState } from "react";
import { Link } from "wouter";
import {
  useListWorkflows,
  getListWorkflowsQueryKey,
  useGetWorkflowDashboard,
  getGetWorkflowDashboardQueryKey,
  useListWorkflowPlantillas,
  useCreateWorkflowFromPlantilla,
  useUpdateWorkflow,
  useDeleteWorkflow,
  type Workflow,
  type WorkflowPlantilla,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Workflow as WorkflowIcon,
  Zap,
  CalendarDays,
  Plus,
  Loader2,
  Settings2,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { accionLabel, triggerLabel } from "@/lib/workflow-labels";
import { formatDate, formatDateOnly } from "@/lib/format";

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Zap;
  label: string;
  value: number | string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function estadoIcon(estado: string) {
  if (estado === "enviado") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (estado === "fallido") return <XCircle className="h-4 w-4 text-red-500" />;
  if (estado === "omitido") return <XCircle className="h-4 w-4 text-gray-400" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

export default function WorkflowsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workflows, isLoading: loadingWf } = useListWorkflows({
    query: { queryKey: getListWorkflowsQueryKey() },
  });
  const { data: dashboard, isLoading: loadingDash } = useGetWorkflowDashboard({
    query: { queryKey: getGetWorkflowDashboardQueryKey() },
  });
  const { data: plantillas } = useListWorkflowPlantillas();

  const createFromPlantilla = useCreateWorkflowFromPlantilla();
  const updateWorkflow = useUpdateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const [plantillaOpen, setPlantillaOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Workflow | null>(null);

  function refetchAll() {
    void queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetWorkflowDashboardQueryKey() });
  }

  async function handleToggle(wf: Workflow, activo: boolean) {
    try {
      await updateWorkflow.mutateAsync({ id: wf.id, data: { activo } });
      refetchAll();
    } catch {
      toast({ title: "No se pudo actualizar el workflow", variant: "destructive" });
    }
  }

  async function handleCreateFromPlantilla(p: WorkflowPlantilla) {
    try {
      await createFromPlantilla.mutateAsync({ data: { plantillaKey: p.key } });
      setPlantillaOpen(false);
      refetchAll();
      toast({ title: `Workflow "${p.nombre}" creado` });
    } catch {
      toast({ title: "No se pudo crear el workflow", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await deleteWorkflow.mutateAsync({ id: toDelete.id });
      setToDelete(null);
      refetchAll();
      toast({ title: "Workflow eliminado" });
    } catch {
      toast({ title: "No se pudo eliminar el workflow", variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <WorkflowIcon className="h-6 w-6 text-primary" />
            Automatización de cobranza
          </h1>
          <p className="text-sm text-muted-foreground">
            Secuencias inteligentes que gestionan tus cobros automáticamente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPlantillaOpen(true)}>
            <Zap className="mr-2 h-4 w-4" />
            Desde plantilla
          </Button>
          <Link href="/workflows/nuevo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo workflow
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={WorkflowIcon} label="Workflows activos" value={workflows?.filter((w) => w.activo).length ?? 0} />
        <StatCard icon={Zap} label="Acciones hoy" value={dashboard?.accionesHoy ?? 0} />
        <StatCard icon={CalendarDays} label="Acciones esta semana" value={dashboard?.accionesSemana ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mis workflows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingWf ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !workflows || workflows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Aún no tienes workflows. Crea uno desde una plantilla para empezar.
            </div>
          ) : (
            workflows.map((wf) => (
              <div
                key={wf.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{wf.nombre}</span>
                    {wf.plantillaKey && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {wf.plantillaKey}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {triggerLabel(wf.triggerTipo)} · {wf.cobrosUsando ?? 0} cobro
                    {(wf.cobrosUsando ?? 0) !== 1 ? "s" : ""} usando
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={wf.activo}
                      onCheckedChange={(v) => handleToggle(wf, v)}
                      aria-label="Activar workflow"
                    />
                    <span className="text-xs text-muted-foreground">{wf.activo ? "Activo" : "Pausado"}</span>
                  </div>
                  <Link href={`/workflows/${wf.id}`}>
                    <Button variant="ghost" size="icon" aria-label="Editar">
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar"
                    onClick={() => setToDelete(wf)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Próximas acciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingDash ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !dashboard || dashboard.proximas.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No hay acciones programadas.</p>
            ) : (
              dashboard.proximas.map((p, i) => (
                <Link key={i} href={`/cobros/${p.cobroId}`}>
                  <div className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-secondary/50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{accionLabel(p.accionTipo)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.clienteNombre ?? "Cliente"} · {p.descripcion ?? `Cobro #${p.cobroId}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs font-medium text-muted-foreground">
                      {formatDateOnly(p.fecha)}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historial reciente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingDash ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !dashboard || dashboard.historial.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Sin actividad todavía.</p>
            ) : (
              dashboard.historial.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {estadoIcon(h.estado)}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{accionLabel(h.accionTipo)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {h.clienteNombre ?? `Cobro #${h.cobroId}`}
                        {h.detalle ? ` · ${h.detalle}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">{formatDate(h.creadoEn)}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={plantillaOpen} onOpenChange={setPlantillaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear desde plantilla</DialogTitle>
            <DialogDescription>
              Elige una secuencia predefinida. Podrás personalizarla después.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {plantillas?.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={createFromPlantilla.isPending}
                onClick={() => handleCreateFromPlantilla(p)}
                className="w-full rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-secondary/50 disabled:opacity-60"
              >
                <div className="font-medium">{p.nombre}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{p.descripcion}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {p.steps.length} paso{p.steps.length !== 1 ? "s" : ""} · {triggerLabel(p.triggerTipo)}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete != null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              Los cobros asignados volverán a los recordatorios simples. Esta acción no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
