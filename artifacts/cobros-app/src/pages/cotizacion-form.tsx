import { EquivalenciaCLP } from "@/components/equivalencia-clp";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCotizacion,
  useUpdateCotizacion,
  useSendCotizacion,
  useGetCotizacion,
  getGetCotizacionQueryKey,
  useListClientes,
  getListClientesQueryKey,
  useListInventario,
  getListInventarioQueryKey,
  type Cotizacion,
  type CotizacionInput,
  type Producto,
  useGetEmpresa,
  getGetEmpresaQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { usePreferencias, decimalesPref } from "@/hooks/use-preferencias";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoney, roundTo, hoySantiago, monedaDe, MONEDAS, MONEDA_INFO, type Moneda } from "@/lib/format";
import { apiErrorMessage, precioNetoDe } from "@/lib/inventario";
import {
  descargarPdfCotizacion,
  invalidateCotizaciones,
  subtotalLinea,
  totalesCot,
  type LineaCot,
} from "@/lib/cotizaciones";
import { ArrowLeft, Boxes, Download, Loader2, Lock, Mail, MapPin, PenLine, Plus, RotateCw, Save, Search, Trash2 } from "lucide-react";

let keySeq = 0;
/** YYYY-MM-DD + n calendar days (UTC math, no timezone drift). */
const sumarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const nuevaKey = () => `l${Date.now().toString(36)}${(keySeq++).toString(36)}`;

const lineaLibre = (): LineaCot => ({ key: nuevaKey(), productoId: null, descripcion: "", cantidad: "1", precioUnitario: "", descuentoPorcentaje: "0" });

type Accion = "guardar" | "enviar" | "pdf";

export default function CotizacionFormPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : 0;
  const isEdit = !!id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { prefs, listo: prefsListas } = usePreferencias();

  const cotQ = useGetCotizacion(id, {
    query: { enabled: isEdit, queryKey: getGetCotizacionQueryKey(id), staleTime: 0, refetchOnMount: "always" },
  });
  const clientesQ = useListClientes(undefined, { query: { queryKey: getListClientesQueryKey(), staleTime: 0, refetchOnMount: "always" } });
  const productosQ = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });

  const crear = useCreateCotizacion();
  const actualizar = useUpdateCotizacion();
  const enviar = useSendCotizacion();

  const [savedId, setSavedId] = useState<number>(id);
  const [clienteId, setClienteId] = useState<string>("");
  const [fechaEmision, setFechaEmision] = useState(() => hoySantiago());
  const [fechaVencimiento, setFechaVencimiento] = useState(() => hoySantiago(30));
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  // Stored precision of an existing quote; new quotes follow the current preference.
  const [decimalesGuardados, setDecimalesGuardados] = useState<number | null>(null);
  const decimales = isEdit || savedId ? (decimalesGuardados ?? decimalesPref(prefs)) : decimalesPref(prefs);
  const [iva, setIva] = useState("19");
  const [notas, setNotas] = useState("");
  const [clienteGiro, setClienteGiro] = useState("");
  const [formaPago, setFormaPago] = useState("");
  const [tiempoEntrega, setTiempoEntrega] = useState("");
  const [validez, setValidez] = useState("30");
  // Due date follows emission + validity until the user picks a date (edits keep stored dates).
  const [vencManual, setVencManual] = useState(isEdit);
  const empresaQ = useGetEmpresa({ query: { queryKey: getGetEmpresaQueryKey() } });
  const [lineas, setLineas] = useState<LineaCot[]>([lineaLibre()]);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  // New quote: defaults from preferences (applied once, before user edits).
  const prefsAplicadas = useRef(false);
  useEffect(() => {
    if (isEdit || !prefsListas || prefsAplicadas.current) return;
    prefsAplicadas.current = true;
    setMoneda(monedaDe(prefs.moneda));
    setIva(String(prefs.porcentajeIva));
  }, [isEdit, prefsListas, prefs]);

  // New quote: commercial defaults from the company profile (once).
  const empresaAplicada = useRef(false);
  const empresa = empresaQ.data;
  useEffect(() => {
    if (isEdit || !empresa || empresaAplicada.current) return;
    empresaAplicada.current = true;
    setFormaPago((v) => v || empresa.condicionesPago || "");
    setValidez(String(empresa.validezDias || 30));
  }, [isEdit, empresa]);

  const validezN = Number(validez);
  const validezOk = Number.isInteger(validezN) && validezN >= 1 && validezN <= 3650;
  useEffect(() => {
    if (vencManual || !validezOk || !fechaEmision) return;
    setFechaVencimiento(sumarDias(fechaEmision, validezN));
  }, [vencManual, validezOk, validezN, fechaEmision]);

  // Edit: hydrate once per id.
  const initFor = useRef<number | null>(null);
  const cot = cotQ.data;
  useEffect(() => {
    if (!cot || !cotQ.isFetchedAfterMount || initFor.current === cot.id) return;
    initFor.current = cot.id;
    setClienteId(String(cot.clienteId));
    setFechaEmision(cot.fechaEmision.slice(0, 10));
    setFechaVencimiento(cot.fechaVencimiento.slice(0, 10));
    setMoneda(monedaDe(cot.moneda));
    setDecimalesGuardados(cot.decimales ?? 0);
    setIva(String(cot.porcentajeIva));
    setNotas(cot.notas ?? "");
    setClienteGiro(cot.clienteGiro ?? "");
    setFormaPago(cot.formaPago ?? "");
    setTiempoEntrega(cot.tiempoEntrega ?? "");
    setValidez(String(cot.validezDias ?? Math.max(1, diasEntre(cot.fechaEmision.slice(0, 10), cot.fechaVencimiento.slice(0, 10)))));
    setVencManual(true);
    setLineas(
      (cot.items ?? []).map((it) => ({
        key: nuevaKey(),
        productoId: it.productoId ?? null,
        descripcion: it.descripcion,
        cantidad: String(it.cantidad),
        precioUnitario: String(it.precioUnitario),
        descuentoPorcentaje: String(it.descuentoPorcentaje ?? 0),
      })),
    );
  }, [cot, cotQ.isFetchedAfterMount]);

  const clientes = clientesQ.data ?? [];
  const cliente = clientes.find((c) => String(c.id) === clienteId) as (typeof clientes)[number] & { direccion?: string | null } | undefined;
  const ivaPct = Math.min(100, Math.max(0, Number(iva) || 0));
  // Existing quotes keep stored unit prices untouched (no-op edits stay no-op).
  const redondearPrecio = !isEdit;
  const tot = totalesCot(lineas, decimales, ivaPct, redondearPrecio);
  const fmt = (n: number) => formatMoney(n, moneda, decimales);

  const productosMoneda = useMemo(() => {
    const s = busqueda.trim().toLowerCase();
    if (!s) return [];
    return (productosQ.data ?? [])
      .filter((p) => p.activo && monedaDe(p.moneda) === moneda)
      .filter((p) => `${p.nombre} ${p.codigoInterno ?? ""} ${p.sku ?? ""}`.toLowerCase().includes(s))
      .slice(0, 50);
  }, [productosQ.data, moneda, busqueda]);
  const otrosMoneda = (productosQ.data ?? []).filter((p) => p.activo && monedaDe(p.moneda) !== moneda).length;

  const update = (key: string, patch: Partial<LineaCot>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const agregarProducto = (p: Producto) => {
    setLineas((ls) => {
      const base = ls.length === 1 && !ls[0].descripcion.trim() && !ls[0].precioUnitario ? [] : ls;
      return [...base, { key: nuevaKey(), productoId: p.id, descripcion: p.nombre, cantidad: "1", precioUnitario: String(roundTo(precioNetoDe(p) || 0, decimales)), descuentoPorcentaje: "0" }];
    });
    setPickerOpen(false);
    setBusqueda("");
  };

  const cambiarMoneda = (m: Moneda) => {
    if (m === moneda) return;
    const conCatalogo = lineas.some((l) => l.productoId != null);
    if (conCatalogo) {
      setLineas((ls) => {
        const libres = ls.filter((l) => l.productoId == null);
        return libres.length ? libres : [lineaLibre()];
      });
      toast({ title: "Ítems del catálogo quitados", description: "Solo se pueden usar productos con precio en la moneda del documento." });
    }
    setMoneda(m);
  };

  const validar = (): CotizacionInput | null => {
    if (!isEdit && !savedId && !prefsListas) { toast({ title: "Cargando preferencias", description: "Intenta nuevamente en un momento." }); return null; }
    if (!clienteId) { toast({ title: "Elige un cliente", variant: "destructive" }); return null; }
    if (!fechaEmision || !fechaVencimiento) { toast({ title: "Completa las fechas", variant: "destructive" }); return null; }
    if (fechaVencimiento < fechaEmision) { toast({ title: "Fechas inválidas", description: "El vencimiento no puede ser anterior a la emisión.", variant: "destructive" }); return null; }
    const utiles = lineas.filter((l) => l.descripcion.trim() || l.precioUnitario.trim());
    if (utiles.length === 0) { toast({ title: "Agrega al menos un ítem", variant: "destructive" }); return null; }
    for (const l of utiles) {
      if (!l.descripcion.trim()) { toast({ title: "Falta la descripción de un ítem", variant: "destructive" }); return null; }
      if (!(Number(l.cantidad) > 0)) { toast({ title: "Cantidad inválida", description: `"${l.descripcion}" necesita cantidad mayor a 0.`, variant: "destructive" }); return null; }
      if (l.precioUnitario.trim() === "" || Number(l.precioUnitario) < 0) { toast({ title: "Precio inválido", description: `Revisa el precio de "${l.descripcion}".`, variant: "destructive" }); return null; }
      const d = Number(l.descuentoPorcentaje) || 0;
      if (d < 0 || d > 100) { toast({ title: "Descuento inválido", description: "Usa un porcentaje entre 0 y 100.", variant: "destructive" }); return null; }
    }
    if (!validezOk) { toast({ title: "Validez inválida", description: "Usa entre 1 y 3650 días.", variant: "destructive" }); return null; }
    if (utiles.length > 100) { toast({ title: "Máximo 100 ítems", variant: "destructive" }); return null; }
    return {
      clienteId: Number(clienteId),
      fechaEmision,
      fechaVencimiento,
      moneda,
      decimales,
      porcentajeIva: ivaPct,
      notas: notas.trim(),
      clienteGiro: clienteGiro.trim(),
      formaPago: formaPago.trim(),
      tiempoEntrega: tiempoEntrega.trim(),
      validezDias: validezN,
      items: utiles.map((l) => ({
        productoId: l.productoId,
        descripcion: l.descripcion.trim(),
        cantidad: Number(l.cantidad),
        precioUnitario: redondearPrecio ? roundTo(Number(l.precioUnitario), decimales) : Number(l.precioUnitario),
        descuentoPorcentaje: Number(l.descuentoPorcentaje) || 0,
      })),
    };
  };

  // Always persist the draft first; Send/PDF only act on a saved document.
  const guardar = async (data: CotizacionInput): Promise<Cotizacion> => {
    const res = savedId
      ? await actualizar.mutateAsync({ id: savedId, data })
      : await crear.mutateAsync({ data });
    setSavedId(res.id);
    setDecimalesGuardados(res.decimales ?? 0);
    qc.setQueryData(getGetCotizacionQueryKey(res.id), res);
    invalidateCotizaciones(qc, res.id);
    return res;
  };

  const ejecutar = async (a: Accion) => {
    const data = validar();
    if (!data || accion) return;
    setAccion(a);
    let guardada: Cotizacion | null = null;
    try {
      guardada = await guardar(data);
    } catch (err) {
      toast({ title: "No se pudo guardar", description: apiErrorMessage(err, "Revisa los datos e intenta nuevamente."), variant: "destructive" });
      setAccion(null);
      return;
    }
    try {
      if (a === "guardar") {
        toast({ title: "Borrador guardado", description: guardada.numeroCotizacion });
        navigate(`/cotizaciones/${guardada.id}`);
      } else if (a === "enviar") {
        if (!guardada.clienteEmail) {
          toast({ title: "Borrador guardado, sin enviar", description: "El cliente no tiene email. Agrégalo en su ficha para enviar la cotización.", variant: "destructive" });
          navigate(`/cotizaciones/${guardada.id}`);
          return;
        }
        const enviada = await enviar.mutateAsync({ id: guardada.id });
        qc.setQueryData(getGetCotizacionQueryKey(enviada.id), enviada);
        invalidateCotizaciones(qc, enviada.id);
        toast({ title: "Cotización enviada", description: `${enviada.numeroCotizacion} enviada a ${enviada.clienteEmail ?? "el cliente"}.` });
        navigate(`/cotizaciones/${enviada.id}`);
      } else {
        await descargarPdfCotizacion(guardada);
        toast({ title: "Borrador guardado y PDF descargado" });
        if (!isEdit) navigate(`/cotizaciones/${guardada.id}/editar`, { replace: true });
      }
    } catch (err) {
      toast({
        title: a === "enviar" ? "No se pudo enviar" : "No se pudo generar el PDF",
        description: apiErrorMessage(err, a === "enviar" ? "El borrador quedó guardado. Intenta enviar nuevamente." : "El borrador quedó guardado. Intenta nuevamente."),
        variant: "destructive",
      });
      if (!isEdit && a === "enviar") navigate(`/cotizaciones/${guardada.id}`);
    } finally {
      setAccion(null);
    }
  };

  if (isEdit && (cotQ.isLoading || (!cotQ.isFetchedAfterMount && !cotQ.isError))) {
    return (
      <div className="max-w-7xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="h-96 bg-muted/60 rounded-xl" />
          <div className="h-64 bg-muted/60 rounded-xl" />
        </div>
      </div>
    );
  }
  if (isEdit && (cotQ.isError || !cot)) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos esta cotización.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => cotQ.refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/cotizaciones">Volver</Link></Button>
        </div>
      </div>
    );
  }
  if (isEdit && cot && cot.estado !== "borrador") {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="font-medium">{cot.numeroCotizacion} ya no es un borrador.</p>
        <p className="text-sm text-muted-foreground">Solo las cotizaciones en borrador se pueden editar.</p>
        <Button asChild size="sm"><Link href={`/cotizaciones/${cot.id}`}>Ver cotización</Link></Button>
      </div>
    );
  }

  const ocupado = accion !== null;

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href={isEdit ? `/cotizaciones/${id}` : "/cotizaciones"} className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />{isEdit ? "Volver a la cotización" : "Volver a cotizaciones"}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{isEdit ? cot?.numeroCotizacion : "Borrador"}</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{isEdit ? "Editar cotización" : "Nueva cotización"}</h1>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
        <div className="space-y-5 min-w-0">
          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Cliente y fechas</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <Select value={clienteId} onValueChange={(v) => {
                  setClienteId(v);
                  const sel = clientes.find((c) => String(c.id) === v) as { giro?: string | null } | undefined;
                  setClienteGiro(sel?.giro ?? "");
                }}>
                  <SelectTrigger data-testid="select-cliente-cotizacion"><SelectValue placeholder={clientesQ.isLoading ? "Cargando clientes..." : "Selecciona un cliente"} /></SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nombre}{c.rut ? ` · ${c.rut}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {clientesQ.isError && <p className="text-xs text-red-600">No se pudieron cargar los clientes. <button type="button" className="underline" onClick={() => clientesQ.refetch()}>Reintentar</button></p>}
                {!clientesQ.isLoading && clientes.length === 0 && <p className="text-xs text-muted-foreground">No tienes clientes. <Link href="/clientes" className="text-primary underline">Crear cliente</Link></p>}
              </div>
              {cliente && (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 grid gap-1.5 sm:grid-cols-2 text-sm" data-testid="card-cliente-datos">
                  <div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">Razón social</p><p className="font-medium">{cliente.empresa || cliente.nombre}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">RUT</p><p className="font-mono">{cliente.rut || "Sin RUT"}</p></div>
                  <div className="flex items-start gap-1.5"><Mail className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" /><span className={cliente.email ? "" : "text-amber-700"}>{cliente.email || "Sin email: no podrás enviarla"}</span></div>
                  <div className="flex items-start gap-1.5"><MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" /><span className={cliente.direccion ? "" : "text-muted-foreground"}>{cliente.direccion || "Sin dirección registrada"}</span></div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Fecha de emisión</Label><Input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} data-testid="input-fecha-emision" /></div>
                <div className="space-y-1.5">
                  <Label className="flex items-center justify-between">Válida hasta
                    {vencManual && validezOk && <button type="button" className="text-[11px] font-normal text-primary hover:underline" onClick={() => setVencManual(false)} data-testid="button-recalcular-vencimiento">Recalcular con validez</button>}
                  </Label>
                  <Input type="date" min={fechaEmision} value={fechaVencimiento} onChange={(e) => {
                    const v = e.target.value;
                    setFechaVencimiento(v);
                    setVencManual(true);
                    const d = v && fechaEmision ? diasEntre(fechaEmision, v) : 0;
                    if (d >= 1 && d <= 3650) setValidez(String(d));
                  }} data-testid="input-fecha-vencimiento" />
                  {!vencManual && <p className="text-[11px] text-muted-foreground">Emisión + {validezOk ? validezN : "?"} días de validez.</p>}
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Giro del cliente <span className="text-muted-foreground font-normal">(aparece en el PDF)</span></Label>
                  <Input value={clienteGiro} maxLength={300} onChange={(e) => setClienteGiro(e.target.value)} placeholder="Ej: Construcción de obras civiles" data-testid="input-cliente-giro" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Ítems</CardTitle>
              <div className="flex gap-2">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={lineas.length >= 100} data-testid="button-agregar-catalogo"><Boxes className="h-3.5 w-3.5 mr-1.5" />Desde catálogo</Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-2">
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={`Buscar ítems en ${moneda}`} className="pl-8 h-9" />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {productosQ.isLoading ? (
                        <div className="space-y-1.5 p-1">{[1, 2, 3].map((i) => <div key={i} className="h-9 rounded bg-muted animate-pulse" />)}</div>
                      ) : productosQ.isError ? (
                        <div className="p-3 text-center text-sm">No se pudo cargar el catálogo. <button type="button" className="text-primary underline" onClick={() => productosQ.refetch()}>Reintentar</button></div>
                      ) : productosMoneda.length === 0 ? (
                        <p className="p-3 text-center text-sm text-muted-foreground">
                          {!busqueda.trim() ? "Escribe para buscar por nombre, SKU o código." : otrosMoneda > 0 ? `No hay ítems con precio en ${moneda}. Usa una línea libre.` : "Sin coincidencias."}
                        </p>
                      ) : productosMoneda.map((p) => (
                        <button key={p.id} type="button" onClick={() => agregarProducto(p)} className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted" data-testid={`option-producto-${p.id}`}>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{p.nombre}</span>
                            <span className="text-[11px] text-muted-foreground">{p.tipo === "servicio" ? "Servicio" : "Producto"}{p.codigoInterno ? ` · ${p.codigoInterno}` : ""}</span>
                          </span>
                          <span className="shrink-0 text-right"><span className="block font-mono text-xs">{formatMoney(precioNetoDe(p), p.moneda, decimalesPref(prefs))}</span><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">neto unit.</span></span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button type="button" variant="outline" size="sm" onClick={() => setLineas((ls) => [...ls, lineaLibre()])} disabled={lineas.length >= 100} data-testid="button-agregar-linea-libre"><PenLine className="h-3.5 w-3.5 mr-1.5" />Línea libre</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="hidden md:grid grid-cols-[1fr_76px_120px_70px_110px_32px] gap-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span>Descripción</span><span>Cant.</span><span>Precio unit. neto</span><span>Desc. %</span><span className="text-right">Subtotal</span><span />
              </div>
              {lineas.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Sin ítems. Agrega desde el catálogo o con una línea libre.</div>
              )}
              {lineas.map((l, i) => (
                <div key={l.key} className="grid grid-cols-2 md:grid-cols-[1fr_76px_120px_70px_110px_32px] gap-2 items-center rounded-md bg-muted/30 p-2" data-testid={`row-item-${i}`}>
                  <div className="col-span-2 md:col-span-1 min-w-0">
                    <Input value={l.descripcion} maxLength={1000} onChange={(e) => update(l.key, { descripcion: e.target.value })} placeholder="Descripción del ítem" className="h-8" data-testid={`input-item-descripcion-${i}`} />
                    {l.productoId != null && <p className="mt-0.5 text-[10px] text-primary flex items-center gap-1"><Boxes className="h-2.5 w-2.5" />Del catálogo</p>}
                  </div>
                  <Input type="number" min="0" step="any" value={l.cantidad} onChange={(e) => update(l.key, { cantidad: e.target.value })} className="h-8 font-mono" aria-label="Cantidad" data-testid={`input-item-cantidad-${i}`} />
                  <Input type="number" min="0" step={decimales ? String(10 ** -decimales) : "1"} value={l.precioUnitario} onChange={(e) => update(l.key, { precioUnitario: e.target.value })} className="h-8 font-mono" placeholder="0" aria-label="Precio unitario" data-testid={`input-item-precio-${i}`} />
                  <Input type="number" min="0" max="100" step="any" value={l.descuentoPorcentaje} onChange={(e) => update(l.key, { descuentoPorcentaje: e.target.value })} className="h-8 font-mono" aria-label="Descuento %" data-testid={`input-item-descuento-${i}`} />
                  <span className="font-mono text-sm text-right tabular-nums">{fmt(subtotalLinea(l, decimales, redondearPrecio))}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 justify-self-end text-muted-foreground hover:text-red-600" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Quitar ítem" data-testid={`button-quitar-item-${i}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <button type="button" onClick={() => setLineas((ls) => [...ls, lineaLibre()])} disabled={lineas.length >= 100} className="w-full rounded-md border border-dashed py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                <Plus className="inline h-3 w-3 mr-1" />Agregar línea
              </button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Condiciones comerciales</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Forma de pago</Label>
                <Textarea value={formaPago} maxLength={2000} onChange={(e) => setFormaPago(e.target.value)} placeholder="50% anticipo, 50% contra entrega" className="resize-none h-16" data-testid="input-forma-pago" />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
                <div className="space-y-1.5">
                  <Label>Tiempo de entrega</Label>
                  <Input value={tiempoEntrega} maxLength={1000} onChange={(e) => setTiempoEntrega(e.target.value)} placeholder="10 días hábiles desde la aceptación" data-testid="input-tiempo-entrega" />
                </div>
                <div className="space-y-1.5">
                  <Label>Validez</Label>
                  <div className="relative">
                    <Input type="number" min={1} max={3650} value={validez} onChange={(e) => setValidez(e.target.value)} className="font-mono pr-12" data-testid="input-validez-dias" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">días</span>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notas</Label>
                <Textarea value={notas} maxLength={5000} onChange={(e) => setNotas(e.target.value)} placeholder="Garantías, alcances, exclusiones..." className="resize-none h-24" data-testid="input-notas" />
              </div>
              <p className="text-[11px] text-muted-foreground">Estas condiciones aparecen al pie del PDF.</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Moneda e impuestos</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className={`grid gap-3 ${isEdit ? "grid-cols-2" : "grid-cols-1"}`}>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs">Moneda{isEdit && <Lock className="h-3 w-3 text-muted-foreground" />}</Label>
                  <Select value={moneda} onValueChange={(v) => cambiarMoneda(v as Moneda)} disabled={isEdit}>
                    <SelectTrigger data-testid="select-moneda-cotizacion"><SelectValue /></SelectTrigger>
                    <SelectContent>{MONEDAS.map((m) => <SelectItem key={m} value={m}>{m} · {MONEDA_INFO[m].simbolo}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {isEdit && <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs">Decimales<Lock className="h-3 w-3 text-muted-foreground" /></Label>
                  <p className="h-10 flex items-center rounded-md border bg-muted/30 px-3 font-mono text-sm" data-testid="text-decimales-cotizacion">{decimales}</p>
                </div>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">IVA %</Label>
                <Input type="number" min="0" max="100" step="0.01" value={iva} onChange={(e) => setIva(e.target.value)} className="font-mono" data-testid="input-iva-cotizacion" />
              </div>
              <p className="text-[11px] text-muted-foreground">{isEdit ? "La moneda y los decimales quedan fijos una vez creada la cotización." : "Valores por defecto según tus preferencias. Los decimales se definen en Configuración."}</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm overflow-hidden border-primary/20">
            <div className="bg-primary/5 p-5 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono tabular-nums" data-testid="text-subtotal">{fmt(tot.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IVA ({ivaPct}%)</span><span className="font-mono tabular-nums" data-testid="text-iva">{fmt(tot.iva)}</span></div>
              <div className="flex items-baseline justify-between border-t border-primary/20 pt-3 mt-1">
                <span className="font-semibold">Total</span>
                <span className="font-mono text-2xl font-bold text-primary tabular-nums" data-testid="text-total">{fmt(tot.total)}</span>
              </div>
              {moneda !== "CLP" && <EquivalenciaCLP monto={tot.total} moneda={moneda} decimales={decimales} compact testId="equivalencia-clp-cotizacion" />}
            </div>
            <div className="p-4 space-y-2 border-t">
              <Button className="w-full" onClick={() => ejecutar("guardar")} disabled={ocupado || (!isEdit && !savedId && !prefsListas)} data-testid="button-guardar-borrador">
                {accion === "guardar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Guardar borrador
              </Button>
              <Button className="w-full" variant="outline" onClick={() => ejecutar("enviar")} disabled={ocupado || (!isEdit && !savedId && !prefsListas)} data-testid="button-enviar-cotizacion">
                {accion === "enviar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}Guardar y enviar al cliente
              </Button>
              <Button className="w-full" variant="ghost" onClick={() => ejecutar("pdf")} disabled={ocupado || (!isEdit && !savedId && !prefsListas)} data-testid="button-descargar-pdf">
                {accion === "pdf" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}Guardar y descargar PDF
              </Button>
              <p className="text-[11px] text-muted-foreground text-center pt-1">Enviar y PDF guardan el borrador primero.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
