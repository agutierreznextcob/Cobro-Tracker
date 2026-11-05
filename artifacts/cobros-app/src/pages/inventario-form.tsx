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
} from "@workspace/api-client-react";
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
  CODIGO_RE,
  etiquetaUbicacion,
  unidadesPara,
  formatPct,
  formatQty,
  invalidateInventario,
  precioServicio,
  precioSugerido,
  utilidadDe,
  type MetodoCalculo,
} from "@/lib/inventario";
import { ArrowLeft, ArrowLeftRight, Check, Loader2, Lock, Package, RotateCw, Warehouse, Wrench } from "lucide-react";

type Tipo = "producto" | "servicio";

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
    query: { enabled: isEdit, queryKey: getGetProductoQueryKey(id), staleTime: 0, refetchOnMount: "always" },
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
  const [precioManual, setPrecioManual] = useState(isEdit);
  const [stockInicial, setStockInicial] = useState("0");
  const [stockCritico, setStockCritico] = useState("0");
  const [tarifa, setTarifa] = useState("");
  const [horas, setHoras] = useState("");
  const [factor, setFactor] = useState(1);

  // Currency is set at creation (default from preferences) and cannot change later.
  const { prefs, listo: prefsListas } = usePreferencias();
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const monedaTocada = useRef(false);
  useEffect(() => {
    if (!isEdit && prefsListas && !monedaTocada.current) setMoneda(monedaDe(prefs.moneda));
  }, [isEdit, prefsListas, prefs.moneda]);
  // Monetary precision is global (preferences), never currency-derived.
  const dec = decimalesPref(prefs);
  const formatCurrency = (n: number) => formatMoney(n, moneda, dec);

  const initFor = useRef<number | null>(null);
  useEffect(() => {
    if (!producto || !isFetchedAfterMount || initFor.current === producto.id) return;
    initFor.current = producto.id;
    setTipo(producto.tipo as Tipo);
    setMoneda(monedaDe(producto.moneda));
    setNombre(producto.nombre);
    setDescripcion(producto.descripcion ?? "");
    const u = producto.unidadMedida || (producto.tipo === "servicio" ? "hora" : "unidad");
    setUnidad(u);
    setUnidadLegacy(unidadesPara(producto.tipo as Tipo).includes(u) ? null : u);
    setCodigoInterno(producto.codigoInterno ?? "");
    setSku(producto.sku ?? "");
    setCodigoBarras(producto.codigoBarras ?? "");
    setActivo(producto.activo);
    setCosto(String(producto.costoUnitario ?? 0));
    setMetodo((producto.metodoCalculo as MetodoCalculo) ?? "margen");
    setPct(producto.margenPorcentaje != null ? String(producto.margenPorcentaje) : "30");
    setPrecio(String(producto.precioUnitario));
    setPrecioManual(true);
    setStockCritico(String(producto.stockCritico ?? 0));
    setTarifa(producto.tarifaHora != null ? String(producto.tarifaHora) : "");
    setHoras(producto.tiempoEstimadoHoras != null ? String(producto.tiempoEstimadoHoras) : "");
    setFactor(producto.factorFactibilidad ?? 1);
  }, [producto, isFetchedAfterMount]);

  const costoN = tipo === "servicio" ? roundTo(roundTo(num(tarifa), dec) * num(horas), dec) : roundTo(num(costo), dec);
  const pctN = num(pct);
  const sugerido = tipo === "producto"
    ? precioSugerido(Number.isNaN(costoN) ? 0 : costoN, pctN, metodo, dec)
    : precioServicio(roundTo(num(tarifa), dec), num(horas), factor, dec);

  // Keep price synced with the suggestion until the user types their own.
  useEffect(() => {
    if (!precioManual && sugerido != null) setPrecio(String(sugerido));
  }, [sugerido, precioManual]);

  const precioN = num(precio);
  const real = utilidadDe(Number.isNaN(costoN) ? 0 : costoN, Number.isNaN(precioN) ? 0 : roundTo(precioN, dec));
  const pctInvalido = tipo === "producto" && metodo === "margen" && pctN >= 100;
  const difiere = sugerido != null && !Number.isNaN(precioN) && roundTo(precioN, dec) !== sugerido;

  const pending = createProducto.isPending || updateProducto.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Precision comes from preferences; never save with the fallback (0) while they load or failed.
    if (!prefsListas) { toast({ title: "Cargando preferencias", description: "Espera un momento e intenta nuevamente.", variant: "destructive" }); return; }
    if (!nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return; }
    if (Number.isNaN(costoN) || costoN < 0) { toast({ title: "Costo inválido", description: "Ingresa un costo de 0 o más.", variant: "destructive" }); return; }
    if (Number.isNaN(precioN) || precioN < 0) { toast({ title: "Precio inválido", variant: "destructive" }); return; }
    if (pctInvalido) { toast({ title: "Margen inválido", description: "El margen debe ser menor a 100%.", variant: "destructive" }); return; }
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
    };
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

    const onError = (err: unknown) => toast({ title: "No se pudo guardar", description: apiErrorMessage(err, "Revisa los datos e intenta nuevamente."), variant: "destructive" });
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
    <div className="max-w-5xl mx-auto space-y-5 animate-in fade-in duration-300">
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

      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
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
                      <Input type="number" min="0" step="any" className="pl-7 font-mono" value={tarifa} onChange={(e) => { setTarifa(e.target.value); setPrecioManual(false); }} /></div></div>
                  <div className="space-y-1.5"><Label>Tiempo estimado (h)</Label>
                    <Input type="number" min="0" step="0.25" className="font-mono" value={horas} onChange={(e) => { setHoras(e.target.value); setPrecioManual(false); }} /></div>
                  <div className="space-y-1.5"><Label>Base del servicio</Label>
                    <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                      <Input type="number" className="pl-7 font-mono bg-muted/40" value={Number.isFinite(costoN) ? costoN : ""} readOnly placeholder="0" /></div>
                    <p className="text-xs text-muted-foreground">Tarifa × horas, antes del factor.</p></div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><Label>Factor de factibilidad</Label><span className="font-mono font-semibold">×{factor.toFixed(2)}</span></div>
                  <Slider min={1} max={2} step={0.05} value={[factor]} onValueChange={(v) => { setFactor(v[0]); setPrecioManual(false); }} />
                  <div className="flex justify-between text-[11px] text-muted-foreground"><span>1.0 Simple</span><span>1.5 Moderado</span><span>2.0 Complejo</span></div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 font-mono text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{formatQty(num(horas) || 0)} h</span><span className="text-muted-foreground">×</span>
                  <span>{formatCurrency(num(tarifa) || 0)}</span><span className="text-muted-foreground">×</span>
                  <span>{factor.toFixed(2)}</span><span className="text-muted-foreground">=</span>
                  <span className="font-bold text-primary">{formatCurrency(sugerido ?? 0)}</span>
                </div>
              </CardContent>
            </Card>
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
        </div>

        <aside className="lg:sticky lg:top-6 h-fit space-y-4">
          <Card className="shadow-sm border-primary/30 overflow-hidden">
            <div className="bg-primary/5 border-b border-primary/20 px-5 py-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{tipo === "producto" ? "Precio sugerido" : "Precio calculado"}</p>
              <p className="font-mono text-3xl font-bold text-primary tabular-nums">{sugerido != null ? formatCurrency(sugerido) : "—"}</p>
            </div>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-1.5">
                <Label>Precio final de venta</Label>
                <div className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                  <Input type="number" min="0" step="1" className="pl-7 font-mono text-base font-semibold" value={precio}
                    onChange={(e) => { setPrecio(e.target.value); setPrecioManual(true); }} /></div>
                {difiere && (
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => { setPrecio(String(sugerido)); setPrecioManual(false); }}>
                    <Check className="h-3.5 w-3.5 mr-1.5" />Usar precio sugerido
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-3 border-t">
                <Money label="Utilidad" value={formatCurrency(real.utilidad)} tone={real.utilidad < 0 ? "neg" : "pos"} />
                <Money label="Margen real" value={formatPct(real.margen)} tone={real.utilidad < 0 ? "neg" : "pos"} />
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
