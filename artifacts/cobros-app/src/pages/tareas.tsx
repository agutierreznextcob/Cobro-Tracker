import { useState } from "react";
import { Link } from "wouter";
import {
  useListTareas,
  getListTareasQueryKey,
  useCompletarTarea,
  type ListTareasParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckSquare, Check, Loader2, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/format";

export default function TareasPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<"pendiente" | "completada">("pendiente");

  const params: ListTareasParams = { estado: filtro };
  const { data: tareas, isLoading } = useListTareas(params, {
    query: { queryKey: getListTareasQueryKey(params) },
  });
  const completar = useCompletarTarea();

  async function handleComplete(id: number) {
    try {
      await completar.mutateAsync({ id });
      void queryClient.invalidateQueries({ queryKey: getListTareasQueryKey(params) });
      toast({ title: "Tarea completada" });
    } catch {
      toast({ title: "No se pudo completar la tarea", variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CheckSquare className="h-6 w-6 text-primary" />
          Tareas
        </h1>
        <p className="text-sm text-muted-foreground">
          Tareas de cobranza generadas por tus workflows.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          variant={filtro === "pendiente" ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltro("pendiente")}
        >
          Pendientes
        </Button>
        <Button
          variant={filtro === "completada" ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltro("completada")}
        >
          Completadas
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !tareas || tareas.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {filtro === "pendiente" ? "No tienes tareas pendientes." : "No hay tareas completadas."}
            </div>
          ) : (
            tareas.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${t.estado === "completada" ? "text-muted-foreground line-through" : ""}`}>
                      {t.titulo}
                    </span>
                    {t.cobroId != null && (
                      <Link href={`/cobros/${t.cobroId}`}>
                        <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          Ver cobro <ExternalLink className="h-3 w-3" />
                        </span>
                      </Link>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.clienteNombre ? `${t.clienteNombre} · ` : ""}
                    {t.estado === "completada" && t.completadoEn
                      ? `Completada ${formatDate(t.completadoEn)}`
                      : `Creada ${formatDate(t.creadoEn)}`}
                  </div>
                  {t.descripcion && (
                    <div className="mt-1 text-xs text-muted-foreground">{t.descripcion}</div>
                  )}
                </div>
                {t.estado === "pendiente" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleComplete(t.id)}
                    disabled={completar.isPending}
                  >
                    <Check className="mr-1.5 h-4 w-4" />
                    Completar
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
