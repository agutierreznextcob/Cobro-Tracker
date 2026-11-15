import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProducto,
  useUpdateProducto,
  useGetProducto,
  useDeleteProducto,
  getGetProductoQueryKey,
  useListBodegas,
  getListBodegasQueryKey,
  type ProductoInput,
  type Producto,
} from "@workspace/api-client-react";
import { HistorialCostos } from "@/components/historial-costos";
import { errorStatus } from "@/lib/compras";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, monedaDe, roundTo, MONEDAS, MONEDA_INFO, type Moneda } from "@/lib/format";
import { usePreferencias, decimalesPref } from "@/hooks/use-preferencias";
import {
  apiErrorMessage,
  capitalizar,
  desgloseIva,
  netoDesde,
  redondear,
  CODIGO_RE,
  etiquetaUbicacion,
  unidadesPara,
  formatPct,
  formatQty,
  invalidateInventario,
  precioSugerido,
  utilidadDe,
  type MetodoCalculo,
} from "@/lib/inventario";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, ChevronDown, ChevronUp, Loader2, Lock, Package, Receipt, RotateCw, Tag, Trash2, Warehouse, Wrench } from "lucide-react";

type Tipo = "producto" | "servicio";
type Fuente = "manual" | "calculado" | "pvp";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

// Tasas IVA chilenas estándar
const TASAS_IVA = [
  { value: "19", label: "19% — General" },
  { value: "15", label: "15% — Combustibles (Ley 18.502)" },
  { value: "10", label: "10% — Alcohol y licores" },
  { value: "0", label: "0% — Exento" },
  { value: "otro", label: "Otro..." },
] as const;

export default function InventarioFormPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : 0;
  const isEdit = !!id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createProducto = useCreateProducto();
  const updateProducto = useUpdateProducto();
  const deleteProducto = useDeleteProducto();
  const [confirmEliminar, setConfirmEliminar] = useState(false);
  const { data: producto, isLoading, isError, isFetchedAfterMount, refetch } = useGetProducto(id, {
    query: { enabled: isEdit, queryKey: getGetProductoQueryKey(id), staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true },
  });

  const bodegasQ = useListBodegas({ query: { queryKey: getListBodegasQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const bodegas = bodegasQ.data ?? [];
  const hayBodegas = bodegas.length > 0;

  const [tipo, setTipo] = useState<Tipo>("producto");
  const [codigoInterno, setCodigoInterno] = useState("");
  const [sku, setSku] = useState("");
  const [codigoBarras, setCodigoBarras] = useState(() => (isEdit ? "" : new URLSearchParams(window.location.search).get("codigoBarras") ?? ""));
  const [bodegaId, setBodegaId] = useState("");
  const [unidadLegacy, setUnidadLegacy] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [unidad, setUnidad] = useState("unidad");
  const [activo, setActivo] = useState(true);
  const [costo, setCosto] = useState("");
  const [metodo, setMetodo] = useState<MetodoCalculo>("margen");
  const [pct, setPct] = useState("30");
  const [precio, setPrecio] = useState("");
  const [fuente, setFuente] = useState<Fuente>(isEdit ? "manual" : "calculado");
  const setPrecioManual = (b: boolean) => setFuente(b ? "manual" : "calculado");
  const [incluyeIva, setIncluyeIva] = useState(false);
  // tasaIvaSelect: one of the preset keys or "otro"
  const [tasaIvaSelect, setTasaIvaSelect] = useState("19");
  const [tasaIvaOtro, setTasaIvaOtro] = useState(""); // only used when tasaIvaSelect === "otro"
  const tasaIva = tasaIvaSelect === "otro" ? tasaIvaOtro : tasaIvaSelect;
  const [pvp, setPvp] = useState("");
  const [pvpIncluyeIva, setPvpIncluyeIva] = useState(true);
  const [pvpExpanded, setPvpExpanded] = useState(false);
  const tokenRef = useRef<string | undefined>(undefined);
  const tocado = useRef(false);
  const [conflicto, setConflicto] = useState(false);
  const [cambioExterno, setCambioExterno] = useState<Producto | null>(null);
  const [stockInicial, setStockInicial] = useState("0");
  const [stockCritico, setStockCritico] = useState("0");
  const [tarifa, setTarifa] = useState("");
  const [horas, setHoras] = useState("");
  const [factor, setFactor] = useState(1);
  const [baseServicioTocada, setBaseServicioTocada] = useState(!isEdit);
  const [costoServicioCargado, setCostoServicioCargado] = useState(0);

  const { prefs, listo: prefsListas } = usePreferencias();
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const monedaTocada = useRef(false);
  useEffect(() => {
    if (!isEdit && prefsListas && !monedaTocada.current) setMoneda(monedaDe(prefs.moneda));
  }, [isEdit, prefsListas, prefs.moneda]);
  useEffect(() => {
    if (!isEdit && prefsListas && !tocado.current) {
      const pref = String(prefs.porcentajeIva ?? 19);
      const preset = TASAS_IVA.find((t) => t.value === pref && t.value !== "otro");
      if (preset) { setTasaIvaSelect(pref); }
      else { setTasaIvaSelect("otro"); setTasaIvaOtro(pref); }
    }
  }, [isEdit, prefsListas, prefs.porcentajeIva]);

  const dec = decimalesPref(prefs);
  const formatCurrency = (n: number) => formatMoney(n, moneda, dec);

  const initFor = useRef<number | null>(null);
  const aplicar = (p: Producto) => {
    initFor.current = p.id;
    tokenRef.current = p.actualizadoEn;
    tocado.current = false;
    setConflicto(false);
    setCambioExterno(null);
    setTipo(p.tipo as Tipo);
    setMoneda(monedaDe(p.moneda));
    setNombre(p.nombre);
    setDescripcion(p.descripcion ?? "");
    const u = p.unidadMedida || (p.tipo === "servicio" ? "hora" : "unidad");
    setUnidad(u);
    setUnidadLegacy(unidadesPara(p.tipo as Tipo).includes(u) ? null : u);
    setCodigoInterno(p.codigoInterno ?? "");
    setSku(p.sku ?? "");
    setCodigoBarras(p.codigoBarras ?? "");
    setActivo(p.activo);
    setCosto(String(p.costoUnitario ?? 0));
    setMetodo((p.metodoCalculo as MetodoCalculo) ?? "margen");
    setPct(p.margenPorcentaje != null ? String(p.margenPorcentaje) : "30");
    setPrecio(String(p.precioUnitario));
    setFuente("manual");
    setIncluyeIva(!!p.incluyeIvaPrecio);
    const tasa = String(p.porcentajeIvaPrecio ?? prefs.porcentajeIva ?? 19);
    const preset = TASAS_IVA.find((t) => t.value === tasa && t.value !== "otro");
    if (preset) { setTasaIvaSelect(tasa); }
    else { setTasaIvaSelect("otro"); setTasaIvaOtro(tasa); }
    setPvp(p.pvpProveedor != null ? String(p.pvpProveedor) : "");
    setPvpIncluyeIva(p.pvpIncluyeIva ?? true);
    setPvpExpanded(p.pvpProveedor != null && p.pvpProveedor > 0);
    setStockCritico(String(p.stockCritico ?? 0));
    setTarifa(p.tarifaHora != null ? String(p.tarifaHora) : "");
    setHoras(p.tiempoEstimadoHoras != null ? String(p.tiempoEstimadoHoras) : "");
    setFactor(p.factorFactibilidad ?? 1);
    setCostoServicioCargado(p.costoUnitario ?? 0);
    setBaseServicioTocada(false);
  };
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;
  useEffect(() => {
    if (!producto || !isFetchedAfterMount) return;
    if (initFor.current !== producto.id) { aplicarRef.current(producto); return; }
    if (producto.actualizadoEn && producto.actualizadoEn !== tokenRef.current) {
      if (!tocado.current) aplicarRef.current(producto);
      else setCambioExterno(producto);
    }
  }, [producto, isFetchedAfterMount]);

  const costoN = tipo === "servicio"
    ? (isEdit && !baseServicioTocada ? costoServicioCargado : roundTo(roundTo(num(tarifa), dec) * num(horas), dec))
    : roundTo(num(costo), dec);
  const pctN = num(pct);
  const tasaN = num(tasaIva);
  const tasa = Number.isFinite(tasaN) && tasaN >= 0 && tasaN <= 100 ? tasaN : 0;
  const tasaInvalida = incluyeIva && !(Number.isFinite(tasaN) && tasaN >= 0 && tasaN <= 100);
  const netoSug = tipo === "producto"
    ? precioSugerido(Number.isNaN(costoN) ? 0 : costoN, pctN, metodo, dec)
    : (Number.isFinite(costoN) ? redondear(costoN * factor, dec) : 0);
  const desg = netoSug != null ? desgloseIva(netoSug, tasa, incluyeIva, dec) : null;
  const sugerido = desg ? desg.final : null;

  // PVP analysis
  const pvpN = num(pvp);
  const hayPvp = tipo === "producto" && Number.isFinite(pvpN) && pvpN > 0;
  const pvpNetoExacto = hayPvp ? netoDesde(pvpN, tasa, pvpIncluyeIva) : 0;
  const pvpFinalAceptado = hayPvp ? (pvpIncluyeIva ? redondear(pvpN, dec) : desgloseIva(pvpN, tasa, incluyeIva, dec).final) : 0;
  const c0 = Number.isNaN(costoN) ? 0 : costoN;
  const pvpMargen = hayPvp && pvpNetoExacto > 0 ? ((pvpNetoExacto - c0) / pvpNetoExacto) * 100 : 0;
  const pvpUtilidad = hayPvp ? pvpNetoExacto - c0 : 0;

  useEffect(() => {
    if (fuente === "calculado" && sugerido != null) setPrecio(String(sugerido));
    if (fuente === "pvp" && hayPvp) setPrecio(String(pvpFinalAceptado));
  }, [sugerido, fuente, pvpFinalAceptado, hayPvp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fuente === "pvp" && !hayPvp) setFuente("calculado"); }, [fuente, hayPvp]);

  const cambioIva = () => {
    if (fuente === "pvp" && !pvpIncluyeIva) return;
    if (isEdit || fuente !== "manual") setFuente("calculado");
  };

  const precioN = num(precio);
  const precioFinalR = Number.isNaN(precioN) ? 0 : roundTo(precioN, dec);
  const precioNeto = netoDesde(precioFinalR, tasa, incluyeIva);
  const real = utilidadDe(c0, precioNeto);
  const pctInvalido = tipo === "producto" && metodo === "margen" && pctN >= 100;
  const difiere = sugerido != null && !Number.isNaN(precioN) && roundTo(precioN, dec) !== sugerido;

  const recargarCosto = async (descartar: boolean) => {
    const r = await refetch();
    const p = r.data;
    if (!p) { toast({ title: "No se pudo recargar", variant: "destructive" }); return; }
    if (descartar) { aplicar(p); return; }
    tokenRef.current = p.actualizadoEn;
    setCosto(String(p.costoUnitario ?? 0));
    setConflicto(false);
    setCambioExterno(null);
  };
  const ultimo = cambioExterno ?? (conflicto ? producto ?? null : null);
  const pending = createProducto.isPending || updateProducto.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefsListas) { toast({ title: "Cargando preferencias", description: "Espera un momento e intenta nuevamente.", variant: "destructive" }); return; }
    if (!nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return; }
    if (Number.isNaN(costoN) || costoN < 0) { toast({ title: "Costo inválido", description: "Ingresa un costo de 0 o más.", variant: "destructive" }); return; }
    if (Number.isNaN(precioN) || precioN < 0) { toast({ title: "Precio inválido", variant: "destructive" }); return; }
    if (pctInvalido) { toast({ title: "Margen inválido", description: "El margen debe ser menor a 100%.", variant: "destructive" }); return; }
    if (tasaInvalida) { toast({ title: "IVA inválido", description: "Usa un porcentaje entre 0 y 100.", variant: "destructive" }); return; }
    if (pvp.trim() !== "" && (!Number.isFinite(pvpN) || pvpN < 0)) { toast({ title: "PVP inválido", description: "Ingresa un monto de 0 o más, o déjalo vacío.", variant: "destructive" }); return; }
    if (tipo === "servicio" && (factor < 1 || factor > 2)) { toast({ title: "Factor fuera de rango", variant: "destructive" }); return; }
    if (codigoInterno.trim() && !CODIGO_RE.test(codigoInterno.trim())) { toast({ title: "Código interno inválido", description: "Usa solo letras, números y guiones.", variant: "destructive" }); return; }
    if (isEdit && !codigoInterno.trim()) { toast({ title: "Falta el código interno", variant: "destructive" }); return; }
    if (!isEdit && tipo === "producto" && hayBodegas && !bodegaId) { toast({ title: "Elige una bodega", description: "Indica dónde queda el stock inicial.", variant: "destructive" }); return; }

    const data: ProductoInput = {
      codigoInterno: codigoInterno.trim() || undefined,
      sku: sku.trim(),
      codigoBarras: codigoBarras.trim(),
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || undefined,
      tipo,
      costoUnitario: costoN,
      precioUnitario: roundTo(precioN, dec),
      unidadMedida: unidad.trim() || undefined,
      activo,
      incluyeIvaPrecio: incluyeIva,
      porcentajeIvaPrecio: tasa,
      pvpProveedor: hayPvp ? pvpN : (tipo === "producto" && pvp.trim() !== "" && pvpN === 0 ? 0 : null),
      pvpIncluyeIva,
      fuentePrecio: fuente,
    };
    if (isEdit && tokenRef.current) data.actualizadoEn = tokenRef.current;
    if (!isEdit) data.moneda = moneda as ProductoInput["moneda"];
    if (tipo === "producto") {
      data.metodoCalculo = metodo;
      data.margenPorcentaje = Number.isNaN(pctN) ? undefined : pctN;
      if (!(isEdit && hayBodegas)) data.stockCritico = Math.max(0, num(stockCritico) || 0);
      if (!isEdit && hayBodegas) data.bodegaId = Number(bodegaId);
      if (!isEdit) data.stockActual = Math.max(0, num(stockInicial) || 0);
    } else {
      data.tarifaHora = Number.isNaN(num(tarifa)) ? null : roundTo(num(tarifa), dec);
      data.tiempoEstimadoHoras = Number.isNaN(num(horas)) ? null : num(horas);
      data.factorFactibilidad = factor;
      if (!isEdit) data.stockActual = null;
    }

    const onError = (err: unknown) => {
      if (isEdit && errorStatus(err) === 409) { setConflicto(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      toast({ title: "No se pudo guardar", description: apiErrorMessage(err, "Revisa los datos e intenta nuevamente."), variant: "destructive" });
    };
    if (isEdit) {
      updateProducto.mutate({ id, data }, {
        onSuccess: () => { invalidateInventario(qc, id); toast({ title: "Cambios guardados" }); setLocation("/inventario"); },
        onError,
      });
    } else {
      createProducto.mutate({ data }, {
        onSuccess: (p) => { invalidateInventario(qc, p.id); toast({ title: tipo === "producto" ? "Producto creado" : "Servicio creado" }); setLocation("/inventario"); },
        onError,
      });
    }
  };

  if (isEdit && (isLoading || (!isFetchedAfterMount && !isError))) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 w-40 bg-muted rounded" />
        <div className="h-72 bg-muted/60 rounded-xl" />
      </div>
    );
  }
  if (isEdit && (isError || !producto)) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos este ítem del inventario.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/inventario">Volver</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/inventario" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />Volver al inventario
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{isEdit ? `Editar ${tipo}` : "Nuevo ítem"}</h1>
          <p className="text-muted-foreground mt-1">{isEdit ? producto?.nombre : "Define el costo y deja que la calculadora proponga un precio."}</p>
        </div>
        {isEdit && tipo === "producto" && (
          <Button asChild variant="outline" size="sm"><Link href={`/inventario/${id}/movimiento`}><ArrowLeftRight className="h-4 w-4 mr-1.5" />Movimientos de stock</Link></Button>
        )}
      </div>

      {(conflicto || cambioExterno) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="banner-costo-desactualizado">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium">{conflicto ? "No guardamos: este producto cambió mientras lo editabas." : "Este producto se actualizó en otra parte (por ejemplo, una recepción de compra)."}</p>
            <p className="text-xs mt-0.5">
              {ultimo ? <>Costo vigente: <span className="font-mono font-semibold">{formatCurrency(ultimo.costoUnitario)}</span>. </> : null}
              Tus cambios siguen en pantalla. Revisa el costo antes de guardar.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button type="button" size="sm" variant="outline" className="bg-background" onClick={() => recargarCosto(false)} data-testid="button-usar-costo-actual">Usar costo actual</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => recargarCosto(true)} data-testid="button-descartar-recargar">Descartar y recargar</Button>
          </div>
        </div>
      )}

      <form onSubmit={submit} onChangeCapture={() => { tocado.current = true; }} onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button[type=button]")) tocado.current = true; }} className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Columna izquierda ───────────────────────────────────────── */}
        <div className="min-w-0 space-y-5">

          {/* Identificación */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Identificación</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(["producto", "servicio"] as const).map((t) => {
                  const Icon = t === "producto" ? Package : Wrench;
                  const sel = tipo === t;
                  return (
                    <button key={t} type="button" disabled={isEdit}
                      onClick={() => { setTipo(t); setPrecioManual(false); if (!unidadesPara(t).includes(unidad)) setUnidad(t === "servicio" ? "hora" : "unidad"); }}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${sel ? "border-primary bg-primary/5" : "border-border/60 hover:bg-secondary/50"} ${isEdit && !sel ? "opacity-40" : ""} disabled:cursor-not-allowed`}>
                      <Icon className={`h-5 w-5 ${sel ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <p className="text-sm font-medium flex items-center gap-1">{t === "producto" ? "Producto" : "Servicio"}{isEdit && sel && <Lock className="h-3 w-3 text-muted-foreground" />}</p>
                        <p className="text-xs text-muted-foreground">{t === "producto" ? "Con stock físico" : "Por horas, sin stock"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {isEdit && <p className="text-xs text-muted-foreground -mt-2">El tipo no se puede cambiar después de crearlo.</p>}
              <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
                <div className="space-y-1.5"><Label>Nombre</Label><Input value={nombre} maxLength={200} onChange={(e) => setNombre(e.target.value)} placeholder={tipo === "producto" ? "Ej: Cartucho tóner HP 85A" : "Ej: Mantención preventiva"} /></div>
                <div className="space-y-1.5"><Label>Unidad de medida</Label>
                  <Select value={unidad} onValueChange={setUnidad}>
                    <SelectTrigger data-testid="select-unidad"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {unidadLegacy && unidadLegacy === unidad && !unidadesPara(tipo).includes(unidadLegacy) && (
                        <SelectItem value={unidadLegacy}>{unidadLegacy} (actual)</SelectItem>
                      )}
                      {unidadesPara(tipo).map((u) => <SelectItem key={u} value={u}>{capitalizar(u)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5"><Label>Código interno</Label>
                  <Input value={codigoInterno} maxLength={50} onChange={(e) => setCodigoInterno(e.target.value.toUpperCase())} className={`font-mono ${codigoInterno && !CODIGO_RE.test(codigoInterno) ? "border-red-500" : ""}`} placeholder={isEdit ? "" : "Automático (PROD-0001)"} data-testid="input-codigo-interno" />
                  <p className="text-[11px] text-muted-foreground">{isEdit ? "Letras, números y guiones." : "Déjalo vacío para generarlo solo."}</p></div>
                <div className="space-y-1.5"><Label>SKU (opcional)</Label><Input value={sku} maxLength={100} onChange={(e) => setSku(e.target.value)} className="font-mono" data-testid="input-sku" /></div>
                <div className="space-y-1.5"><Label>Código de barras (opcional)</Label><Input value={codigoBarras} maxLength={100} onChange={(e) => setCodigoBarras(e.target.value)} className="font-mono" placeholder="EAN / UPC" data-testid="input-codigo-barras" /></div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">Moneda del precio{isEdit && <Lock className="h-3 w-3 text-muted-foreground" />}</Label>
                <Select value={moneda} onValueChange={(v) => { monedaTocada.current = true; setMoneda(v as Moneda); }} disabled={isEdit}>
                  <SelectTrigger className="sm:w-72" data-testid="select-moneda-producto"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONEDAS.map((m) => <SelectItem key={m} value={m}>{m} · {MONEDA_INFO[m].nombre}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{isEdit ? "La moneda no se puede cambiar después de crear el ítem." : "Solo podrás agregarlo a cobros y cotizaciones en esta moneda."}</p>
              </div>
              <div className="space-y-1.5"><Label>Descripción (opcional)</Label><Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="resize-none h-20" /></div>
            </CardContent>
          </Card>

          {/* Calculadora de precio / servicio */}
          {tipo === "producto" ? (
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Calculadora de precio</CardTitle>
                <CardDescription>Elige cómo quieres expresar tu ganancia sobre el costo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                  {([["margen", "Margen sobre precio"], ["recargo", "Recargo sobre costo"]] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => { setMetodo(v); setPrecioManual(false); }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${metodo === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Costo unitario</Label>
                    <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                      <Input type="number" min="0" step="any" className="pl-7 font-mono" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0" /></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{metodo === "margen" ? "Margen deseado" : "Recargo"}</Label>
                    <div className="relative">
                      <Input type="number" min="0" max={metodo === "margen" ? 99.99 : undefined} step="any" className={`pr-8 font-mono ${pctInvalido ? "border-red-500" : ""}`} value={pct} onChange={(e) => { setPct(e.target.value); setPrecioManual(false); }} />
                      <span className="absolute right-3 top-2.5 text-muted-foreground">%</span>
                    </div>
                    <p className={`text-xs ${pctInvalido ? "text-red-600" : "text-muted-foreground"}`}>
                      {pctInvalido ? "El margen debe ser menor a 100%." : metodo === "margen" ? "Precio = costo / (1 - margen)" : "Precio = costo × (1 + recargo)"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Calculadora de servicio</CardTitle>
                <CardDescription>Tarifa por hora, tiempo estimado y un factor por complejidad o riesgo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label>Tarifa por hora</Label>
                    <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                      <Input type="number" min="0" step="any" className="pl-7 font-mono" value={tarifa} onChange={(e) => { setTarifa(e.target.value); setBaseServicioTocada(true); setPrecioManual(false); }} /></div></div>
                  <div className="space-y-1.5"><Label>Tiempo estimado (h)</Label>
                    <Input type="number" min="0" step="0.25" className="font-mono" value={horas} onChange={(e) => { setHoras(e.target.value); setBaseServicioTocada(true); setPrecioManual(false); }} /></div>
                  <div className="space-y-1.5"><Label>Base del servicio</Label>
                    <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                      <Input type="number" className="pl-7 font-mono bg-muted/40" value={Number.isFinite(costoN) ? costoN : ""} readOnly placeholder="0" /></div>
                    <p className="text-xs text-muted-foreground">{isEdit && !baseServicioTocada ? "Costo vigente. Cambia tarifa u horas para recalcular." : "Tarifa × horas, antes del factor."}</p></div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><Label>Factor de factibilidad</Label><span className="font-mono font-semibold">×{factor.toFixed(2)}</span></div>
                  <Slider min={1} max={2} step={0.05} value={[factor]} onValueChange={(v) => { setFactor(v[0]); setPrecioManual(false); }} />
                  <div className="flex justify-between text-[11px] text-muted-foreground"><span>1.0 Simple</span><span>1.5 Moderado</span><span>2.0 Complejo</span></div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 font-mono text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{formatCurrency(Number.isFinite(costoN) ? costoN : 0)} base</span><span className="text-muted-foreground">×</span>
                  <span>{factor.toFixed(2)}</span><span className="text-muted-foreground">=</span>
                  <span className="font-bold text-primary">{formatCurrency(sugerido ?? 0)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stock */}
          {tipo === "producto" && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="text-base">Stock</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {!isEdit && hayBodegas && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Bodega donde queda el stock inicial</Label>
                    <Select value={bodegaId} onValueChange={setBodegaId}>
                      <SelectTrigger data-testid="select-bodega-inicial"><SelectValue placeholder="Selecciona una bodega" /></SelectTrigger>
                      <SelectContent>{bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{etiquetaUbicacion({ localNombre: b.localNombre, bodegaNombre: b.nombre })}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>{isEdit ? "Stock actual (total)" : "Stock inicial"}</Label>
                  {isEdit ? (
                    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 h-10">
                      <span className="font-mono">{formatQty(producto?.stockActual ?? 0)}</span>
                      <Link href={`/inventario/${id}/movimiento`} className="text-xs text-primary hover:underline">Registrar movimiento</Link>
                    </div>
                  ) : (
                    <Input type="number" min="0" step="any" className="font-mono" value={stockInicial} onChange={(e) => setStockInicial(e.target.value)} />
                  )}
                  {isEdit && <p className="text-xs text-muted-foreground">El stock solo cambia mediante movimientos o cobros pagados.</p>}
                </div>
                {isEdit && hayBodegas ? (
                  <div className="space-y-1.5">
                    <Label>Stock crítico por bodega</Label>
                    <div className="rounded-md border divide-y" data-testid="list-ubicaciones-critico">
                      {(producto?.ubicaciones ?? []).length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Sin stock en bodegas todavía.</p>
                      ) : producto!.ubicaciones!.map((u) => (
                        <Link key={u.bodegaId} href={`/bodegas/${u.bodegaId}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/40">
                          <span className="flex items-center gap-1.5 truncate"><Warehouse className="h-3 w-3 shrink-0" />{etiquetaUbicacion(u)}</span>
                          <span className="font-mono shrink-0">{formatQty(u.stockActual)} · mín {formatQty(u.stockCritico)}</span>
                        </Link>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Con bodegas, el umbral se define en cada bodega.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Stock crítico{!isEdit && hayBodegas ? " (en esta bodega)" : ""}</Label>
                    <Input type="number" min="0" step="any" className="font-mono" value={stockCritico} onChange={(e) => setStockCritico(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Bajo o igual a este nivel se marca en rojo.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isEdit && <HistorialCostos productoId={id} />}
        </div>

        {/* ── Columna derecha: precio + IVA + PVP + métricas ─────────── */}
        <aside className="min-w-0 lg:sticky lg:top-6 h-fit space-y-0">
          <Card className="shadow-sm overflow-hidden">

            {/* 1. Precio a guardar (siempre visible, protagonista) */}
            <div className="bg-primary/5 border-b border-primary/20 px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Precio a guardar {incluyeIva ? "(con IVA)" : "(neto)"}
                </p>
                <span className="text-[10px] uppercase tracking-wider rounded bg-muted px-1.5 py-0.5 text-muted-foreground" data-testid="text-fuente-precio">
                  {fuente === "calculado" ? "Calculado" : fuente === "pvp" ? "PVP proveedor" : "Manual"}
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground font-semibold">$</span>
                <Input
                  type="number" min="0" step="any"
                  className="pl-7 font-mono text-xl font-bold h-11"
                  value={precio}
                  onChange={(e) => { setPrecio(e.target.value); setPrecioManual(true); }}
                  data-testid="input-precio-final"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {incluyeIva
                  ? <>Monto que paga el cliente, IVA incluido. Neto: <span className="font-mono">{formatCurrency(redondear(precioNeto, dec))}</span></>
                  : "Precio sin IVA. Los documentos con IVA lo agregarán al cobrar."}
              </p>
              {/* Sugerido (secundario, solo si difiere) */}
              {difiere && sugerido != null && (
                <Button type="button" variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => setFuente("calculado")} data-testid="button-usar-sugerido">
                  <Check className="h-3 w-3 mr-1.5" />Usar precio {incluyeIva ? "sugerido" : "calculado"}: {formatCurrency(sugerido)}
                </Button>
              )}
            </div>

            {/* 2. Métricas de utilidad */}
            <div className="px-5 py-3 border-b border-border/60 grid grid-cols-3 gap-2">
              {[
                { label: "Utilidad neta", value: formatCurrency(real.utilidad), neg: real.utilidad < 0 },
                { label: "Margen", value: formatPct(real.margen), neg: real.utilidad < 0 },
                { label: "Recargo real", value: c0 > 0 && tipo === "producto" ? formatPct(real.recargo) : "—", neg: false },
              ].map(({ label, value, neg }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className={`font-mono text-sm font-bold tabular-nums ${neg ? "text-red-600" : "text-emerald-700"}`}>{value}</p>
                </div>
              ))}
              {real.utilidad < 0 && <p className="col-span-3 text-xs text-red-600">Este precio está bajo el costo: pierdes dinero en cada venta.</p>}
            </div>

            {/* 3. IVA en el precio */}
            <div className="px-5 py-4 border-b border-border/60 space-y-3">
              <div className="flex items-center gap-2">
                <Receipt className="h-3.5 w-3.5 text-primary" />
                <p className="text-sm font-medium">IVA en el precio</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium leading-tight">Incluye IVA en el precio</p>
                  <p className="text-[11px] text-muted-foreground">{incluyeIva ? "Precio guardado es bruto (neto + IVA)" : "Precio guardado es neto"}</p>
                </div>
                <Switch checked={incluyeIva} onCheckedChange={(v) => { setIncluyeIva(v); cambioIva(); }} data-testid="switch-incluye-iva" />
              </div>
              {incluyeIva && (
                <div className="space-y-2">
                  <Label className="text-xs">Tasa de IVA</Label>
                  <Select value={tasaIvaSelect} onValueChange={(v) => { setTasaIvaSelect(v); cambioIva(); }} data-testid="select-tasa-iva">
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASAS_IVA.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {tasaIvaSelect === "otro" && (
                    <div className="relative">
                      <Input
                        type="number" min="0" max="100" step="any" placeholder="Ej: 12"
                        className={`pr-8 font-mono h-9 ${tasaInvalida ? "border-red-500" : ""}`}
                        value={tasaIvaOtro}
                        onChange={(e) => { setTasaIvaOtro(e.target.value); cambioIva(); }}
                        data-testid="input-tasa-iva"
                      />
                      <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                    </div>
                  )}
                  {desg && (
                    <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs space-y-1">
                      <div className="flex justify-between text-muted-foreground"><span>Neto</span><span>{formatCurrency(desg.neto)}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>IVA {tasa}%</span><span>{formatCurrency(desg.iva)}</span></div>
                      <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{formatCurrency(desg.final)}</span></div>
                    </div>
                  )}
                  {isEdit && fuente === "calculado" && (
                    <p className="text-[11px] text-primary">Al cambiar el IVA se adopta el precio calculado.</p>
                  )}
                </div>
              )}
            </div>

            {/* 4. PVP del proveedor (colapsable) */}
            {tipo === "producto" && (
              <div className="px-5 py-3">
                <button
                  type="button"
                  onClick={() => setPvpExpanded((v) => !v)}
                  className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-2"><Tag className="h-3.5 w-3.5" />PVP del proveedor (opcional)</span>
                  {pvpExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {pvpExpanded && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                      <div className="space-y-1.5">
                        <Label className="text-xs">PVP sugerido</Label>
                        <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
                          <Input type="number" min="0" step="any" className="pl-7 font-mono h-9" value={pvp} onChange={(e) => setPvp(e.target.value)} placeholder="Sin PVP" data-testid="input-pvp-proveedor" /></div>
                      </div>
                      <div className="flex gap-1 p-1 bg-muted rounded-lg" role="radiogroup">
                        {([[true, "Con IVA"], [false, "Sin IVA"]] as const).map(([v, l]) => (
                          <button key={l} type="button" role="radio" aria-checked={pvpIncluyeIva === v}
                            onClick={() => { setPvpIncluyeIva(v); if (fuente === "pvp") { if (v) setIncluyeIva(true); } }}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${pvpIncluyeIva === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                            data-testid={`toggle-pvp-${v ? "con" : "sin"}-iva`}>{l}</button>
                        ))}
                      </div>
                    </div>

                    {hayPvp && (
                      <>
                        <div className="rounded-lg bg-muted/50 p-2.5 font-mono text-xs space-y-1">
                          {pvpIncluyeIva ? (
                            <>
                              <div className="flex justify-between"><span className="text-muted-foreground">PVP con IVA</span><span>{formatCurrency(pvpN)}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">÷ (1 + {tasa}%) = neto</span><span className="font-semibold">{formatCurrency(pvpNetoExacto)}</span></div>
                            </>
                          ) : (
                            <div className="flex justify-between"><span className="text-muted-foreground">PVP neto</span><span className="font-semibold">{formatCurrency(pvpNetoExacto)}</span></div>
                          )}
                        </div>
                        <p className={`text-xs rounded-md px-3 py-2 border ${pvpUtilidad < 0 ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} data-testid="text-pvp-margen">
                          Obtienes <strong className="font-mono">{formatPct(pvpMargen)}</strong> de margen · <strong className="font-mono">{formatCurrency(pvpUtilidad)}</strong> utilidad
                        </p>
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant={fuente === "pvp" ? "default" : "outline"} className="flex-1 h-8 text-xs" onClick={() => { if (pvpIncluyeIva) setIncluyeIva(true); setFuente("pvp"); }} data-testid="button-aceptar-pvp">
                            <Check className="h-3 w-3 mr-1" />{fuente === "pvp" ? "PVP aceptado" : "Aceptar PVP"} · {formatCurrency(pvpFinalAceptado)}
                          </Button>
                          {fuente === "pvp" && (
                            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setFuente("calculado")} data-testid="button-usar-calculado">
                              Usar calculado
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Activo / archivado */}
          {isEdit && (
            <div className="mt-4 flex items-center justify-between rounded-xl border bg-card p-4">
              <div>
                <p className="text-sm font-medium">{activo ? "Activo en el catálogo" : "Archivado"}</p>
                <p className="text-xs text-muted-foreground">{activo ? "Disponible para nuevos cobros." : "No aparece al crear cobros."}</p>
              </div>
              <Switch checked={activo} onCheckedChange={setActivo} />
            </div>
          )}

          <Button type="submit" className="w-full mt-4" disabled={pending || !prefsListas}>
            {pending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : isEdit ? "Guardar cambios" : `Crear ${tipo}`}
          </Button>

          {isEdit && (
            <Button
              type="button"
              variant="outline"
              className="w-full mt-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmEliminar(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Eliminar producto
            </Button>
          )}
        </aside>
      </form>

      {/* Confirm delete dialog */}
      {isEdit && (
        <Dialog open={confirmEliminar} onOpenChange={setConfirmEliminar}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Eliminar producto</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro que deseas eliminar este producto? Se eliminarán también sus movimientos de stock e historial de costos. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmEliminar(false)}>Cancelar</Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteProducto.isPending}
                onClick={() => {
                  deleteProducto.mutate(id, {
                    onSuccess: () => {
                      toast({ title: "Producto eliminado", description: "El producto fue eliminado correctamente." });
                      invalidateInventario(qc);
                      setLocation("/inventario");
                    },
                    onError: (err: unknown) => {
                      const msg = (err as { data?: { error?: string } })?.data?.error ?? "No se pudo eliminar el producto.";
                      toast({ title: "Error", description: msg, variant: "destructive" });
                      setConfirmEliminar(false);
                    },
                  });
                }}
              >
                {deleteProducto.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Eliminar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
