import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateCobro, useCreateCobroRecurrente, useCreateCobrosMasivos, useListClientes, useListMiembros, getListMiembrosQueryKey, getListCobrosQueryKey, getGetCobrosSummaryQueryKey, getGetDashboardMetricsQueryKey, useListWorkflows, getListWorkflowsQueryKey, useListWorkflowPlantillas, useCreateWorkflowFromPlantilla, useAsignarWorkflow, useGetDatosBancarios, getGetDatosBancariosQueryKey, type CobroInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import { TIPO_DOCUMENTO_OPTIONS, TIPO_DOCUMENTO_VALUES, tipoDocumentoPermiteIva } from "@/lib/tipo-documento";
import { Loader2, ArrowLeft, Users, Lock } from "lucide-react";
import { Link } from "wouter";
import { CatalogoLineas, lineasPayload, lineasValidas, totalLineas, type LineaCatalogo } from "@/components/catalogo-lineas";

const IVA_RATE = 0.19;

const formSchema = z.object({
  monto: z.coerce.number().int("El monto debe ser un número entero").min(1, "El monto debe ser mayor a $0"),
  tipoDocumento: z.enum(TIPO_DOCUMENTO_VALUES),
  incluyeIva: z.boolean().default(false),
  descripcion: z.string().min(1, "La descripción es obligatoria").max(255),
  referencia: z.string().optional(),
  clienteId: z.coerce.number().optional(),
  emailPagador: z.string().email("Email inválido").optional().or(z.literal("")),
  fechaVencimiento: z.string().optional().or(z.literal("")),
  responsableId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewCobro() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCobro = useCreateCobro();
  const createCobroRecurrente = useCreateCobroRecurrente();
  const createCobrosMasivos = useCreateCobrosMasivos();
  const { data: datosBancarios } = useGetDatosBancarios({
    query: { queryKey: getGetDatosBancariosQueryKey() },
  });
  const { user } = useAuth();
  const isOrgAdmin = user?.orgRole === "admin_org";
  const isSupervisor = user?.orgRole === "supervisor";
  const puedeAsignar = isOrgAdmin || isSupervisor;

  const { data: clientes } = useListClientes();
  const { data: miembros } = useListMiembros({
    query: { enabled: puedeAsignar, queryKey: getListMiembrosQueryKey() },
  });
  const miembrosActivos = (miembros?.filter((m) => m.activo) ?? []).filter(
    (m) => !isSupervisor || m.id === user?.id || m.supervisorId === user?.id,
  );

  const { data: workflowsList } = useListWorkflows({
    query: { queryKey: getListWorkflowsQueryKey() },
  });
  const { data: plantillasList } = useListWorkflowPlantillas();
  const asignarWorkflow = useAsignarWorkflow();
  const crearDesdePlantilla = useCreateWorkflowFromPlantilla();
  const [automatizacion, setAutomatizacion] = useState<"ninguna" | "simple" | "workflow">("ninguna");
  // "wf:<id>" for a saved workflow, "tpl:<key>" for a template to instantiate.
  const [workflowSeleccionado, setWorkflowSeleccionado] = useState<string>("");
  const [modoAvanzado, setModoAvanzado] = useState<"individual" | "masivo" | "recurrente">("individual");
  const [frecuencia, setFrecuencia] = useState("mensual");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaTermino, setFechaTermino] = useState("");
  const [busquedaMasiva, setBusquedaMasiva] = useState("");
  const [clienteIdsMasivos, setClienteIdsMasivos] = useState<number[]>([]);
  const [creandoAvanzado, setCreandoAvanzado] = useState(false);
  const advancedAttempt = useRef<{ signature: string; key: string } | null>(null);
  const advancedInFlight = useRef(false);
  const templateAttempt = useRef<{ key: string; id: number } | null>(null);
  const [canalesIniciales, setCanalesIniciales] = useState<Array<"email" | "whatsapp">>([]);
  const [lineas, setLineas] = useState<LineaCatalogo[]>([]);
  const usaLineas = lineas.length > 0;
  const totalItems = totalLineas(lineas);
  const [resultadosEntrega, setResultadosEntrega] = useState<Array<{ cobroId?: number; canal: string; estado: string; detalle?: string; waUrl?: string }>>([]);
  // Trial/demo/admin users inherit NextCob features even if a historical plan
  // field says Starter; server endpoints remain the source of enforcement.
  const planUser = user as (typeof user & { subscriptionStatus?: string; plan?: string }) | null;
  const nextCob = user?.role === "admin" || user?.esDemo || planUser?.subscriptionStatus === "prueba" || planUser?.plan !== "starter";

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      monto: 0,
      tipoDocumento: "sin_documento",
      incluyeIva: false,
      descripcion: "",
      referencia: "",
      clienteId: undefined,
      emailPagador: "",
      fechaVencimiento: "",
      responsableId: undefined,
    },
  });

  const selectedClienteId = form.watch("clienteId");
  const selectedCliente = clientes?.find((c) => c.id === selectedClienteId);

  const montoWatch = form.watch("monto");
  const tipoDocumentoWatch = form.watch("tipoDocumento");
  const permiteIva = tipoDocumentoPermiteIva(tipoDocumentoWatch);
  const incluyeIvaWatch = form.watch("incluyeIva");
  const netoNum = Number(montoWatch) || 0;
  const ivaNum = incluyeIvaWatch ? Math.round(netoNum * IVA_RATE) : 0;
  const totalNum = incluyeIvaWatch ? netoNum + ivaNum : netoNum;

  // Catalog lines drive the (neto) amount; keep the form field synchronized.
  useEffect(() => {
    if (usaLineas) form.setValue("monto", totalItems, { shouldValidate: true });
  }, [usaLineas, totalItems]);

  // Auto-fill email when a client is selected
  useEffect(() => {
    if (selectedCliente?.email) {
      form.setValue("emailPagador", selectedCliente.email, { shouldValidate: true });
    }
  }, [selectedCliente?.id]);

  // Exenta / sin_documento charges can never carry IVA — force the toggle off
  // whenever the selected document type does not allow it.
  useEffect(() => {
    if (!permiteIva && form.getValues("incluyeIva")) {
      form.setValue("incluyeIva", false);
    }
  }, [permiteIva]);

  const onSubmit = async (values: FormValues) => {
    if (advancedInFlight.current) return;
    if (usaLineas && (!lineasValidas(lineas) || totalItems < 1)) {
      toast({ title: "Revisa los ítems", description: "Cada ítem necesita cantidad mayor a 0 y precio válido, y el total debe ser mayor a $0.", variant: "destructive" });
      return;
    }
    const itemsInventario = usaLineas ? lineasPayload(lineas) : undefined;
    const montoFinal = usaLineas ? totalItems : values.monto;
    const payload: CobroInput = {
      itemsInventario,
      monto: montoFinal,
      tipoDocumento: values.tipoDocumento,
      incluyeIva: permiteIva ? values.incluyeIva : false,
      descripcion: values.descripcion,
      referencia: values.referencia || undefined,
      emailPagador: values.emailPagador || selectedCliente?.email || undefined,
      clienteId: values.clienteId || undefined,
      fechaVencimiento: values.fechaVencimiento || undefined,
      responsableId: puedeAsignar ? values.responsableId || undefined : undefined,
    };

    if (automatizacion === "workflow" && !workflowSeleccionado) {
      toast({
        title: "Selecciona un workflow",
        description: "Elige una plantilla o un workflow guardado, o cambia la opción de automatización.",
        variant: "destructive",
      });
      return;
    }

    if (modoAvanzado !== "individual") {
      if (!nextCob) {
        toast({ title: "Disponible en plan NextCob", description: "Disponible en plan NextCob", variant: "destructive" });
        return;
      }
      if (modoAvanzado === "recurrente" && (!values.clienteId || !fechaInicio)) {
        toast({ title: "Completa la programación", description: "Selecciona cliente y fecha de inicio.", variant: "destructive" });
        return;
      }
      if (modoAvanzado === "masivo" && clienteIdsMasivos.length === 0) {
        toast({ title: "Selecciona clientes", description: "Elige al menos un cliente para el cobro masivo.", variant: "destructive" });
        return;
      }
      setCreandoAvanzado(true);
      advancedInFlight.current = true;
      try {
        let workflowId: number | undefined;
        if (automatizacion === "workflow") {
          if (workflowSeleccionado.startsWith("tpl:")) {
            if (templateAttempt.current?.key !== workflowSeleccionado) {
              const nuevo = await crearDesdePlantilla.mutateAsync({ data: { plantillaKey: workflowSeleccionado.slice(4) } });
              templateAttempt.current = { key: workflowSeleccionado, id: nuevo.id };
            }
            workflowId = templateAttempt.current.id;
            queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
          } else {
            workflowId = Number(workflowSeleccionado.replace(/^wf:/, ""));
          }
          if (!Number.isInteger(workflowId) || workflowId! <= 0) throw new Error("Workflow inválido.");
        }
        const advancedPayload = {
          itemsInventario, monto: montoFinal, tipoDocumento: values.tipoDocumento, incluyeIva: permiteIva ? values.incluyeIva : false,
          descripcion: values.descripcion, referencia: values.referencia || undefined,
          responsableId: puedeAsignar ? values.responsableId || undefined : undefined,
           automatizacion, workflowId, canalesIniciales,
          ...(modoAvanzado === "recurrente"
            ? { clienteId: values.clienteId, emailPagador: values.emailPagador || selectedCliente?.email || undefined, frecuencia, fechaInicio, fechaTermino: fechaTermino || undefined }
            : { clienteIds: clienteIdsMasivos, fechaVencimiento: values.fechaVencimiento || undefined }),
        };
        const signature = JSON.stringify({ modoAvanzado, ...advancedPayload });
        if (advancedAttempt.current?.signature !== signature) {
          advancedAttempt.current = { signature, key: crypto.randomUUID() };
        }
        const requestPayload = { ...advancedPayload, idempotencyKey: advancedAttempt.current.key };
        const data = (modoAvanzado === "recurrente"
          ? await createCobroRecurrente.mutateAsync({ data: requestPayload as never })
          : await createCobrosMasivos.mutateAsync({ data: requestPayload as never })) as { cobro?: { id: number } | null; cobros?: Array<{ id: number }>; deliveryResults?: Array<{ cobroId?: number; canal: string; estado: string; detalle?: string; waUrl?: string }> };
        setResultadosEntrega(data.deliveryResults ?? []);
        queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardMetricsQueryKey() });
        toast({
          title: modoAvanzado === "recurrente" ? "Cobro recurrente programado" : "Cobros masivos creados",
          description: modoAvanzado === "recurrente" ? "Cada ciclo tendrá su propio cobro y link de pago." : `${data.cobros?.length ?? 0} cobros independientes generados.`,
        });
        // Keep the user on this page when delivery was requested so every
        // customer-specific outcome (including manual WhatsApp links) remains
        // actionable instead of disappearing behind a redirect.
        if (!(data.deliveryResults?.length)) {
          const targetId = data.cobro?.id ?? data.cobros?.[0]?.id;
          setLocation(targetId ? `/cobros/${targetId}` : "/cobros/informes");
        }
      } catch (error) {
        toast({ title: "Error", description: error instanceof Error ? error.message : "No se pudo crear el cobro.", variant: "destructive" });
      } finally {
        advancedInFlight.current = false;
        setCreandoAvanzado(false);
      }
      return;
    }

    createCobro.mutate({ data: payload }, {
      onSuccess: async (data) => {
        queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardMetricsQueryKey() });

        if (automatizacion === "workflow" && workflowSeleccionado) {
          try {
            let workflowId: number;
            if (workflowSeleccionado.startsWith("tpl:")) {
              const plantillaKey = workflowSeleccionado.slice(4);
              const nuevo = await crearDesdePlantilla.mutateAsync({ data: { plantillaKey } });
              queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
              workflowId = nuevo.id;
            } else {
              workflowId = Number(workflowSeleccionado.replace(/^wf:/, ""));
            }
            if (!Number.isInteger(workflowId) || workflowId <= 0) {
              throw new Error("workflow inválido");
            }
            await asignarWorkflow.mutateAsync({ id: data.id, data: { workflowId } });
            toast({
              title: "Cobro creado con automatización",
              description: "El workflow fue asignado al cobro.",
            });
          } catch {
            toast({
              title: "Cobro creado",
              description: "No se pudo asignar el workflow; puedes asignarlo desde el detalle.",
              variant: "destructive",
            });
          }
        } else {
          toast({
            title: "Cobro creado",
            description: "El cobro fue creado exitosamente.",
          });
        }
        setLocation(`/cobros/${data.id}`);
      },
      onError: () => {
        toast({
          title: "Error",
          description: "No se pudo crear el cobro.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver al Dashboard
      </Link>

      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-2xl">Nuevo cobro</CardTitle>
          <CardDescription>Crea un nuevo cargo para seguimiento y cobro.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="monto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{incluyeIvaWatch ? "Monto neto (sin IVA)" : "Monto"}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input
                            type="number"
                            step="1"
                            min="1"
                            placeholder="0"
                            className="pl-7 font-mono"
                            {...field}
                            readOnly={usaLineas}
                            disabled={usaLineas}
                          />
                        </div>
                      </FormControl>
                      {usaLineas && <FormDescription>Calculado desde los ítems del catálogo.</FormDescription>}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tipoDocumento"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de documento</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona el tipo..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TIPO_DOCUMENTO_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Documento tributario electrónico (DTE) asociado al cobro.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <CatalogoLineas lineas={lineas} onChange={setLineas} incluyeIva={permiteIva && !!incluyeIvaWatch} />

              <FormField
                control={form.control}
                name="referencia"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Referencia (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Factura #, N° de orden..." className="font-mono text-sm" {...field} />
                    </FormControl>
                    <FormDescription>Identificador externo para conciliación.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-lg border border-border/60 p-4 space-y-3">
                <p className="text-sm font-medium">¿Es un cobro recurrente o un cobro único?</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    ["individual", "Cobro único", "Comportamiento habitual"],
                    ["recurrente", "Cobro recurrente", "Generación automática por frecuencia"],
                    ["masivo", "Cobro masivo", "Un cobro por cliente seleccionado"],
                  ] as const).map(([key, label, desc]) => (
                    <button key={key} type="button" onClick={() => {
                      if (key !== "individual" && !nextCob) {
                        toast({ title: "Disponible en plan NextCob" });
                        return;
                      }
                      setModoAvanzado(key);
                    }}
                      className={`rounded-md border p-3 text-left text-sm ${modoAvanzado === key ? "border-primary bg-primary/5" : "border-border/50"} ${key !== "individual" && !nextCob ? "opacity-70" : ""}`}>
                      <span className="flex items-center gap-1 font-medium">{key !== "individual" && !nextCob && <Lock className="h-3 w-3" />}{label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{key !== "individual" && !nextCob ? "Disponible en plan NextCob" : desc}</span>
                    </button>
                  ))}
                </div>
                {modoAvanzado === "recurrente" && (
                  <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
                    <div><label className="text-xs font-medium">Frecuencia</label><Select value={frecuencia} onValueChange={setFrecuencia}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{[["semanal","Semanal"],["quincenal","Quincenal"],["mensual","Mensual"],["bimestral","Bimestral"],["trimestral","Trimestral"],["anual","Anual"]].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
                    <div><label className="text-xs font-medium">Fecha de inicio</label><Input className="mt-1" type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} /></div>
                    <div><label className="text-xs font-medium">Fecha de término (opcional)</label><Input className="mt-1" type="date" min={fechaInicio || undefined} value={fechaTermino} onChange={(e) => setFechaTermino(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">{!fechaTermino && "Sin fecha de término"}</p></div>
                    <p className="sm:col-span-3 text-xs text-muted-foreground">El siguiente cobro se genera al vencer el anterior. Cada ciclo es independiente y tiene su propio link y seguimiento.</p>
                  </div>
                )}
              </div>
              {modoAvanzado !== "individual" && (
                <div className="rounded-lg border border-border/60 p-4">
                  <p className="text-sm font-medium">Aviso inicial individual</p>
                  <p className="mb-2 text-xs text-muted-foreground">Cada cliente recibe solo sus propios datos. Los WhatsApp sin proveedor quedan listos para envío manual.</p>
                  {(["email", "whatsapp"] as const).map((canal) => (
                    <label key={canal} className="mr-4 inline-flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={canalesIniciales.includes(canal)} onChange={(e) => setCanalesIniciales((current) => e.target.checked ? [...current, canal] : current.filter((item) => item !== canal))} />
                      {canal === "email" ? "Email" : "WhatsApp"}
                    </label>
                  ))}
                </div>
              )}
              {resultadosEntrega.length > 0 && (
                <div className="rounded-lg border border-border/60 p-4 text-sm">
                  <p className="font-medium">Resultado de avisos</p>
                  <div className="mt-2 space-y-1">{resultadosEntrega.map((r, i) => <div key={`${r.cobroId ?? "schedule"}-${r.canal}-${i}`} className="flex items-center justify-between gap-2"><span>{r.cobroId ? `Cobro #${r.cobroId} · ` : ""}{r.canal}</span><span className="text-muted-foreground">{r.estado === "enviado" ? "Enviado" : r.estado === "pendiente_manual" ? "Listo para envío manual" : `Falló: ${r.detalle ?? "sin detalle"}`}</span>{r.waUrl && <a className="text-primary underline" href={r.waUrl} target="_blank" rel="noreferrer">Abrir WhatsApp</a>}</div>)}</div>
                </div>
              )}

              {permiteIva && (
                <FormField
                  control={form.control}
                  name="incluyeIva"
                  render={({ field }) => (
                    <FormItem className="rounded-lg border border-border/60 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Incluir IVA (19%)</FormLabel>
                          <FormDescription>
                            Si lo activas, el monto ingresado es el neto y se agrega el IVA al total a cobrar.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </div>

                    {incluyeIvaWatch && (
                      <div className="rounded-md bg-muted/50 p-3 space-y-1.5 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Neto</span>
                          <span className="font-mono">{formatCurrency(netoNum)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">IVA (19%)</span>
                          <span className="font-mono">{formatCurrency(ivaNum)}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-border/60">
                          <span className="font-medium text-primary">Total a cobrar</span>
                          <span className="font-mono font-bold text-primary">{formatCurrency(totalNum)}</span>
                        </div>
                      </div>
                    )}
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="descripcion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="¿Por qué es este cobro?"
                        className="resize-none h-24"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {modoAvanzado === "masivo" && (
                <div className="rounded-lg border border-border/60 p-4 space-y-3">
                  <div className="flex items-center justify-between"><p className="text-sm font-medium">Clientes del lote</p><span className="text-xs text-muted-foreground">{clienteIdsMasivos.length} seleccionados</span></div>
                  <Input value={busquedaMasiva} onChange={(e) => setBusquedaMasiva(e.target.value)} placeholder="Buscar por nombre o RUT" />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {(clientes ?? []).filter((c) => `${c.nombre} ${c.rut ?? ""}`.toLowerCase().includes(busquedaMasiva.toLowerCase())).map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted text-sm">
                        <input type="checkbox" checked={clienteIdsMasivos.includes(c.id)} onChange={(e) => setClienteIdsMasivos((ids) => e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))} />
                        <span>{c.nombre}</span>{c.rut && <span className="font-mono text-xs text-muted-foreground">{c.rut}</span>}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Monto, descripción, documento, vencimiento y automatización se aplican igual a cada cliente.</p>
                </div>
              )}

              {modoAvanzado !== "masivo" && <FormField
                control={form.control}
                name="clienteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {modoAvanzado === "recurrente" ? "Cliente" : "Cliente (opcional)"}
                    </FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "ninguno" ? undefined : Number(v))}
                      value={field.value ? String(field.value) : "ninguno"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar cliente..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ninguno">Sin cliente</SelectItem>
                        {clientes?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            <div className="flex flex-col items-start">
                              <span>{c.nombre}</span>
                              {c.rut && <span className="text-xs text-muted-foreground font-mono">{c.rut}</span>}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Asocia este cobro a un cliente existente.{" "}
                      <Link href="/clientes" className="text-primary hover:underline">
                        Gestionar clientes →
                      </Link>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />}

              {puedeAsignar && miembrosActivos.length > 0 && (
                <FormField
                  control={form.control}
                  name="responsableId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        Ejecutivo responsable
                      </FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(v === "yo" ? undefined : v)}
                        value={field.value ?? "yo"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Asignar a..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="yo">Yo (asignármelo)</SelectItem>
                          {miembrosActivos
                            .filter((m) => m.id !== user?.id)
                            .map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                <div className="flex flex-col items-start">
                                  <span>{m.nombre || m.email}</span>
                                  {m.nombre && m.email && (
                                    <span className="text-xs text-muted-foreground">{m.email}</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Asigna este cobro a un miembro de tu equipo para su seguimiento.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {modoAvanzado !== "masivo" && <FormField
                control={form.control}
                name="emailPagador"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email del pagador (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder={selectedCliente?.email ?? "pagador@ejemplo.com"}
                        className="text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {selectedCliente?.email
                        ? `Se usará el email del cliente (${selectedCliente.email}) al generar el link de pago si no ingresas otro.`
                        : "Se usará al generar el link de pago con Flow."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />}

              {modoAvanzado !== "recurrente" && <FormField
                control={form.control}
                name="fechaVencimiento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de vencimiento (opcional)</FormLabel>
                    <FormControl>
                      <Input type="date" className="text-sm" {...field} />
                    </FormControl>
                    <FormDescription>
                      Si la indicas, se aplicará automáticamente tu secuencia de recordatorios para
                      avisar al cliente antes y después del vencimiento.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />}

              <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                <div>
                  <p className="text-sm font-medium">Automatización de cobranza</p>
                  <p className="text-xs text-muted-foreground">
                    Elige cómo dar seguimiento a este cobro. Puedes cambiarlo después.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      { key: "ninguna", label: "Sin automatización", desc: "Seguimiento manual." },
                      { key: "simple", label: "Recordatorio simple", desc: "Secuencia por fecha de vencimiento." },
                      { key: "workflow", label: "Workflow inteligente", desc: "Plantilla o workflow guardado." },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setAutomatizacion(opt.key)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        automatizacion === opt.key
                          ? "border-primary bg-primary/5"
                          : "border-border/50 hover:bg-secondary/50"
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {automatizacion === "simple" && (
                  <div className="space-y-1.5 rounded-md border border-border/50 bg-background p-3">
                    <p className="text-xs text-muted-foreground">
                      Se aplicará tu secuencia de recordatorios simples usando la fecha de vencimiento
                      indicada abajo. Puedes personalizar la secuencia (días y canales) en la
                      configuración de recordatorios.
                    </p>
                    <Link
                      href="/recordatorios/config"
                      className="inline-block text-xs font-medium text-primary hover:underline"
                    >
                      Configurar secuencia de recordatorios →
                    </Link>
                  </div>
                )}
                {automatizacion === "workflow" && (
                  <div className="space-y-1.5">
                    <Select value={workflowSeleccionado} onValueChange={setWorkflowSeleccionado}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona una plantilla o workflow" />
                      </SelectTrigger>
                      <SelectContent>
                        {(plantillasList ?? []).length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Plantillas</SelectLabel>
                            {plantillasList!.map((p) => (
                              <SelectItem key={`tpl:${p.key}`} value={`tpl:${p.key}`}>
                                {p.nombre}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {(workflowsList ?? []).length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Mis workflows</SelectLabel>
                            {workflowsList!.map((w) => (
                              <SelectItem key={`wf:${w.id}`} value={`wf:${w.id}`}>
                                {w.nombre}
                                {!w.activo ? " (pausado)" : ""}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {(plantillasList ?? []).length === 0 &&
                          (workflowsList ?? []).length === 0 && (
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                              No hay workflows disponibles.
                            </div>
                          )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Al elegir una plantilla se creará un workflow a partir de ella. Al asignar un
                      workflow, los recordatorios simples quedan desactivados para este cobro.
                    </p>
                  </div>
                )}
              </div>

              {datosBancarios && !datosBancarios.configurado && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-3 py-2" data-testid="aviso-sin-datos-bancarios">
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Para incluir datos de transferencia en tus cobros, configura tu cuenta bancaria en{" "}
                    <Link href="/perfil" className="font-medium underline underline-offset-2">
                      Perfil → Datos bancarios
                    </Link>
                    .
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t border-border/50">
                <Button
                  type="submit"
                  disabled={createCobro.isPending || asignarWorkflow.isPending || creandoAvanzado}
                  className="min-w-32"
                >
                  {createCobro.isPending || asignarWorkflow.isPending || creandoAvanzado ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
                  ) : (
                    "Crear cobro"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
