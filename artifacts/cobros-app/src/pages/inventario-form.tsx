import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProducto,
  useUpdateProducto,
  useGetProducto,
  getGetProductoQueryKey,
  useListBodegas,
  getListBodegasQueryKey,
  type ProductoInput,
  type Producto,
} from "@workspace/api-client-react";
import { HistorialCostos } from "@/components/historial-costos";
import { PvpProveedorCard, type PvpCalc } from "@/components/pvp-proveedor";
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
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, Loader2, Lock, Package, Receipt, RotateCw, Warehouse, Wrench } from "lucide-react";

type Tipo = "producto" | "servicio";
type Fuente = "manual" | "calculado" | "pvp";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function Money({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "accent" }) {
  const c = tone === "neg" ? "text-red-600" : tone === "pos" ? "text-emerald-700" : tone === "accent" ? "text-primary" : "";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={`font-mono text-lg font-bold tabular-nums ${c}`}>{value}</p>
    </div>
  );
}

export default function InventarioFormPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : 0;
  const isEdit = !!id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createProducto = useCreateProducto();
  const updateProducto = useUpdateProducto();
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
  // Where the final price comes from. On edit, the persisted price is kept ("manual") until the user picks otherwise.
  const [fuente, setFuente] = useState<Fuente>(isEdit ? "manual" : "calculado");
  const setPrecioManual = (b: boolean) => setFuente(b ? "manual" : "calculado");
  const [incluyeIva, setIncluyeIva] = useState(false);
  const [tasaIva, setTasaIva] = useState("19");
  const [pvp, setPvp] = useState("");
  const [pvpIncluyeIva, setPvpIncluyeIva] = useState(true);
  const tokenRef = useRef<string | undefined>(undefined);
  const tocado = useRef(false);
  const [conflicto, setConflicto] = useState(false);
  const [cambioExterno, setCambioExterno] = useState<Producto | null>(null);
  const [stockInicial, setStockInicial] = useState("0");
  const [stockCritico, setStockCritico] = useState("0");
  const [tarifa, setTarifa] = useState("");
  const [horas, setHoras] = useState("");
  const [factor, setFactor] = useState(1);
  // Existing services keep the loaded base cost (may come from a purchase invoice) until tariff/time change.
  const [baseServicioTocada, setBaseServicioTocada] = useState(!isEdit);
  const [costoServicioCargado, setCostoServicioCargado] = useState(0);

  // Currency is set at creation (default from preferences) and cannot change later.
  const { prefs, listo: prefsListas } = usePreferencias();
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const monedaTocada = useRef(false);
  useEffect(() => {
    if (!isEdit && prefsListas && !monedaTocada.current) setMoneda(monedaDe(prefs.moneda));
  }, [isEdit, prefsListas, prefs.moneda]);
  useEffect(() => {
    if (!isEdit && prefsListas && !tocado.current) setTasaIva(String(prefs.porcentajeIva ?? 19));
  }, [isEdit, prefsListas, prefs.porcentajeIva]);
  // Monetary precision is global (preferences), never currency-derived.
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
    setTasaIva(String(p.porcentajeIvaPrecio ?? prefs.porcentajeIva ?? 19));
    setPvp(p.pvpProveedor != null ? String(p.pvpProveedor) : "");
    setPvpIncluyeIva(p.pvpIncluyeIva ?? true);
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
      // Updated elsewhere (e.g. a purchase receipt). Pristine form refreshes; dirty form warns.
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

  // Supplier PVP analysis (unrounded net for margin).
  const pvpN = num(pvp);
  const hayPvp = tipo === "producto" && Number.isFinite(pvpN) && pvpN > 0;
  const pvpCalc: PvpCalc = hayPvp ? (() => {
    const netoExacto = netoDesde(pvpN, tasa, pvpIncluyeIva);
    const c = Number.isNaN(costoN) ? 0 : costoN;
    const finalAceptado = pvpIncluyeIva
      ? redondear(pvpN, dec)
      : desgloseIva(pvpN, tasa, incluyeIva, dec).final;
    return { netoExacto, margen: ((netoExacto - c) / netoExacto) * 100, utilidad: netoExacto - c, finalAceptado };
  })() : null;

  // Keep price synced with its source until the user types their own.
  useEffect(() => {
    if (fuente === "calculado" && sugerido != null) setPrecio(String(sugerido));
    if (fuente === "pvp" && pvpCalc) setPrecio(String(pvpCalc.finalAceptado));
  }, [sugerido, fuente, pvpCalc?.finalAceptado]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fuente === "pvp" && !hayPvp) setFuente("calculado"); }, [fuente, hayPvp]);

  const aceptarPvp = () => { if (!pvpCalc) return; if (pvpIncluyeIva) setIncluyeIva(true); setFuente("pvp"); };
  // IVA toggle/rate: explicit adoption of the calculated price on edit so an old net price is never relabeled as gross.
  const cambioIva = () => {
    if (fuente === "pvp" && !pvpIncluyeIva) return;
    if (isEdit || fuente !== "manual") setFuente("calculado");
  };

  const precioN = num(precio);
  const precioFinalR = Number.isNaN(precioN) ? 0 : roundTo(precioN, dec);
  const precioNeto = netoDesde(precioFinalR, tasa, incluyeIva);
  const real = utilidadDe(Number.isNaN(costoN) ? 0 : costoN, precioNeto);
  const pctInvalido = tipo === "producto" && metodo === "margen" && pctN >= 100;
  const difiere = sugerido != null && !Number.isNaN(precioN) && roundTo(precioN, dec) !== sugerido;

  const recargarCosto = async (descartar: boolean) => {
    const r = await refetch();
    const p = r.data;
    if (!p) { toast({ title: "No se pudo recargar", variant: "destructive" }); return; }
    if (descartar) { aplicar(p); return; }
    // Keep the user's edits; adopt only the current cost and version token.
    tokenRef.current = p.actualizadoEn;
    setCosto(String(p.costoUnitario ?? 0));
    setConflicto(false);
    setCambioExterno(null);
  };
  const ultimo = cambioExterno ?? (conflicto ? producto ?? null : null);

  const pending = createProducto.isPending || updateProducto.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Precision comes from preferences; never save with the fallback (0) while they load or failed.
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

      <form onSubmit={submit} onChangeCapture={() => { tocado.current = true; }} onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button[type=button]")) tocado.current = true; }} className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
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
                    <p className="text-xs text-muted-foreground">{isEdit && !baseServicioTocada ? "Costo vigente (puede venir de una factura). Cambia tarifa u horas para recalcular." : "Tarifa × horas, antes del factor."}</p></div>
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

          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" />IVA en el precio de venta</CardTitle>
              <CardDescription>La calculadora trabaja en neto. Activa el IVA si tu precio de venta al público lo incluye.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[1fr_160px] sm:items-end">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Incluir IVA en precio final</p>
                  <p className="text-xs text-muted-foreground">{incluyeIva ? "El precio final guardado es bruto (neto + IVA)." : "El precio final guardado es neto."}</p>
                </div>
                <Switch checked={incluyeIva} onCheckedChange={(v) => { setIncluyeIva(v); cambioIva(); }} data-testid="switch-incluye-iva" />
              </div>
              <div className="space-y-1.5">
                <Label>Tasa IVA</Label>
                <div className="relative">
                  <Input type="number" min="0" max="100" step="any" className={`pr-8 font-mono ${tasaInvalida ? "border-red-500" : ""}`} value={tasaIva} disabled={!incluyeIva}
                    onChange={(e) => { setTasaIva(e.target.value); cambioIva(); }} data-testid="input-tasa-iva" />
                  <span className="absolute right-3 top-2.5 text-muted-foreground">%</span>
                </div>
              </div>
              {isEdit && fuente === "calculado" && (
                <p className="sm:col-span-2 text-xs text-primary">Al cambiar el IVA se adopta el precio calculado para no reetiquetar un precio neto como bruto.</p>
              )}
            </CardContent>
          </Card>

          {tipo === "producto" && (
            <PvpProveedorCard pvp={pvp} setPvp={setPvp} incluyeIva={pvpIncluyeIva}
              setIncluyeIva={(v) => { setPvpIncluyeIva(v); if (fuente === "pvp") { if (v) setIncluyeIva(true); } }}
              tasa={tasa} calc={pvpCalc} fmt={formatCurrency} fuente={fuente}
              onAceptar={aceptarPvp} onUsarCalculado={() => setFuente("calculado")} />
          )}

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
                    <p className="text-xs text-muted-foreground">Con bodegas, el umbral se define en cada bodega. Abre una para editarlo.</p>
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

        <aside className="min-w-0 lg:sticky lg:top-6 h-fit space-y-4">
          <Card className="shadow-sm border-primary/30 overflow-hidden">
            <div className="bg-primary/5 border-b border-primary/20 px-5 py-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{tipo === "producto" ? "Precio sugerido" : "Precio calculado"}{incluyeIva ? " con IVA" : " neto"}</p>
              <p className="font-mono text-3xl font-bold text-primary tabular-nums" data-testid="text-precio-sugerido">{sugerido != null ? formatCurrency(sugerido) : "—"}</p>
              {desg && incluyeIva && (
                <p className="font-mono text-xs text-muted-foreground mt-1" data-testid="text-desglose-iva">{formatCurrency(desg.neto)} neto + {formatCurrency(desg.iva)} IVA ({tasa}%)</p>
              )}
            </div>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Precio final de venta {incluyeIva ? "(con IVA)" : "(neto)"}</Label>
                  <span className="text-[10px] uppercase tracking-wider rounded bg-muted px-1.5 py-0.5 text-muted-foreground" data-testid="text-fuente-precio">
                    {fuente === "calculado" ? "Calculado" : fuente === "pvp" ? "PVP proveedor" : "Manual"}
                  </span>
                </div>
                <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                  <Input type="number" min="0" step="any" className="pl-7 font-mono text-base font-semibold" value={precio}
                    onChange={(e) => { setPrecio(e.target.value); setPrecioManual(true); }} data-testid="input-precio-final" /></div>
                <p className="text-[11px] text-muted-foreground">
                  {incluyeIva ? <>Monto que paga el cliente, IVA incluido. Neto: <span className="font-mono">{formatCurrency(redondear(precioNeto, dec))}</span></> : "Monto sin IVA; los documentos agregan el IVA."}
                </p>
                {difiere && (
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setFuente("calculado")} data-testid="button-usar-sugerido">
                    <Check className="h-3.5 w-3.5 mr-1.5" />Usar precio sugerido
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-3 border-t">
                <Money label="Utilidad neta" value={formatCurrency(real.utilidad)} tone={real.utilidad < 0 ? "neg" : "pos"} />
                <Money label="Margen neto" value={formatPct(real.margen)} tone={real.utilidad < 0 ? "neg" : "pos"} />
                {tipo === "producto" && <Money label="Recargo real" value={costoN > 0 ? formatPct(real.recargo) : "—"} />}
              </div>
              {real.utilidad < 0 && <p className="text-xs text-red-600">Este precio está bajo el costo: pierdes dinero en cada venta.</p>}
            </CardContent>
          </Card>

          {isEdit && (
            <div className="flex items-center justify-between rounded-xl border bg-card p-4">
              <div>
                <p className="text-sm font-medium">{activo ? "Activo en el catálogo" : "Archivado"}</p>
                <p className="text-xs text-muted-foreground">{activo ? "Disponible para nuevos cobros." : "No aparece al crear cobros."}</p>
              </div>
              <Switch checked={activo} onCheckedChange={setActivo} />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={pending || !prefsListas}>
            {pending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : isEdit ? "Guardar cambios" : `Crear ${tipo}`}
          </Button>
        </aside>
      </form>
    </div>
  );
}
