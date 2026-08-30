import { useState } from "react";
import { Link } from "wouter";
import {
  useListTareas,
  getListTareasQueryKey,
  useCreateTarea,
  useUpdateTareaEstado,
  useListMiembros,
  useListCobros,
  getListMiembrosQueryKey,
  getListCobrosQueryKey,
  getGetGestionHoyQueryKey,
  getGetGestionResumenQueryKey,
  type ListTareasParams,
  type ListTareasFecha,
  type MiembroEquipo,
  type Cobro
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Check, Loader2, ExternalLink, Plus, Filter, XCircle, RotateCcw, Clock, User } from "lucide-react";
import { formatCurrency, formatDate, formatDateSantiago, isVencidoSantiago } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const tareaSchema = z.object({
  titulo: z.string().min(1, "El título es requerido"),
  descripcion: z.string().optional(),
  responsableId: z.string().optional(),
  cobroId: z.string().optional(),
  venceEn: z.string().optional(),
});

type TareaFormValues = z.infer<typeof tareaSchema>;

export default function TareasPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [estadoFiltro, setEstadoFiltro] = useState<"pendiente" | "completada" | "cancelada">("pendiente");
  const [fechaFiltro, setFechaFiltro] = useState<ListTareasFecha>("todas");
  const [responsableFiltro, setResponsableFiltro] = useState<string>("all");
  const [cobroFiltro, setCobroFiltro] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const params: ListTareasParams = { estado: estadoFiltro };
  if (fechaFiltro !== "todas") {
    params.fecha = fechaFiltro;
  }
  if (responsableFiltro !== "all") {
    params.responsableId = responsableFiltro;
  }
  if (cobroFiltro !== "all") {
    params.cobroId = parseInt(cobroFiltro, 10);
  }

  const { data: tareas, isLoading, isError } = useListTareas(params, {
    query: { queryKey: getListTareasQueryKey(params) },
  });

  const { data: miembros } = useListMiembros({
    query: { queryKey: getListMiembrosQueryKey() }
  });

  const { data: cobrosResponse } = useListCobros({}, {
    query: { queryKey: getListCobrosQueryKey({}) }
  });

  const cobrosList: Cobro[] = cobrosResponse || [];
  const miembrosList: MiembroEquipo[] = miembros || [];

  const createTarea = useCreateTarea();
  const updateTarea = useUpdateTareaEstado();

  const form = useForm<TareaFormValues>({
    resolver: zodResolver(tareaSchema),
    defaultValues: {
      titulo: "",
      descripcion: "",
      responsableId: "",
      venceEn: "",
    },
  });

  const onSubmit = async (data: TareaFormValues) => {
    try {
      await createTarea.mutateAsync({ data: {
        titulo: data.titulo,
        descripcion: data.descripcion || undefined,
        responsableId: data.responsableId || undefined,
        cobroId: data.cobroId ? parseInt(data.cobroId, 10) : undefined,
        venceEn: data.venceEn || undefined
      } });
      queryClient.invalidateQueries({ queryKey: getListTareasQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGestionHoyQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGestionResumenQueryKey() });
      toast({ title: "Tarea creada exitosamente" });
      setIsCreateOpen(false);
      form.reset();
    } catch {
      toast({ title: "Error al crear tarea", variant: "destructive" });
    }
  };

  const handleUpdateEstado = async (id: number, nuevoEstado: "completada" | "cancelada" | "pendiente") => {
    try {
      await updateTarea.mutateAsync({ id, data: { estado: nuevoEstado } });
      queryClient.invalidateQueries({ queryKey: getListTareasQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGestionHoyQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGestionResumenQueryKey() });
      toast({ title: `Tarea marcada como ${nuevoEstado}` });
    } catch {
      toast({ title: "Error al actualizar tarea", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <CheckSquare className="h-7 w-7 text-primary" />
            Tareas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona compromisos y acciones de seguimiento de tus cobros.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="shrink-0 shadow-sm hover-elevate">
          <Plus className="mr-2 h-4 w-4" />
          Nueva Tarea
        </Button>
      </div>

      <div className="flex flex-col gap-4 items-start bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-2 w-full">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filtros:</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full">
          <div className="flex gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
            <Badge
              variant={estadoFiltro === "pendiente" ? "default" : "outline"}
              className="cursor-pointer hover:bg-primary/90 text-sm py-1 px-3"
              onClick={() => setEstadoFiltro("pendiente")}
            >
              Pendientes
            </Badge>
            <Badge
              variant={estadoFiltro === "completada" ? "default" : "outline"}
              className="cursor-pointer hover:bg-primary/90 text-sm py-1 px-3"
              onClick={() => setEstadoFiltro("completada")}
            >
              Completadas
            </Badge>
            <Badge
              variant={estadoFiltro === "cancelada" ? "default" : "outline"}
              className="cursor-pointer hover:bg-primary/90 text-sm py-1 px-3"
              onClick={() => setEstadoFiltro("cancelada")}
            >
              Canceladas
            </Badge>
          </div>

          <div className="flex gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
            <Select value={fechaFiltro} onValueChange={(val) => setFechaFiltro(val as ListTareasFecha)}>
              <SelectTrigger className="h-8 text-xs min-w-[140px]">
                <SelectValue placeholder="Fecha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las fechas</SelectItem>
                <SelectItem value="vencidas">Vencidas</SelectItem>
                <SelectItem value="hoy">Hoy</SelectItem>
                <SelectItem value="proximos_7">Próximos 7 días</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="sm:ml-auto flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-2 w-full sm:w-auto min-w-[200px]">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={responsableFiltro} onValueChange={setResponsableFiltro}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Responsable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los miembros</SelectItem>
                  {miembrosList.filter(m => m.activo).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.nombre || m.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto min-w-[200px]">
              <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={cobroFiltro} onValueChange={setCobroFiltro}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Cobro vinculado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Cualquier cobro</SelectItem>
                  {cobrosList.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.clienteNombre ? `${c.clienteNombre} - ` : ''}{c.descripcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {isError ? (
          <Card className="border-dashed bg-destructive/10 border-destructive/20">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center text-destructive">
              <CheckSquare className="h-12 w-12 mb-4 opacity-80" />
              <h3 className="text-lg font-medium mb-1">Error al cargar tareas</h3>
              <p>Ocurrió un problema al obtener la lista de tareas.</p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !tareas || tareas.length === 0 ? (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <CheckSquare className="h-12 w-12 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground mb-1">Sin tareas encontradas</h3>
              <p>No hay tareas que coincidan con los filtros seleccionados.</p>
            </CardContent>
          </Card>
        ) : (
          tareas.map((t) => {
            const isVencida = t.estado === "pendiente" && t.venceEn && isVencidoSantiago(t.venceEn);
            return (
              <Card key={t.id} className={`group hover-elevate transition-all shadow-sm hover:shadow-md ${isVencida ? 'border-l-4 border-l-destructive' : ''}`}>
                <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={`font-semibold text-base ${t.estado !== "pendiente" ? "text-muted-foreground" : ""}`}>
                        {t.titulo}
                      </span>
                      {t.estado === 'completada' && <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] uppercase">Completada</Badge>}
                      {t.estado === 'cancelada' && <Badge variant="secondary" className="bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[10px] uppercase">Cancelada</Badge>}
                      {isVencida && <Badge variant="destructive" className="text-[10px] uppercase">Atrasada</Badge>}
                      {t.origen === "workflow" && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">Automática</Badge>}
                    </div>

                    {t.descripcion && (
                      <p className="text-sm text-muted-foreground mb-3">{t.descripcion}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground/80">
                      {t.clienteNombre && (
                        <span className="font-medium text-foreground/80">{t.clienteNombre}</span>
                      )}

                      {t.responsableNombre && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {t.responsableNombre}
                        </span>
                      )}

                      {t.venceEn && (
                        <span className={`flex items-center gap-1 ${isVencida ? 'text-destructive font-medium' : ''}`}>
                          <Clock className="h-3 w-3" /> Vence {formatDateSantiago(t.venceEn)}
                        </span>
                      )}

                      {t.estado === "completada" && t.completadoEn && (
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3 text-emerald-500" /> Completada {formatDate(t.completadoEn)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-wrap sm:flex-col items-end gap-2 mt-4 sm:mt-0">
                    {t.cobroId && (
                      <Button size="sm" variant="ghost" className="h-8 text-primary" asChild>
                        <Link href={`/cobros/${t.cobroId}`}>
                          Ver cobro <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}

                    {t.estado === "pendiente" && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleUpdateEstado(t.id, "cancelada")}
                          disabled={updateTarea.isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 shadow-sm"
                          onClick={() => handleUpdateEstado(t.id, "completada")}
                          disabled={updateTarea.isPending}
                        >
                          <Check className="mr-1.5 h-4 w-4" /> Completar
                        </Button>
                      </div>
                    )}

                    {t.estado !== "pendiente" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => handleUpdateEstado(t.id, "pendiente")}
                        disabled={updateTarea.isPending}
                      >
                        <RotateCcw className="mr-1.5 h-4 w-4" /> Reabrir
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Tarea</DialogTitle>
            <DialogDescription>
              Crea una tarea para hacer seguimiento a un cliente o cobro específico.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
              <FormField
                control={form.control}
                name="titulo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Llamar para coordinar pago..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="descripcion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Detalles de la acción a realizar..." className="resize-none" rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="venceEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha de vencimiento</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="responsableId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Responsable</FormLabel>
                      <Select value={field.value || "none"} onValueChange={(val) => field.onChange(val === "none" ? "" : val)}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sin asignar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Mi usuario</SelectItem>
                          {miembrosList.filter(m => m.activo).map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.nombre || m.email}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="cobroId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vincular a un Cobro</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(val) => field.onChange(val === "none" ? "" : val)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin vincular" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Sin vincular</SelectItem>
                        {cobrosList.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>
                            {c.clienteNombre ? `${c.clienteNombre} - ` : ''} {c.descripcion} ({formatCurrency(c.monto)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createTarea.isPending}>
                  {createTarea.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Crear Tarea
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
