import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useCreateCompra, useUpdateCompra, useGetCompra, getGetCompraQueryKey,
  useListProveedores, getListProveedoresQueryKey,
  useListInventario, getListInventarioQueryKey,
  useListBodegas, getListBodegasQueryKey,
  type Compra, type CompraInput, type Producto,
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
import { BarcodeScanner } from "@/components/barcode-scanner";
import { ProveedorDialog } from "@/components/proveedor-dialog";
import { ProductoRapidoDialog } from "@/components/producto-rapido-dialog";
import { RecepcionCompraDialog } from "@/components/recepcion-compra-dialog";
import { formatMoney, hoySantiago, monedaDe, MONEDAS, MONEDA_INFO, type Moneda } from "@/lib/format";
import { apiErrorMessage, buscarPorCodigo } from "@/lib/inventario";
import {
  esFisico, errorStatus, invalidateCompras, itemsDe, lineaLibreCompra, nuevaKeyCompra, puedeRecibirLocal,
  subtotalLineaCompra, totalesCompra, type LineaCompra,
} from "@/lib/compras";
import { ArrowLeft, Boxes, Building2, Loader2, Lock, PackageCheck, PenLine, Plus, RotateCw, Save, Search, Trash2, Warehouse } from "lucide-react";

const SIN_BODEGA = "__none";

export default function CompraFormPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : 0;
  const isEdit = !!id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { prefs, listo: prefsListas } = usePreferencias();

  const compraQ = useGetCompra(id, { query: { enabled: isEdit, queryKey: getGetCompraQueryKey(id), staleTime: 0, refetchOnMount: "always" } });
  const provQ = useListProveedores({ query: { queryKey: getListProveedoresQueryKey(), staleTime: 0 } });
  const prodQ = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always" } });
  const bodQ = useListBodegas({ query: { queryKey: getListBodegasQueryKey(), staleTime: 0 } });

  const crear = useCreateCompra();
  const actualizar = useUpdateCompra();

  const [guardada, setGuardada] = useState<Compra | null>(null);
  const [proveedorId, setProveedorId] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fechaEmision, setFechaEmision] = useState(() => hoySantiago());
  const [fechaRecepcion, setFechaRecepcion] = useState(() => hoySantiago());
  const [moneda, setMoneda] = useState<Moneda>("CLP");
  const [iva, setIva] = useState("19");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [bodegaGlobal, setBodegaGlobal] = useState("");
  const [accion, setAccion] = useState<"guardar" | "recibir" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provOpen, setProvOpen] = useState(false);
  const [rapido, setRapido] = useState<string | null>(null);
  const [recepcionOpen, setRecepcionOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const prefsAplicadas = useRef(false);
  useEffect(() => {
    if (isEdit || !prefsListas || prefsAplicadas.current) return;
    prefsAplicadas.current = true;
    setMoneda(monedaDe(prefs.moneda));
    setIva(String(prefs.porcentajeIva ?? 19));
  }, [isEdit, prefsListas, prefs]);

  const c = compraQ.data;
  const initFor = useRef<number | null>(null);
  useEffect(() => {
    if (!c || !compraQ.isFetchedAfterMount || initFor.current === c.id) return;
    initFor.current = c.id;
    setGuardada(c);
    setProveedorId(String(c.proveedorId));
    setNumeroFactura(c.numeroFactura);
    setFechaEmision(c.fechaEmision.slice(0, 10));
    setFechaRecepcion(c.fechaRecepcion.slice(0, 10));
    setMoneda(monedaDe(c.moneda));
    setIva(String(c.porcentajeIva));
    setNotas(c.notas ?? "");
    setLineas(itemsDe(c).map((it) => ({
      key: nuevaKeyCompra(), productoId: it.productoId ?? null, tipoProducto: it.tipoProducto, descripcion: it.descripcion,
      cantidad: String(it.cantidad), precioUnitario: String(it.precioUnitario), bodegaDestinoId: it.bodegaDestinoId ? String(it.bodegaDestinoId) : "",
    })));
  }, [c, compraQ.isFetchedAfterMount]);

  const decimales = guardada ? guardada.decimales : decimalesPref(prefs);
  const monedaFija = !!guardada;
  const ivaPct = Math.min(100, Math.max(0, Number(iva) || 0));
  const tot = totalesCompra(lineas, decimales, ivaPct);
  const fmt = (n: number) => formatMoney(n, moneda, decimales);
  const puedeRecibir = guardada ? guardada.puedeRecibir : puedeRecibirLocal(user);

  const proveedores = (provQ.data ?? []).filter((p) => p.activo || String(p.id) === proveedorId);
  const proveedor = proveedores.find((p) => String(p.id) === proveedorId);
  const bodegas = useMemo(() => (bodQ.data ?? []).filter((b) => b.activo), [bodQ.data]);
  const productos = prodQ.data;

  const catalogo = useMemo(() => {
    const s = busqueda.trim().toLowerCase();
    return (productos ?? []).filter((p) => p.activo && monedaDe(p.moneda) === moneda)
      .filter((p) => !s || `${p.nombre} ${p.codigoInterno ?? ""} ${p.sku ?? ""} ${p.codigoBarras ?? ""}`.toLowerCase().includes(s)).slice(0, 50);
  }, [productos, moneda, busqueda]);

  const update = (key: string, patch: Partial<LineaCompra>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const agregarProducto = (p: Producto) => {
    if (monedaDe(p.moneda) !== moneda) {
      toast({ title: "Moneda distinta", description: `${p.nombre} está en ${monedaDe(p.moneda)}; esta compra es en ${moneda}. Usa una línea libre.`, variant: "destructive" });
      return;
    }
    setLineas((ls) => {
      const existente = ls.find((l) => l.productoId === p.id);
      if (existente) return ls.map((l) => (l.key === existente.key ? { ...l, cantidad: String((Number(l.cantidad) || 0) + 1) } : l));
      const fisico = p.tipo !== "servicio";
      return [...ls, {
        key: nuevaKeyCompra(), productoId: p.id, tipoProducto: p.tipo, descripcion: p.nombre, cantidad: "1",
        precioUnitario: String(p.costoUnitario ?? 0), bodegaDestinoId: fisico ? (bodegaGlobal || (bodegas.length === 1 ? String(bodegas[0].id) : "")) : "",
      }];
    });
  };

  const onScan = (code: string) => {
    if (!productos) { toast({ title: "Catálogo cargando", description: "Intenta en un momento." }); return false; }
    const m = buscarPorCodigo(productos.filter((p) => p.activo), code);
    if (m.length === 0) { setRapido(code); return true; }
    const enMoneda = m.filter((p) => monedaDe(p.moneda) === moneda);
    agregarProducto(enMoneda[0] ?? m[0]);
    if (enMoneda.length > 1) toast({ title: "Código repetido", description: `${enMoneda.length} productos comparten ese código; se agregó ${enMoneda[0].nombre}.` });
    return true;
  };

  const aplicarBodegaGlobal = (v: string) => {
    setBodegaGlobal(v);
    if (v) setLineas((ls) => ls.map((l) => (esFisico(l) ? { ...l, bodegaDestinoId: v } : l)));
  };

  const cambiarMoneda = (m: Moneda) => {
    if (m === moneda) return;
    if (lineas.some((l) => l.productoId != null)) {
      setLineas((ls) => ls.filter((l) => l.productoId == null));
      toast({ title: "Ítems del catálogo quitados", description: "Los productos vinculados deben estar en la moneda de la compra." });
    }
    setMoneda(m);
  };

  const validar = (): CompraInput | null => {
    if (!guardada && !prefsListas) return fallo("Cargando preferencias, intenta en un momento.");
    if (!proveedorId) return fallo("Elige o crea un proveedor.");
    if (!numeroFactura.trim()) return fallo("Ingresa el número de factura.");
    if (!fechaEmision || !fechaRecepcion) return fallo("Completa las fechas.");
    if (fechaRecepcion < fechaEmision) return fallo("La recepción no puede ser anterior a la emisión.");
    const utiles = lineas.filter((l) => l.descripcion.trim() || l.precioUnitario.trim() || l.productoId != null);
    if (utiles.length === 0) return fallo("Agrega al menos un ítem.");
    if (utiles.length > 200) return fallo("Máximo 200 ítems por factura.");
    const costoPorProducto = new Map<number, number>();
    for (const l of utiles) {
      if (!l.descripcion.trim()) return fallo("Falta la descripción de un ítem.");
      if (!(Number(l.cantidad) > 0)) return fallo(`"${l.descripcion}" necesita cantidad mayor a 0.`);
      if (l.precioUnitario.trim() === "" || Number(l.precioUnitario) < 0) return fallo(`Revisa el precio de "${l.descripcion}".`);
      if (esFisico(l)) {
        if (!l.bodegaDestinoId) return fallo(`Elige la bodega destino de "${l.descripcion}".`);
        if (!bodegas.some((b) => String(b.id) === l.bodegaDestinoId)) return fallo(`La bodega de "${l.descripcion}" no está activa.`);
      }
      if (l.productoId != null) {
        const prev = costoPorProducto.get(l.productoId);
        if (prev !== undefined && prev !== Number(l.precioUnitario)) return fallo(`"${l.descripcion}" aparece con costos distintos. Un mismo producto puede ir a varias bodegas solo con el mismo costo unitario.`);
        costoPorProducto.set(l.productoId, Number(l.precioUnitario));
      }
    }
    setError(null);
    return {
      numeroFactura: numeroFactura.trim(), proveedorId: Number(proveedorId), fechaEmision, fechaRecepcion, moneda, porcentajeIva: ivaPct,
      notas: notas.trim(), ...(guardada ? { updatedAt: guardada.updatedAt } : {}),
      items: utiles.map((l) => ({
        productoId: l.productoId, descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad), precioUnitario: Number(l.precioUnitario),
        bodegaDestinoId: esFisico(l) && l.bodegaDestinoId ? Number(l.bodegaDestinoId) : null,
      })),
    };
  };
  function fallo(msg: string): null { setError(msg); toast({ title: "Revisa la compra", description: msg, variant: "destructive" }); return null; }

  const ejecutar = async (a: "guardar" | "recibir") => {
    const data = validar();
    if (!data || accion) return;
    setAccion(a);
    try {
      const res = guardada ? await actualizar.mutateAsync({ id: guardada.id, data }) : await crear.mutateAsync({ data });
      setGuardada(res);
      initFor.current = res.id;
      qc.setQueryData(getGetCompraQueryKey(res.id), res);
      invalidateCompras(qc);
      if (a === "guardar") {
        toast({ title: "Borrador guardado", description: `Factura ${res.numeroFactura}` });
        navigate(`/compras/${res.id}`);
      } else if (!res.puedeRecibir) {
        toast({ title: "Borrador guardado", description: "Tu rol no puede confirmar recepciones. Un administrador o supervisor debe confirmarla.", variant: "destructive" });
        navigate(`/compras/${res.id}`);
      } else {
        if (!isEdit) navigate(`/compras/${res.id}/editar`, { replace: true });
        setRecepcionOpen(true);
      }
    } catch (err) {
      const msg = errorStatus(err) === 409
        ? "Otra persona modificó esta compra. Recarga para ver la versión actual; tus cambios no se guardaron."
        : apiErrorMessage(err, "No se pudo guardar la compra.");
      setError(msg);
      toast({ title: "No se pudo guardar", description: msg, variant: "destructive" });
    } finally {
      setAccion(null);
    }
  };

  if (isEdit && (compraQ.isLoading || (!compraQ.isFetchedAfterMount && !compraQ.isError))) {
    return <div className="max-w-7xl mx-auto space-y-4 animate-pulse"><div className="h-6 w-48 bg-muted rounded" /><div className="grid gap-5 lg:grid-cols-[1fr_340px]"><div className="h-96 bg-muted/60 rounded-xl" /><div className="h-64 bg-muted/60 rounded-xl" /></div></div>;
  }
  if (isEdit && (compraQ.isError || !c)) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos esta compra.</p>
        <p className="text-sm text-muted-foreground">{apiErrorMessage(compraQ.error, "")}</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => compraQ.refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/compras">Volver</Link></Button>
        </div>
      </div>
    );
  }
  if (isEdit && c && c.estado !== "borrador" && !recepcionOpen) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="font-medium">La factura {c.numeroFactura} ya fue recibida.</p>
        <p className="text-sm text-muted-foreground">Solo los borradores se pueden editar.</p>
        <Button asChild size="sm"><Link href={`/compras/${c.id}`}>Ver compra</Link></Button>
      </div>
    );
  }

  const ocupado = accion !== null;
  const sinBodegas = !bodQ.isLoading && bodegas.length === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href={isEdit ? `/compras/${id}` : "/compras"} className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="link-volver-compras">
        <ArrowLeft className="mr-2 h-4 w-4" />{isEdit ? "Volver a la compra" : "Volver a compras"}
      </Link>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{guardada ? `Borrador · Factura ${guardada.numeroFactura}` : "Factura de compra"}</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{isEdit ? "Editar compra" : "Nueva compra"}</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
        <div className="space-y-5 min-w-0">
          <Card className="shadow-sm border-primary/30">
            <CardHeader className="pb-2"><CardTitle className="text-base">Escanear productos recibidos</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <BarcodeScanner onScan={onScan} label="Escanea el código de barras de cada producto" testId="scanner-compra" />
              <p className="text-[11px] text-muted-foreground">Si el producto existe suma una unidad a su línea; si no, podrás crearlo aquí mismo.</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Proveedor y factura</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Proveedor</Label>
                <div className="flex gap-2">
                  <Select value={proveedorId} onValueChange={setProveedorId}>
                    <SelectTrigger className="flex-1" data-testid="select-proveedor-compra"><SelectValue placeholder={provQ.isLoading ? "Cargando proveedores..." : "Selecciona un proveedor"} /></SelectTrigger>
                    <SelectContent>{proveedores.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.razonSocial} · {p.rut}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setProvOpen(true)} data-testid="button-nuevo-proveedor-inline"><Plus className="h-4 w-4 mr-1" />Nuevo</Button>
                </div>
                {provQ.isError && <p className="text-xs text-red-600">No se pudieron cargar los proveedores. <button type="button" className="underline" onClick={() => provQ.refetch()}>Reintentar</button></p>}
                {proveedor && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Building2 className="h-3 w-3" />{proveedor.giro || "Sin giro"}{proveedor.direccion ? ` · ${proveedor.direccion}` : ""}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5"><Label>N° de factura</Label><Input value={numeroFactura} maxLength={60} onChange={(e) => setNumeroFactura(e.target.value)} className="font-mono" data-testid="input-numero-factura" /></div>
                <div className="space-y-1.5"><Label>Fecha emisión</Label><Input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} data-testid="input-fecha-emision-compra" /></div>
                <div className="space-y-1.5"><Label>Fecha recepción</Label><Input type="date" min={fechaEmision} value={fechaRecepcion} onChange={(e) => setFechaRecepcion(e.target.value)} data-testid="input-fecha-recepcion" /></div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Ítems</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" data-testid="button-compra-catalogo"><Boxes className="h-3.5 w-3.5 mr-1.5" />Desde catálogo</Button></PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-2">
                    <div className="relative mb-2"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={`Buscar en ${moneda}`} className="pl-8 h-9" /></div>
                    <div className="max-h-64 overflow-y-auto">
                      {prodQ.isLoading ? <div className="space-y-1.5 p-1">{[1, 2, 3].map((i) => <div key={i} className="h-9 rounded bg-muted animate-pulse" />)}</div>
                        : prodQ.isError ? <div className="p-3 text-center text-sm">No se pudo cargar el catálogo. <button type="button" className="text-primary underline" onClick={() => prodQ.refetch()}>Reintentar</button></div>
                        : catalogo.length === 0 ? <p className="p-3 text-center text-sm text-muted-foreground">Sin productos en {moneda}.</p>
                        : catalogo.map((p) => (
                          <button key={p.id} type="button" onClick={() => { agregarProducto(p); setPickerOpen(false); setBusqueda(""); }} className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted" data-testid={`option-compra-producto-${p.id}`}>
                            <span className="min-w-0"><span className="block truncate font-medium">{p.nombre}</span><span className="text-[11px] text-muted-foreground">{p.tipo === "servicio" ? "Servicio" : "Producto"} · costo</span></span>
                            <span className="font-mono text-xs shrink-0">{formatMoney(p.costoUnitario ?? 0, p.moneda, decimales)}</span>
                          </button>
                        ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button type="button" variant="outline" size="sm" onClick={() => setLineas((ls) => [...ls, lineaLibreCompra()])} data-testid="button-compra-linea-libre"><PenLine className="h-3.5 w-3.5 mr-1.5" />Línea libre</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/20 p-2.5">
                <Warehouse className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Bodega destino para todos</span>
                <Select value={bodegaGlobal || SIN_BODEGA} onValueChange={(v) => aplicarBodegaGlobal(v === SIN_BODEGA ? "" : v)}>
                  <SelectTrigger className="h-8 w-full sm:w-64" data-testid="select-bodega-global"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_BODEGA}>Elegir por ítem</SelectItem>
                    {bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.localNombre} → {b.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
                {sinBodegas && <span className="text-xs text-amber-700">No tienes bodegas activas. <Link href="/bodegas/nueva" className="underline" data-testid="link-crear-bodega">Crear bodega</Link></span>}
                {bodQ.isError && <span className="text-xs text-red-600">Error al cargar bodegas. <button type="button" className="underline" onClick={() => bodQ.refetch()}>Reintentar</button></span>}
              </div>

              {lineas.length === 0 && <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Escanea, elige desde el catálogo o agrega una línea libre.</div>}
              {lineas.map((l, i) => {
                const fisico = esFisico(l);
                return (
                  <div key={l.key} className="rounded-md bg-muted/30 p-2.5 space-y-2" data-testid={`row-compra-item-${i}`}>
                    <div className="grid grid-cols-2 md:grid-cols-[1fr_80px_120px_110px_32px] gap-2 items-center">
                      <Input className="col-span-2 md:col-span-1 h-8" value={l.descripcion} maxLength={1000} onChange={(e) => update(l.key, { descripcion: e.target.value })} placeholder="Descripción" data-testid={`input-compra-descripcion-${i}`} />
                      <Input type="number" min="0" step="any" value={l.cantidad} onChange={(e) => update(l.key, { cantidad: e.target.value })} className="h-8 font-mono" aria-label="Cantidad" data-testid={`input-compra-cantidad-${i}`} />
                      <Input type="number" min="0" step="any" value={l.precioUnitario} onChange={(e) => update(l.key, { precioUnitario: e.target.value })} className="h-8 font-mono" placeholder="Costo unit." aria-label="Precio unitario" data-testid={`input-compra-precio-${i}`} />
                      <span className="font-mono text-sm text-right tabular-nums" data-testid={`text-compra-subtotal-${i}`}>{fmt(subtotalLineaCompra(l, decimales))}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 justify-self-end text-muted-foreground hover:text-red-600" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Quitar" data-testid={`button-compra-quitar-${i}`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {l.productoId == null ? <span className="text-muted-foreground">Texto libre · no afecta inventario</span>
                        : !fisico ? <span className="text-sky-700">Servicio del catálogo · no suma stock</span>
                        : <>
                          <span className="text-primary flex items-center gap-1"><Boxes className="h-3 w-3" />Producto del catálogo · ingresa a</span>
                          <Select value={l.bodegaDestinoId || SIN_BODEGA} onValueChange={(v) => update(l.key, { bodegaDestinoId: v === SIN_BODEGA ? "" : v })}>
                            <SelectTrigger className={`h-7 w-56 text-xs ${l.bodegaDestinoId ? "" : "border-amber-400"}`} data-testid={`select-compra-bodega-${i}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SIN_BODEGA}>Elegir bodega</SelectItem>
                              {bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.localNombre} → {b.nombre}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <button type="button" className="text-muted-foreground underline" onClick={() => setLineas((ls) => { const idx = ls.findIndex((x) => x.key === l.key); const copia = { ...l, key: nuevaKeyCompra(), cantidad: "1", bodegaDestinoId: "" }; return [...ls.slice(0, idx + 1), copia, ...ls.slice(idx + 1)]; })} data-testid={`button-compra-dividir-${i}`}>Dividir en otra bodega</button>
                        </>}
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={() => setLineas((ls) => [...ls, lineaLibreCompra()])} className="w-full rounded-md border border-dashed py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"><Plus className="inline h-3 w-3 mr-1" />Agregar línea</button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Notas</CardTitle></CardHeader>
            <CardContent><Textarea value={notas} maxLength={5000} onChange={(e) => setNotas(e.target.value)} placeholder="Guía de despacho, condiciones de pago, observaciones de la recepción..." className="resize-none h-24" data-testid="input-notas-compra" /></CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Moneda e IVA</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs">Moneda{monedaFija && <Lock className="h-3 w-3 text-muted-foreground" />}</Label>
                  <Select value={moneda} onValueChange={(v) => cambiarMoneda(v as Moneda)} disabled={monedaFija}>
                    <SelectTrigger data-testid="select-moneda-compra"><SelectValue /></SelectTrigger>
                    <SelectContent>{MONEDAS.map((m) => <SelectItem key={m} value={m}>{m} · {MONEDA_INFO[m].simbolo}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs">Decimales<Lock className="h-3 w-3 text-muted-foreground" /></Label>
                  <p className="h-10 flex items-center rounded-md border bg-muted/30 px-3 font-mono text-sm" data-testid="text-decimales-compra">{decimales}</p>
                </div>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">IVA %</Label><Input type="number" min="0" max="100" step="0.01" value={iva} onChange={(e) => setIva(e.target.value)} className="font-mono" data-testid="input-iva-compra" /></div>
              <p className="text-[11px] text-muted-foreground">{monedaFija ? "Moneda y decimales quedan fijos desde el primer guardado." : "Los decimales los define el servidor según tu configuración al guardar."}</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm overflow-hidden border-primary/20">
            <div className="bg-primary/5 p-5 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono tabular-nums" data-testid="text-compra-subtotal">{fmt(tot.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IVA ({ivaPct}%)</span><span className="font-mono tabular-nums" data-testid="text-compra-iva">{fmt(tot.iva)}</span></div>
              <div className="flex items-baseline justify-between border-t border-primary/20 pt-3 mt-1"><span className="font-semibold">Total</span><span className="font-mono text-2xl font-bold text-primary tabular-nums" data-testid="text-compra-total">{fmt(tot.total)}</span></div>
              <p className="text-[11px] text-muted-foreground">Vista previa; el servidor calcula los montos definitivos.</p>
            </div>
            <div className="p-4 space-y-2 border-t">
              {error && <p className="rounded-md bg-red-50 border border-red-200 px-2.5 py-2 text-xs text-red-700" data-testid="text-compra-error">{error}</p>}
              <Button className="w-full" variant="outline" onClick={() => ejecutar("guardar")} disabled={ocupado} data-testid="button-guardar-compra">
                {accion === "guardar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Guardar borrador
              </Button>
              <Button className="w-full" onClick={() => ejecutar("recibir")} disabled={ocupado || !puedeRecibir} data-testid="button-confirmar-recepcion">
                {accion === "recibir" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-2" />}Confirmar recepción
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">{puedeRecibir ? "Guarda el borrador y luego revisa los cambios de costo antes de ingresar stock." : "Solo administradores y supervisores confirman recepciones. Guarda el borrador para que lo revisen."}</p>
            </div>
          </Card>
        </div>
      </div>

      <ProveedorDialog open={provOpen} onOpenChange={setProvOpen} onSaved={(p) => setProveedorId(String(p.id))} />
      <ProductoRapidoDialog open={rapido !== null} onOpenChange={(o) => { if (!o) setRapido(null); }} codigo={rapido ?? ""} moneda={moneda} bodegas={bodegas} bodegaSugerida={bodegaGlobal} onCreated={(p) => { agregarProducto(p); toast({ title: "Producto creado", description: p.nombre }); }} />
      {guardada && (
        <RecepcionCompraDialog compra={guardada} open={recepcionOpen} onOpenChange={setRecepcionOpen}
          onRecibida={(r) => { toast({ title: "Recepción confirmada", description: `Factura ${r.numeroFactura} recibida.` }); navigate(`/compras/${r.id}`); }} />
      )}
    </div>
  );
}
