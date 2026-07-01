import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetWorkflow,
  getGetWorkflowQueryKey,
  useCreateWorkflow,
  useUpdateWorkflow,
  type WorkflowStepInput,
  type WorkflowStepConfig,
  type WorkflowStepConfigNuevoEstado,
  type WorkflowCondiciones,
  type WorkflowTriggerTipo,
  type WorkflowStepAccionTipo,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Save, Loader2, GripVertical } from "lucide-react";
import {
  ACCION_TIPOS,
  TRIGGER_TIPOS,
  accionLabel,
  triggerLabel,
} from "@/lib/workflow-labels";

type StepDraft = {
  delayDias: number;
  accionTipo: WorkflowStepAccionTipo;
  asunto: string;
  mensaje: string;
  tareaTitulo: string;
  descuentoTipo: "porcentaje" | "monto";
  descuentoValor: number;
  nuevoEstado: string;
};

const SCORE_OPCIONES: { value: string; label: string }[] = [
  { value: "excelente", label: "Excelente" },
  { value: "bueno", label: "Bueno" },
  { value: "regular", label: "Regular" },
  { value: "riesgoso", label: "Riesgoso" },
  { value: "critico", label: "Crítico" },
];

function emptyStep(): StepDraft {
  return {
    delayDias: 0,
    accionTipo: "enviar_email",
    asunto: "",
    mensaje: "",
    tareaTitulo: "",
    descuentoTipo: "porcentaje",
    descuentoValor: 0,
    nuevoEstado: "cancelado",
  };
}

function toStepInput(s: StepDraft, orden: number): WorkflowStepInput {
  const config: WorkflowStepConfig = {};
  if (s.accionTipo === "enviar_email") {
    config.asunto = s.asunto || null;
    config.mensaje = s.mensaje || null;
  } else if (s.accionTipo === "enviar_whatsapp" || s.accionTipo === "notificar_admin") {
    config.mensaje = s.mensaje || null;
  } else if (s.accionTipo === "crear_tarea") {
    config.tareaTitulo = s.tareaTitulo || null;
  } else if (s.accionTipo === "aplicar_descuento") {
    config.descuentoTipo = s.descuentoTipo;
    config.descuentoValor = s.descuentoValor;
  } else if (s.accionTipo === "cambiar_estado") {
    config.nuevoEstado = s.nuevoEstado as WorkflowStepConfigNuevoEstado;
  }
  return { orden, delayDias: s.delayDias, accionTipo: s.accionTipo, config };
}

export default function WorkflowDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isNew = params.id === "nuevo" || params.id == null;
  const id = isNew ? null : Number(params.id);

  const { data: workflow, isLoading } = useGetWorkflow(id ?? 0, {
    query: { queryKey: getGetWorkflowQueryKey(id ?? 0), enabled: id != null },
  });

  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();

  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [activo, setActivo] = useState(true);
  const [triggerTipo, setTriggerTipo] = useState<WorkflowTriggerTipo>("cobro_creado");
  const [triggerDias, setTriggerDias] = useState(0);
  const [condMontoMin, setCondMontoMin] = useState("");
  const [condMontoMax, setCondMontoMax] = useState("");
  const [condScores, setCondScores] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);

  useEffect(() => {
    if (workflow) {
      setNombre(workflow.nombre);
      setDescripcion(workflow.descripcion ?? "");
      setActivo(workflow.activo);
      setTriggerTipo(workflow.triggerTipo);
      setTriggerDias(workflow.triggerDias);
      setCondMontoMin(
        workflow.condiciones?.montoMin != null ? String(workflow.condiciones.montoMin) : "",
      );
      setCondMontoMax(
        workflow.condiciones?.montoMax != null ? String(workflow.condiciones.montoMax) : "",
      );
      setCondScores(workflow.condiciones?.scores ?? []);
      setSteps(
        (workflow.steps ?? []).map((s) => ({
          delayDias: s.delayDias,
          accionTipo: s.accionTipo,
          asunto: s.config?.asunto ?? "",
          mensaje: s.config?.mensaje ?? "",
          tareaTitulo: s.config?.tareaTitulo ?? "",
          descuentoTipo: (s.config?.descuentoTipo as "porcentaje" | "monto") ?? "porcentaje",
          descuentoValor: s.config?.descuentoValor ?? 0,
          nuevoEstado: s.config?.nuevoEstado ?? "cancelado",
        })),
      );
    }
  }, [workflow]);

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function handleSave() {
    if (!nombre.trim()) {
      toast({ title: "El nombre es obligatorio", variant: "destructive" });
      return;
    }
    const stepInputs = steps.map((s, i) => toStepInput(s, i));
    const montoMin = condMontoMin.trim() === "" ? null : Number(condMontoMin);
    const montoMax = condMontoMax.trim() === "" ? null : Number(condMontoMax);
    const condiciones: WorkflowCondiciones = {
      montoMin: Number.isFinite(montoMin as number) ? montoMin : null,
      montoMax: Number.isFinite(montoMax as number) ? montoMax : null,
      scores: condScores.length > 0 ? condScores : null,
    };
    try {
      if (isNew) {
        const created = await createWorkflow.mutateAsync({
          data: {
            nombre: nombre.trim(),
            descripcion: descripcion.trim() || null,
            activo,
            triggerTipo,
            triggerDias,
            condiciones,
            steps: stepInputs,
          },
        });
        toast({ title: "Workflow creado" });
        navigate(`/workflows/${created.id}`);
      } else if (id != null) {
        await updateWorkflow.mutateAsync({
          id,
          data: {
            nombre: nombre.trim(),
            descripcion: descripcion.trim() || null,
            activo,
            triggerTipo,
            triggerDias,
            condiciones,
            steps: stepInputs,
          },
        });
        toast({ title: "Cambios guardados" });
      }
    } catch {
      toast({ title: "No se pudo guardar el workflow", variant: "destructive" });
    }
  }

  const saving = createWorkflow.isPending || updateWorkflow.isPending;

  if (!isNew && isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/workflows")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar
        </Button>
      </div>

      <h1 className="text-2xl font-bold">{isNew ? "Nuevo workflow" : "Editar workflow"}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuración general</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Cobranza estándar" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Describe cuándo usar este workflow"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Disparador</Label>
              <Select value={triggerTipo} onValueChange={(v) => setTriggerTipo(v as WorkflowTriggerTipo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {triggerLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="triggerDias">Días de referencia</Label>
              <Input
                id="triggerDias"
                type="number"
                value={triggerDias}
                onChange={(e) => setTriggerDias(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={activo} onCheckedChange={setActivo} id="activo" />
            <Label htmlFor="activo" className="cursor-pointer">
              Workflow activo
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Condiciones (opcional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Aplica este workflow solo a los cobros que cumplan estas condiciones. Déjalas vacías
            para aplicarlo a todos.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="condMontoMin">Monto mínimo (CLP)</Label>
              <Input
                id="condMontoMin"
                type="number"
                min={0}
                value={condMontoMin}
                onChange={(e) => setCondMontoMin(e.target.value)}
                placeholder="Sin mínimo"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="condMontoMax">Monto máximo (CLP)</Label>
              <Input
                id="condMontoMax"
                type="number"
                min={0}
                value={condMontoMax}
                onChange={(e) => setCondMontoMax(e.target.value)}
                placeholder="Sin máximo"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Score del cliente</Label>
            <div className="flex flex-wrap gap-2">
              {SCORE_OPCIONES.map((s) => {
                const activeSel = condScores.includes(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() =>
                      setCondScores((prev) =>
                        prev.includes(s.value)
                          ? prev.filter((x) => x !== s.value)
                          : [...prev, s.value],
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      activeSel
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 text-muted-foreground hover:bg-secondary/50"
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Si no eliges ninguno, aplica a cualquier score.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pasos de la secuencia</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setSteps((p) => [...p, emptyStep()])}>
            <Plus className="mr-2 h-4 w-4" />
            Añadir paso
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {steps.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Añade al menos un paso a la secuencia.
            </p>
          )}
          {steps.map((s, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <GripVertical className="h-4 w-4" />
                  Paso {i + 1}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Eliminar paso"
                  onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Acción</Label>
                  <Select
                    value={s.accionTipo}
                    onValueChange={(v) => updateStep(i, { accionTipo: v as WorkflowStepAccionTipo })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCION_TIPOS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {accionLabel(a)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Esperar (días)</Label>
                  <Input
                    type="number"
                    value={s.delayDias}
                    onChange={(e) => updateStep(i, { delayDias: Number(e.target.value) })}
                  />
                </div>
              </div>

              {s.accionTipo === "enviar_email" && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <Label>Asunto</Label>
                    <Input value={s.asunto} onChange={(e) => updateStep(i, { asunto: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Mensaje</Label>
                    <Textarea value={s.mensaje} onChange={(e) => updateStep(i, { mensaje: e.target.value })} rows={3} />
                  </div>
                </div>
              )}
              {(s.accionTipo === "enviar_whatsapp" || s.accionTipo === "notificar_admin") && (
                <div className="mt-3 space-y-2">
                  <Label>Mensaje</Label>
                  <Textarea value={s.mensaje} onChange={(e) => updateStep(i, { mensaje: e.target.value })} rows={3} />
                </div>
              )}
              {s.accionTipo === "crear_tarea" && (
                <div className="mt-3 space-y-2">
                  <Label>Título de la tarea</Label>
                  <Input value={s.tareaTitulo} onChange={(e) => updateStep(i, { tareaTitulo: e.target.value })} />
                </div>
              )}
              {s.accionTipo === "aplicar_descuento" && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select
                      value={s.descuentoTipo}
                      onValueChange={(v) => updateStep(i, { descuentoTipo: v as "porcentaje" | "monto" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="porcentaje">Porcentaje (%)</SelectItem>
                        <SelectItem value="monto">Monto fijo ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Valor</Label>
                    <Input
                      type="number"
                      value={s.descuentoValor}
                      onChange={(e) => updateStep(i, { descuentoValor: Number(e.target.value) })}
                    />
                  </div>
                </div>
              )}
              {s.accionTipo === "cambiar_estado" && (
                <div className="mt-3 space-y-2">
                  <Label>Nuevo estado</Label>
                  <Select value={s.nuevoEstado} onValueChange={(v) => updateStep(i, { nuevoEstado: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                      <SelectItem value="fallido">Fallido</SelectItem>
                      <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
