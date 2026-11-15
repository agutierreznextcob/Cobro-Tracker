import { EquivalenciaCLP } from "@/components/equivalencia-clp";
import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateCobro, useCreateCobroRecurrente, useCreateCobrosMasivos,
  useListClientes, useListMiembros, useGetDatosBancarios, useGetCotizacion,
  getListMiembrosQueryKey, getListCobrosQueryKey,
  getGetCobrosSummaryQueryKey, getGetDashboardMetricsQueryKey,
  getGetDatosBancariosQueryKey,
  type CobroInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, roundTo, MONEDAS, MONEDA_INFO, type Moneda } from "@/lib/format";
import { usePreferencias, decimalesPref } from "@/hooks/use-preferencias";
import { TIPO_DOCUMENTO_GRUPOS, TIPO_DOCUMENTO_LABELS, TIPO_DOCUMENTO_VALUES, tipoDocumentoPermiteIva } from "@/lib/tipo-documento";
import { Loader2, ArrowLeft, Users, Lock, ChevronDown, ChevronUp, Calendar, FileText } from "lucide-react";
import { Link } from "wouter";
import { CatalogoLineas, lineasPayload, lineasValidas, totalLineas, type LineaCatalogo } from "@/components/catalogo-lineas";

const formSchema = z.object({
  tipoDocumento: z.enum(TIPO_DOCUMENTO_VALUES),
  incluyeIva: z.boolean().default(false),
  descripcion: z.string().max(255).optional().or(z.literal("")),
  clienteId: z.coerce.number().optional(),
  emailPagador: z.string().email("Email inválido").optional().or(z.literal("")),
  fechaVencimiento: z.string().optional().or(z.literal("")),
  fechaEmision: z.string().optional().or(z.literal("")),
  responsableId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewCobro() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const fromCotizacionId = new URLSearchParams(search).get("fromCotizacion");
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

  const { data: cotizacionOrigen } = useGetCotizacion(Number(fromCotizacionId), {
    query: { enabled: !!fromCotizacionId && !isNaN(Number(fromCotizacionId)) },
  });

  const { data: clientes } = useListClientes();
  const { data: miembros } = useListMiembros({
    query: { enabled: puedeAsignar, queryKey: getListMiembrosQueryKey() },
  });
  const miembrosActivos = (miembros?.filter((m) => m.activo) ?? []).filter(
    (m) => !isSupervisor || m.id === user?.id || m.supervisorId === user?.id,
  );

  const planUser = user as (typeof user & { subscriptionStatus?: string; plan?: string }) | null;
  const nextCob = user?.role === "admin" || user?.esDemo || planUser?.subscriptionStatus === "prueba" || planUser?.plan !== "starter";

  // Modos avanzados (colapsados por defecto)
  const [mostrarModoAvanzado, setMostrarModoAvanzado] = useState(false);
  const [modoAvanzado, setModoAvanzado] = useState<"individual" | "masivo" | "recurrente">("individual");
  const [frecuencia, setFrecuencia] = useState("mensual");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaTermino, setFechaTermino] = useState("");
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [clienteDropdownOpen, setClienteDropdownOpen] = useState(false);
  const [busquedaMasiva, setBusquedaMasiva] = useState("");
  const [clienteIdsMasivos, setClienteIdsMasivos] = useState<number[]>([]);
  const [creandoAvanzado, setCreandoAvanzado] = useState(false);
  const advancedAttempt = useRef<{ signature: string; key: string } | null>(null);
  const advancedInFlight = useRef(false);

  const { prefs, listo: prefsListas } = usePreferencias();
  const decimalesEfectivos = decimalesPref(prefs);
  const [lineas, setLineas] = useState<LineaCatalogo[]>([]);
  const totalItems = totalLineas(lineas, decimalesEfectivos);

  const [monedaDoc, setMonedaDoc] = useState<Moneda>("CLP");
  const [ivaDoc, setIvaDoc] = useState("19");
  const prefsAplicadas = useRef(false);
  useEffect(() => {
    if (!prefsListas || prefsAplicadas.current) return;
    prefsAplicadas.current = true;
    setMonedaDoc(prefs.moneda as Moneda);
    setIvaDoc(String(prefs.porcentajeIva));
  }, [prefsListas, prefs]);

  const monedaEfectiva: Moneda = modoAvanzado === "individual" ? monedaDoc : "CLP";
  const ivaPct = modoAvanzado === "individual" ? Math.min(100, Math.max(0, Number(ivaDoc) || 0)) : 19;
  const formatCurrency = (n: number) => formatMoney(n, monedaEfectiva, decimalesEfectivos);
  const simbolo = MONEDA_INFO[monedaEfectiva].simbolo;

  const cambiarMoneda = (m: Moneda) => {
    if (!(MONEDAS as readonly string[]).includes(m)) return;
    if (m === monedaDoc) return;
    if (lineas.length > 0) {
      setLineas([]);
      toast({ title: "Ítems quitados", description: "Los ítems deben tener la misma moneda del documento." });
    }
    setMonedaDoc(m);
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipoDocumento: "sin_documento",
      incluyeIva: false,
      descripcion: "",
      clienteId: undefined,
      emailPagador: "",
      fechaVencimiento: "",
      fechaEmision: hoy(),
      responsableId: undefined,
    },
  });

  // Pre-fill from cotización when fromCotizacion param is present
  const cotizacionAplicada = useRef(false);
  useEffect(() => {
    if (!cotizacionOrigen || cotizacionAplicada.current) return;
    cotizacionAplicada.current = true;
    if (cotizacionOrigen.clienteId) {
      form.setValue("clienteId", cotizacionOrigen.clienteId, { shouldValidate: true });
    }
    if (cotizacionOrigen.clienteEmail) {
      form.setValue("emailPagador", cotizacionOrigen.clienteEmail, { shouldValidate: true });
    }
    if (cotizacionOrigen.fechaVencimiento) {
      form.setValue("fechaVencimiento", cotizacionOrigen.fechaVencimiento.slice(0, 10));
    }
    // Set moneda and IVA from cotización
    if (cotizacionOrigen.moneda) setMonedaDoc(cotizacionOrigen.moneda as Moneda);
    if (cotizacionOrigen.porcentajeIva != null) setIvaDoc(String(cotizacionOrigen.porcentajeIva));
    if (Number(cotizacionOrigen.porcentajeIva) > 0) form.setValue("incluyeIva", true);
    // Pre-fill items from cotización items
    const cotItems = (cotizacionOrigen as unknown as { items?: Array<{ productoId?: number | null; descripcion: string; cantidad: number | string; precioUnitario: number | string }> }).items;
    if (cotItems && cotItems.length > 0) {
      const lineasFromCot: LineaCatalogo[] = cotItems.map((l) => ({
        productoId: l.productoId ?? 0,
        nombre: l.descripcion,
        cantidad: String(l.cantidad),
        precioUnitario: String(l.precioUnitario),
        tipo: "servicio" as const,
        stockActual: null,
      }));
      setLineas(lineasFromCot);
    }
  }, [cotizacionOrigen]);

  const selectedClienteId = form.watch("clienteId");
  const selectedCliente = clientes?.find((c) => c.id === selectedClienteId);
  const tipoDocumentoWatch = form.watch("tipoDocumento");
  const permiteIva = tipoDocumentoPermiteIva(tipoDocumentoWatch);
  const incluyeIvaWatch = form.watch("incluyeIva");

  // Totales — IVA aplica para cualquier tipo de documento cuando el usuario lo activa
  const netoNum = totalItems;
  const ivaNum = incluyeIvaWatch ? roundTo(netoNum * ivaPct / 100, decimalesEfectivos) : 0;
  const totalNum = netoNum + ivaNum;

  useEffect(() => {
    if (selectedCliente?.email) {
      form.setValue("emailPagador", selectedCliente.email, { shouldValidate: true });
    }
    if (selectedCliente) {
      setBusquedaCliente(selectedCliente.nombre ?? "");
    }
  }, [selectedCliente?.id]);

  const onSubmit = async (values: FormValues) => {
    if (advancedInFlight.current || !prefsListas) return;
    if (lineas.length === 0) {
      toast({ title: "Sin productos", description: "Agrega al menos un ítem al documento.", variant: "destructive" });
      return;
    }
    if (!lineasValidas(lineas) || totalItems <= 0) {
      toast({ title: "Revisa los ítems", description: "Cada ítem necesita cantidad mayor a 0 y precio válido.", variant: "destructive" });
      return;
    }

    const itemsInventario = lineasPayload(lineas, decimalesEfectivos);
    const montoFinal = roundTo(totalItems, decimalesEfectivos);
    const descripcion = values.descripcion?.trim()
      || lineas.map((item) => item.nombre).filter(Boolean).join(", ").slice(0, 255)
      || "Venta de productos o servicios";

    const payload: CobroInput = {
      itemsInventario,
      moneda: monedaEfectiva as CobroInput["moneda"],
      decimales: decimalesEfectivos,
      porcentajeIva: ivaPct,
      monto: montoFinal,
      tipoDocumento: values.tipoDocumento,
      incluyeIva: values.incluyeIva,
      descripcion,
      emailPagador: values.emailPagador || selectedCliente?.email || undefined,
      clienteId: values.clienteId || undefined,
      fechaVencimiento: values.fechaVencimiento || undefined,
      responsableId: puedeAsignar ? values.responsableId || undefined : undefined,
      ...(fromCotizacionId ? { cotizacionId: Number(fromCotizacionId) } : {}),
    };

    if (modoAvanzado !== "individual") {
      if (!nextCob) {
        toast({ title: "Disponible en plan NextCob", variant: "destructive" });
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
        const advancedPayload = {
          itemsInventario, moneda: "CLP", decimales: decimalesEfectivos, monto: montoFinal,
          tipoDocumento: values.tipoDocumento, incluyeIva: values.incluyeIva,
          descripcion,
          responsableId: puedeAsignar ? values.responsableId || undefined : undefined,
          automatizacion: "ninguna",
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
          : await createCobrosMasivos.mutateAsync({ data: requestPayload as never })) as { cobro?: { id: number } | null; cobros?: Array<{ id: number }> };
        queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardMetricsQueryKey() });
        toast({
          title: modoAvanzado === "recurrente" ? "Cobro recurrente programado" : "Cobros masivos creados",
          description: modoAvanzado === "recurrente" ? "Cada ciclo tendrá su propio cobro y link de pago." : `${data.cobros?.length ?? 0} cobros generados.`,
        });
        const targetId = data.cobro?.id ?? data.cobros?.[0]?.id;
        setLocation(targetId ? `/cobros/${targetId}` : "/cobros");
      } catch (error) {
        toast({ title: "Error", description: error instanceof Error ? error.message : "No se pudo crear el cobro.", variant: "destructive" });
      } finally {
        advancedInFlight.current = false;
        setCreandoAvanzado(false);
      }
      return;
    }

    createCobro.mutate({ data: payload }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardMetricsQueryKey() });
        toast({ title: "Documento creado", description: "El cobro fue creado exitosamente." });
        setLocation(`/cobros/${data.id}`);
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo crear el cobro.", variant: "destructive" });
      },
    });
  };

  const isPending = createCobro.isPending || creandoAvanzado;

  return (
    <div className="max-w-7xl mx-auto space-y-0 animate-in fade-in duration-300">
      {/* Encabezado de página */}
      <div className="flex items-center gap-3 mb-5">
        <Link href={fromCotizacionId ? `/cotizaciones/${fromCotizacionId}` : "/cobros"} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Volver
        </Link>
        <span className="text-muted-foreground/40">|</span>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Nuevo documento de venta</h1>
        </div>
      </div>

      {cotizacionOrigen && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3 flex items-center gap-3">
          <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <p className="text-sm text-blue-800 dark:text-blue-300">
            Creando cobro desde cotización{" "}
            <span className="font-semibold">{cotizacionOrigen.numeroCotizacion}</span>
            {cotizacionOrigen.clienteNombre && (
              <> · {cotizacionOrigen.clienteNombre}</>
            )}
            . Revisa el tipo de documento tributario antes de crear.
          </p>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-0">

          {/* ── Cabecera del documento ───────────────────────────────────── */}
          <div className="rounded-t-xl border border-border bg-card">
            {/* Fila superior: cliente + datos del documento */}
            <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
              {/* Columna izquierda: cliente */}
              <div className="p-5 space-y-4">
                <FormField
                  control={form.control}
                  name="clienteId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        {modoAvanzado === "recurrente" ? "Cliente *" : "Cliente"}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder="Buscar cliente por nombre o RUT..."
                            className="h-10 text-sm pr-8"
                            value={busquedaCliente}
                            onChange={(e) => {
                              setBusquedaCliente(e.target.value);
                              setClienteDropdownOpen(true);
                              if (!e.target.value) {
                                field.onChange(undefined);
                              }
                            }}
                            onFocus={() => { if (busquedaCliente.trim()) setClienteDropdownOpen(true); }}
                            onBlur={() => setTimeout(() => setClienteDropdownOpen(false), 150)}
                            autoComplete="off"
                          />
                          {busquedaCliente && (
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              onMouseDown={(e) => { e.preventDefault(); setBusquedaCliente(""); field.onChange(undefined); }}
                            >
                              <span className="text-xs">✕</span>
                            </button>
                          )}
                          {clienteDropdownOpen && (
                            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-y-auto">
                              {(() => {
                                const q = busquedaCliente.trim().toLowerCase();
                                const filtrados = (clientes ?? []).filter(c =>
                                  !q || c.nombre.toLowerCase().includes(q) || (c.rut ?? "").toLowerCase().includes(q)
                                );
                                if (filtrados.length === 0) {
                                  return <div className="px-3 py-2 text-sm text-muted-foreground">Sin resultados</div>;
                                }
                                return filtrados.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center justify-between gap-2"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      field.onChange(c.id);
                                      setBusquedaCliente(c.nombre);
                                      setClienteDropdownOpen(false);
                                    }}
                                  >
                                    <span>{c.nombre}</span>
                                    {c.rut && <span className="text-xs text-muted-foreground font-mono shrink-0">{c.rut}</span>}
                                  </button>
                                ));
                              })()}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      {selectedCliente && (
                        <div className="mt-1.5 text-xs text-muted-foreground space-y-0.5">
                          {selectedCliente.email && <p>{selectedCliente.email}</p>}
                          {selectedCliente.telefono && <p>{selectedCliente.telefono}</p>}
                          {(selectedCliente as unknown as { direccion?: string }).direccion && <p>{(selectedCliente as unknown as { direccion?: string }).direccion}</p>}
                          {(selectedCliente as unknown as { giro?: string }).giro && <p className="italic">{(selectedCliente as unknown as { giro?: string }).giro}</p>}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {modoAvanzado !== "masivo" && (
                  <FormField
                    control={form.control}
                    name="emailPagador"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Email del pagador
                        </FormLabel>
                        <FormControl>
                          <Input type="email" placeholder={selectedCliente?.email ?? "pagador@ejemplo.com"} className="h-10 text-sm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {puedeAsignar && miembrosActivos.length > 0 && (
                  <FormField
                    control={form.control}
                    name="responsableId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Ejecutivo responsable
                        </FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(v === "yo" ? undefined : v)}
                          value={field.value ?? "yo"}
                        >
                          <FormControl>
                            <SelectTrigger className="h-10">
                              <SelectValue placeholder="Asignar a..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yo">Yo (asignármelo)</SelectItem>
                            {miembrosActivos.filter((m) => m.id !== user?.id).map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.nombre || m.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {/* Columna derecha: tipo documento + fechas + moneda */}
              <div className="p-5 space-y-4">
                <FormField
                  control={form.control}
                  name="tipoDocumento"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tipo de documento
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Selecciona..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TIPO_DOCUMENTO_GRUPOS.map((grupo) => (
                            <SelectGroup key={grupo.label}>
                              <SelectLabel className="text-xs text-muted-foreground">{grupo.label}</SelectLabel>
                              {grupo.values.map((v) => (
                                <SelectItem key={v} value={v}>{TIPO_DOCUMENTO_LABELS[v]}</SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="fechaEmision"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />Fecha emisión
                        </FormLabel>
                        <FormControl>
                          <Input type="date" className="h-10 text-sm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {modoAvanzado !== "recurrente" && (
                    <FormField
                      control={form.control}
                      name="fechaVencimiento"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />Vencimiento
                          </FormLabel>
                          <FormControl>
                            <Input type="date" className="h-10 text-sm" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                {/* Moneda e IVA */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Moneda</label>
                    <Select value={monedaEfectiva} onValueChange={(v) => cambiarMoneda(v as Moneda)} disabled={modoAvanzado !== "individual"}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONEDAS.map((m) => <SelectItem key={m} value={m}>{m} · {MONEDA_INFO[m].nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">IVA %</label>
                    <Input
                      type="number" min="0" max="100" step="0.01"
                      value={modoAvanzado === "individual" ? ivaDoc : "19"}
                      disabled={modoAvanzado !== "individual"}
                      onChange={(e) => setIvaDoc(e.target.value)}
                      className="h-10 font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <input
                    type="checkbox"
                    id="incluye-iva"
                    checked={incluyeIvaWatch}
                    onChange={(e) => form.setValue("incluyeIva", e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <label htmlFor="incluye-iva" className="text-sm cursor-pointer">
                    Precios incluyen IVA ({ivaPct}%)
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* ── Tabla de ítems ───────────────────────────────────────────── */}
          <div className="border-x border-border">
            <CatalogoLineas
              lineas={lineas}
              onChange={setLineas}
              incluyeIva={!!incluyeIvaWatch}
              moneda={monedaEfectiva}
              decimales={decimalesEfectivos}
              onIvaDetectado={() => {
                form.setValue("incluyeIva", true);
              }}
            />
          </div>

          {/* ── Totales + comentario ─────────────────────────────────────── */}
          <div className="border border-t-0 border-border rounded-b-xl bg-card">
            <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
              {/* Izquierda: comentario y referencia */}
              <div className="p-5 space-y-4">
                <FormField
                  control={form.control}
                  name="descripcion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Descripción / Comentario
                      </FormLabel>
                      <FormControl>
                        <Textarea placeholder="Detalle del cobro, observaciones..." className="resize-none h-20 text-sm" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Derecha: totales */}
              <div className="p-5 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Neto</span>
                    <span className="font-mono">{simbolo} {formatCurrency(netoNum)}</span>
                  </div>
                  {incluyeIvaWatch && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">IVA ({ivaPct}%)</span>
                      <span className="font-mono">{simbolo} {formatCurrency(ivaNum)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-border">
                    <span className="font-semibold">{incluyeIvaWatch ? "Total con IVA" : "Total"}</span>
                    <span className="font-mono font-bold text-lg text-primary">{simbolo} {formatCurrency(totalNum)}</span>
                  </div>
                  {monedaEfectiva !== "CLP" && (
                    <EquivalenciaCLP monto={totalNum} moneda={monedaEfectiva} decimales={decimalesEfectivos} testId="equivalencia-clp-cobro" />
                  )}
                  {(monedaEfectiva !== "CLP" || decimalesEfectivos > 0) && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">Flow y MercadoPago solo cobran CLP sin decimales: no se podrán generar links de pago.</p>
                  )}
                </div>

                {datosBancarios && !datosBancarios.configurado && (
                  <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Para incluir datos de transferencia, configura tu{" "}
                      <Link href="/perfil" className="font-medium underline underline-offset-2">cuenta bancaria →</Link>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Cobros recurrentes / masivos (colapsado) ─────────────────── */}
          <div className="mt-4 rounded-xl border border-border bg-card overflow-hidden">
            <button
              type="button"
              onClick={() => setMostrarModoAvanzado((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                {modoAvanzado !== "individual" && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                    {modoAvanzado === "recurrente" ? "Recurrente" : "Masivo"}
                  </span>
                )}
                Cobro recurrente o masivo
              </span>
              {mostrarModoAvanzado ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>

            {mostrarModoAvanzado && (
              <div className="border-t border-border p-5 space-y-4">
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
                      className={`rounded-lg border p-3 text-left text-sm transition-colors ${modoAvanzado === key ? "border-primary bg-primary/5" : "border-border/50 hover:bg-muted/50"} ${key !== "individual" && !nextCob ? "opacity-60" : ""}`}>
                      <span className="flex items-center gap-1 font-medium">{key !== "individual" && !nextCob && <Lock className="h-3 w-3" />}{label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{key !== "individual" && !nextCob ? "Plan NextCob" : desc}</span>
                    </button>
                  ))}
                </div>

                {modoAvanzado === "recurrente" && (
                  <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
                    <div>
                      <label className="text-xs font-medium">Frecuencia</label>
                      <Select value={frecuencia} onValueChange={setFrecuencia}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[["semanal","Semanal"],["quincenal","Quincenal"],["mensual","Mensual"],["bimestral","Bimestral"],["trimestral","Trimestral"],["anual","Anual"]].map(([v,l]) => (
                            <SelectItem key={v} value={v}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium">Fecha de inicio</label>
                      <Input className="mt-1 h-9" type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Fecha de término (opcional)</label>
                      <Input className="mt-1 h-9" type="date" min={fechaInicio || undefined} value={fechaTermino} onChange={(e) => setFechaTermino(e.target.value)} />
                    </div>
                    <p className="sm:col-span-3 text-xs text-muted-foreground">Cada ciclo genera un cobro independiente con su propio link y seguimiento.</p>
                  </div>
                )}

                {modoAvanzado === "masivo" && (
                  <div className="border-t border-border pt-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Clientes del lote</p>
                      <span className="text-xs text-muted-foreground">{clienteIdsMasivos.length} seleccionados</span>
                    </div>
                    <Input value={busquedaMasiva} onChange={(e) => setBusquedaMasiva(e.target.value)} placeholder="Buscar por nombre o RUT" className="h-9" />
                    <div className="max-h-44 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
                      {(clientes ?? []).filter((c) => `${c.nombre} ${c.rut ?? ""}`.toLowerCase().includes(busquedaMasiva.toLowerCase())).map((c) => (
                        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted text-sm">
                          <input type="checkbox" checked={clienteIdsMasivos.includes(c.id)} onChange={(e) => setClienteIdsMasivos((ids) => e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))} />
                          <span>{c.nombre}</span>
                          {c.rut && <span className="font-mono text-xs text-muted-foreground">{c.rut}</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Acciones ─────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between pt-4">
            <Link href="/cobros" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancelar
            </Link>
            <Button type="submit" disabled={!prefsListas || isPending} size="lg" className="min-w-36">
              {isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creando...</>
              ) : (
                modoAvanzado === "recurrente" ? "Programar cobro" :
                modoAvanzado === "masivo" ? `Crear ${clienteIdsMasivos.length || ""} cobros` :
                "Crear cobro"
              )}
            </Button>
          </div>

        </form>
      </Form>
    </div>
  );
}
