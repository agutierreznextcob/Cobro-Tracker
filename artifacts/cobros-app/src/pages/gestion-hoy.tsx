import { Link } from "wouter";
import {
  useGetGestionHoy,
  getGetGestionHoyQueryKey,
  useCompletarGestionAgenda,
  useUpdateTareaEstado,
  getGetGestionResumenQueryKey,
  getListTareasQueryKey,
  type Tarea,
  type GestionAgendaItem
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Calendar, Lightbulb, Clock, ArrowRight, CheckSquare, Loader2, DollarSign, User, AlertCircle, Percent } from "lucide-react";
import { formatCurrency, formatDateSantiago, isVencidoSantiago } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export default function GestionHoyPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: hoy, isLoading, isError } = useGetGestionHoy({ query: { queryKey: getGetGestionHoyQueryKey() } });

  const completeAgenda = useCompletarGestionAgenda();
  const updateTarea = useUpdateTareaEstado();

  const handleCompleteAgenda = async (gestionId: number) => {
    try {
      await completeAgenda.mutateAsync({ gestionId });
      queryClient.invalidateQueries({ queryKey: getGetGestionHoyQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGestionResumenQueryKey() });
      toast({ title: "Compromiso completado" });
    } catch {
      toast({ title: "Error al completar compromiso", variant: "destructive" });
    }
  };

  const handleCompleteTarea = async (id: number) => {
    try {
      await updateTarea.mutateAsync({ id, data: { estado: "completada" } });
      queryClient.invalidateQueries({ queryKey: getListTareasQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGestionHoyQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGestionResumenQueryKey() });
      toast({ title: "Tarea completada" });
    } catch {
      toast({ title: "Error al completar tarea", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Qué hacer hoy</h1>
        </div>
        <Card className="border-dashed bg-destructive/10 border-destructive/20">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center text-destructive">
            <CheckSquare className="h-12 w-12 mb-4 opacity-80" />
            <h3 className="text-lg font-medium mb-1">Error al cargar el resumen</h3>
            <p>Ocurrió un problema al obtener las acciones y tareas de hoy.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { tareas = [], agenda = [], sugerencias = [], recuperacionPotencialSemanal = 0, clientesSugeridos = 0 } = hoy || {};

  // Unify tasks and agenda
  type MergedItem =
    | { type: 'tarea'; data: Tarea; sortDate: number }
    | { type: 'agenda'; data: GestionAgendaItem; sortDate: number };

  const mergedList: MergedItem[] = [
    ...tareas.map(t => ({
      type: 'tarea' as const,
      data: t,
      sortDate: t.venceEn ? new Date(t.venceEn).getTime() : 0
    })),
    ...agenda.map(a => ({
      type: 'agenda' as const,
      data: a,
      sortDate: a.proximaGestionEn ? new Date(a.proximaGestionEn).getTime() : 0
    }))
  ].sort((a, b) => {
    // Both 0 at end
    if (a.sortDate === 0 && b.sortDate === 0) return 0;
    if (a.sortDate === 0) return 1;
    if (b.sortDate === 0) return -1;
    return a.sortDate - b.sortDate;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Qué hacer hoy</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tu cockpit de cobranza para hoy. Resuelve tus compromisos y atiende las sugerencias automáticas.
        </p>
      </div>

      {clientesSugeridos > 0 ? (
        <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="bg-emerald-100 dark:bg-emerald-900 p-2.5 rounded-full shrink-0">
              <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold text-emerald-800 dark:text-emerald-300">Oportunidad de recuperación</h3>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">
                Esta semana podrías recuperar hasta <strong>{formatCurrency(recuperacionPotencialSemanal)}</strong> si contactas a {clientesSugeridos === 1 ? 'este cliente sugerido' : `estos ${clientesSugeridos} clientes sugeridos`}.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-muted/50 border-muted shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="bg-muted p-2.5 rounded-full shrink-0">
              <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Todo bajo control</h3>
              <p className="text-sm text-muted-foreground">
                No hay clientes con alto riesgo de mora que requieran contacto urgente hoy.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gestiones Programadas (Unificada) */}
        <div className="lg:col-span-2 space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Gestiones programadas ({mergedList.length})
              </h2>
            </div>
            {mergedList.length === 0 ? (
              <Card className="border-dashed bg-muted/30">
                <CardContent className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <CheckSquare className="h-10 w-10 mb-3 opacity-20" />
                  <p>No tienes tareas ni compromisos pendientes para hoy.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {mergedList.map((item, idx) => {
                  if (item.type === 'agenda') {
                    const agendaItem = item.data;
                    return (
                      <Card key={`agenda-${agendaItem.gestionId}-${idx}`} className={`group hover-elevate transition-all shadow-sm hover:shadow-md ${agendaItem.vencida ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-primary'}`}>
                        <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-semibold text-base text-foreground truncate">
                                {agendaItem.clienteNombre}
                              </span>
                              <Badge variant="secondary" className="text-[10px] uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/50">Compromiso</Badge>
                              {agendaItem.vencida && <Badge variant="destructive" className="text-[10px] uppercase tracking-wider">Atrasado</Badge>}
                              {agendaItem.estado && !agendaItem.vencida && (
                                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{agendaItem.estado}</Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
                              {agendaItem.cobroDescripcion && (
                                <span className="truncate max-w-[200px] inline-block">{agendaItem.cobroDescripcion}</span>
                              )}
                              {agendaItem.saldo !== undefined && (
                                <span className="font-medium text-foreground flex items-center"><DollarSign className="h-3 w-3 mr-0.5 text-muted-foreground" />{formatCurrency(agendaItem.saldo)}</span>
                              )}
                              {agendaItem.proximaGestionEn && (
                                <span className={`flex items-center gap-1 text-xs ${agendaItem.vencida ? 'text-destructive font-medium' : ''}`}>
                                  <Clock className="h-3 w-3" />
                                  {agendaItem.proximaGestionTipo ? `${agendaItem.proximaGestionTipo} ` : ''}
                                  {formatDateSantiago(agendaItem.proximaGestionEn)}
                                </span>
                              )}
                              {agendaItem.responsableNombre && (
                                <span className="flex items-center gap-1 text-xs">
                                  <User className="h-3 w-3" /> {agendaItem.responsableNombre}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2 mt-2 sm:mt-0">
                            {agendaItem.cobroId && (
                              <Button size="sm" variant="secondary" className="h-8 transition-opacity" asChild>
                                <Link href={`/cobros/${agendaItem.cobroId}`}>Ver cobro</Link>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              className="h-8"
                              onClick={() => handleCompleteAgenda(agendaItem.gestionId)}
                              disabled={completeAgenda.isPending}
                            >
                              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Listo
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  } else {
                    const tarea = item.data;
                    const isVencida = tarea.venceEn && isVencidoSantiago(tarea.venceEn);
                    return (
                      <Card key={`tarea-${tarea.id}-${idx}`} className={`group transition-all shadow-sm hover:shadow-md ${isVencida ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-orange-500'}`}>
                        <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-semibold">{tarea.titulo}</span>
                              <Badge variant="secondary" className="text-[10px] uppercase tracking-wider bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800/50">Tarea</Badge>
                              {isVencida && <Badge variant="destructive" className="text-[10px] uppercase tracking-wider">Atrasada</Badge>}
                            </div>
                            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
                              {tarea.clienteNombre && (
                                <span className="truncate max-w-[200px]">{tarea.clienteNombre}</span>
                              )}
                              {tarea.venceEn && (
                                <span className={`flex items-center gap-1 text-xs ${isVencida ? 'text-destructive font-medium' : ''}`}>
                                  <Clock className="h-3 w-3" />
                                  Vence {formatDateSantiago(tarea.venceEn)}
                                </span>
                              )}
                              {tarea.responsableNombre && (
                                <span className="flex items-center gap-1 text-xs">
                                  <User className="h-3 w-3" /> {tarea.responsableNombre}
                                </span>
                              )}
                            </div>
                            {tarea.descripcion && <p className="text-sm mt-1.5 text-muted-foreground/80 line-clamp-2">{tarea.descripcion}</p>}
                          </div>
                          <div className="shrink-0 flex items-center gap-2 mt-2 sm:mt-0">
                            {tarea.cobroId && (
                              <Button size="sm" variant="secondary" className="h-8 transition-opacity" asChild>
                                <Link href={`/cobros/${tarea.cobroId}`}>Ver cobro</Link>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-dashed hover:border-solid hover:bg-secondary/50"
                              onClick={() => handleCompleteTarea(tarea.id)}
                              disabled={updateTarea.isPending}
                            >
                              <CheckSquare className="mr-1.5 h-4 w-4" /> Completar
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  }
                })}
              </div>
            )}
          </section>
        </div>

        {/* Sugerencias Automáticas */}
        <div className="space-y-6">
          <section className="space-y-4 sticky top-20">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              Sugeridas por NextCob ({sugerencias.length})
            </h2>
            {sugerencias.length === 0 ? (
              <Card className="border-dashed bg-muted/30">
                <CardContent className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <Lightbulb className="h-8 w-8 mb-3 opacity-20" />
                  <p className="text-sm">No hay sugerencias en este momento.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {sugerencias.map((sug, i) => (
                  <Card key={`${sug.clienteId}-${i}`} className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 shadow-sm hover-elevate">
                    <CardContent className="p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-start gap-2">
                        <Link href={`/clientes/${sug.clienteId}`} className="font-semibold text-base hover:text-primary truncate flex-1">
                          {sug.clienteNombre}
                        </Link>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-amber-100/50 dark:bg-amber-900/30 p-2 rounded flex flex-col">
                          <span className="text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Pendiente</span>
                          <span className="font-semibold flex items-center text-sm">
                            <DollarSign className="h-3 w-3 mr-0.5 text-muted-foreground" />
                            {formatCurrency(sug.totalPendiente)}
                          </span>
                        </div>
                        <div className="bg-amber-100/50 dark:bg-amber-900/30 p-2 rounded flex flex-col">
                          <span className="text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Días Mora</span>
                          <span className="font-semibold flex items-center text-sm gap-1">
                            <AlertCircle className="h-3 w-3 text-destructive" />
                            {sug.diasMora}
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium bg-secondary/30 p-1.5 rounded-md">
                        <Percent className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />
                        <span>
                          {sug.probabilidadPago != null
                            ? `${sug.probabilidadPago}% prob. de pago 7 días`
                            : "Prob. de pago: sin datos"}
                        </span>
                      </div>

                      <div className="text-sm text-muted-foreground leading-snug bg-white dark:bg-black/20 p-2.5 rounded border border-amber-200/50 dark:border-amber-900/50">
                        <span className="font-medium text-foreground block mb-1 text-[10px] uppercase tracking-wider">Motivo sugerencia</span>
                        {sug.texto}
                      </div>

                      <div className="pt-2 flex justify-end gap-2 mt-auto">
                         {sug.cobroId && (
                           <Button size="sm" variant="ghost" className="h-8 text-xs px-2" asChild>
                             <Link href={`/cobros/${sug.cobroId}`}>Ver cobro</Link>
                           </Button>
                         )}
                         <Button size="sm" className="h-8 text-xs px-3 bg-amber-600 hover:bg-amber-700 text-white" asChild>
                           <Link href={`/clientes/${sug.clienteId}`}>Contactar <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
                         </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
