import { useState } from "react";
import {
  useListGestiones,
  useCrearGestion,
  getListGestionesQueryKey,
  getGetGestionesAgendaQueryKey,
  GestionTipo,
  GestionResultado,
  type GestionInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import {
  Phone,
  Mail,
  MessageCircle,
  MapPin,
  MoreHorizontal,
  ClipboardList,
  Loader2,
  CalendarClock,
} from "lucide-react";

const TIPO_META: Record<
  GestionTipo,
  { label: string; icon: typeof Phone }
> = {
  llamada: { label: "Llamada telefónica", icon: Phone },
  email: { label: "Email", icon: Mail },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  visita: { label: "Visita presencial", icon: MapPin },
  otro: { label: "Otro", icon: MoreHorizontal },
};

type Tono = "positivo" | "negativo" | "pendiente";

const RESULTADO_META: Record<
  GestionResultado,
  { label: string; tono: Tono }
> = {
  contactado_pagara: { label: "Contactado / pagará", tono: "positivo" },
  contactado_no_pagara: { label: "Contactado / no pagará", tono: "negativo" },
  no_contesto: { label: "No contestó", tono: "negativo" },
  numero_no_disponible: { label: "Número no disponible", tono: "negativo" },
  acordo_pago_parcial: { label: "Acordó pago parcial", tono: "positivo" },
  acordo_fecha_pago: { label: "Acordó fecha de pago", tono: "positivo" },
  disputa_reclamo: { label: "Disputa / reclamo", tono: "pendiente" },
};

const TONO_CLASSES: Record<Tono, string> = {
  positivo: "bg-green-100 text-green-700 border-green-200",
  negativo: "bg-red-100 text-red-700 border-red-200",
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
};

const TIPO_OPTIONS = Object.entries(TIPO_META) as [
  GestionTipo,
  { label: string; icon: typeof Phone },
][];
const RESULTADO_OPTIONS = Object.entries(RESULTADO_META) as [
  GestionResultado,
  { label: string; tono: Tono },
][];

export function GestionesSection({ cobroId }: { cobroId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: gestiones, isLoading } = useListGestiones(cobroId, {
    query: { enabled: !!cobroId, queryKey: getListGestionesQueryKey(cobroId) },
  });
  const crearGestion = useCrearGestion();

  const [tipo, setTipo] = useState<GestionTipo>(GestionTipo.llamada);
  const [resultado, setResultado] = useState<GestionResultado>(
    GestionResultado.contactado_pagara,
  );
  const [nota, setNota] = useState("");
  const [programar, setProgramar] = useState(false);
  const [proximaFecha, setProximaFecha] = useState("");
  const [proximaTipo, setProximaTipo] = useState<GestionTipo>(GestionTipo.llamada);

  const resetForm = () => {
    setTipo(GestionTipo.llamada);
    setResultado(GestionResultado.contactado_pagara);
    setNota("");
    setProgramar(false);
    setProximaFecha("");
    setProximaTipo(GestionTipo.llamada);
  };

  const handleGuardar = () => {
    if (programar && !proximaFecha) {
      toast({
        title: "Falta la fecha",
        description: "Indica la fecha y hora de la próxima gestión.",
        variant: "destructive",
      });
      return;
    }

    const data: GestionInput = {
      tipo,
      resultado,
      ...(nota.trim() ? { nota: nota.trim() } : {}),
      ...(programar && proximaFecha
        ? {
            proximaGestionEn: new Date(proximaFecha).toISOString(),
            proximaGestionTipo: proximaTipo,
          }
        : {}),
    };

    crearGestion.mutate(
      { id: cobroId, data },
      {
        onSuccess: () => {
          toast({
            title: "Gestión registrada",
            description: "La gestión fue añadida al historial.",
          });
          queryClient.invalidateQueries({
            queryKey: getListGestionesQueryKey(cobroId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetGestionesAgendaQueryKey(),
          });
          resetForm();
        },
        onError: () => {
          toast({
            title: "Error",
            description: "No se pudo registrar la gestión.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          Historial de gestiones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Formulario de nueva gestión */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de gestión</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as GestionTipo)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPO_OPTIONS.map(([value, meta]) => (
                    <SelectItem key={value} value={value}>
                      {meta.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Resultado</Label>
              <Select
                value={resultado}
                onValueChange={(v) => setResultado(v as GestionResultado)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESULTADO_OPTIONS.map(([value, meta]) => (
                    <SelectItem key={value} value={value}>
                      {meta.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gestion-nota" className="text-xs">
              Nota de gestión
            </Label>
            <Textarea
              id="gestion-nota"
              placeholder="Detalle de la gestión realizada..."
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-3 rounded-md border border-border/50 bg-background px-3 py-2.5">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={programar}
                onChange={(e) => setProgramar(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <CalendarClock className="h-4 w-4 text-primary" />
              Programar próxima gestión
            </label>
            {programar && (
              <div className="grid gap-3 sm:grid-cols-2 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="proxima-fecha" className="text-xs">
                    Fecha y hora
                  </Label>
                  <Input
                    id="proxima-fecha"
                    type="datetime-local"
                    value={proximaFecha}
                    onChange={(e) => setProximaFecha(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo de contacto planificado</Label>
                  <Select
                    value={proximaTipo}
                    onValueChange={(v) => setProximaTipo(v as GestionTipo)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPO_OPTIONS.map(([value, meta]) => (
                        <SelectItem key={value} value={value}>
                          {meta.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleGuardar} disabled={crearGestion.isPending} className="gap-1.5">
              {crearGestion.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Guardar gestión"
              )}
            </Button>
          </div>
        </div>

        {/* Historial cronológico */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-muted/40 rounded animate-pulse" />
            ))}
          </div>
        ) : !gestiones || gestiones.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aún no hay gestiones registradas para este cobro.
          </p>
        ) : (
          <div className="space-y-3">
            {gestiones.map((g) => {
              const tipoMeta = TIPO_META[g.tipo];
              const resultadoMeta = RESULTADO_META[g.resultado];
              const Icon = tipoMeta.icon;
              return (
                <div
                  key={g.id}
                  className="rounded-lg border border-border/60 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="h-4 w-4 text-primary" />
                      {tipoMeta.label}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${TONO_CLASSES[resultadoMeta.tono]}`}
                    >
                      {resultadoMeta.label}
                    </span>
                  </div>
                  {g.nota && <p className="text-sm mt-1.5 whitespace-pre-wrap">{g.nota}</p>}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px] text-muted-foreground">
                    <span>{formatDate(g.creadoEn)}</span>
                    {g.usuarioNombre && <span>· {g.usuarioNombre}</span>}
                  </div>
                  {g.proximaGestionEn && (
                    <div className="flex items-center gap-1.5 mt-2 rounded-md bg-primary/5 border border-primary/15 px-2 py-1 text-xs text-primary">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Próxima gestión: {formatDate(g.proximaGestionEn)}
                      {g.proximaGestionTipo && ` · ${TIPO_META[g.proximaGestionTipo].label}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
