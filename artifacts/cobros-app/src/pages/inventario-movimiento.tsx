import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProducto,
  getGetProductoQueryKey,
  useListMovimientosStock,
  getListMovimientosStockQueryKey,
  useCreateMovimientoStock,
  useListInventario,
  getListInventarioQueryKey,
  useListBodegas,
  getListBodegasQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScanLookup } from "@/components/barcode-scanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import {
  apiErrorMessage, estadoVisual, etiquetaUbicacion, formatQty, invalidateInventario,
  MOTIVO_AJUSTE, MOTIVO_ENTRE_BODEGAS, MOTIVOS_ENTRADA, MOTIVOS_SALIDA,
} from "@/lib/inventario";
import { EstadoStockBadge } from "@/components/inventario-badges";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Loader2, Pencil, RotateCw, Scale } from "lucide-react";

type TipoMov = "entrada" | "salida" | "ajuste";
const TIPOS: { v: TipoMov; label: string; desc: string; Icon: typeof Scale }[] = [
  { v: "entrada", label: "Entrada", desc: "Compra o recepción", Icon: ArrowDownToLine },
  { v: "salida", label: "Salida", desc: "Merma, consumo o traslado", Icon: ArrowUpFromLine },
  { v: "ajuste", label: "Ajuste", desc: "Conteo físico", Icon: Scale },
];

export default function InventarioMovimientoPage() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: producto, isLoading, isError, refetch } = useGetProducto(id, { query: { enabled: !!id, queryKey: getGetProductoQueryKey(id), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const movs = useListMovimientosStock(id, { query: { enabled: !!id, queryKey: getListMovimientosStockQueryKey(id), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const crear = useCreateMovimientoStock();

  const [tipo, setTipo] = useState<TipoMov>("entrada");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [origenId, setOrigenId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [, setLocation] = useLocation();
  const inventario = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const bodegasQ = useListBodegas({ query: { queryKey: getListBodegasQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const bodegas = bodegasQ.data ?? [];
  const hayBodegas = bodegas.length > 0;

  // Reset form when navigating to another product via scan.
  useEffect(() => { setCantidad(""); if (tipo !== "ajuste") setMotivo(""); setOrigenId(""); setDestinoId(""); }, [id]);
  useEffect(() => { if (tipo === "ajuste") setMotivo(MOTIVO_AJUSTE); else setMotivo(""); }, [tipo]);

  const entreBodegas = tipo !== "ajuste" && motivo === MOTIVO_ENTRE_BODEGAS;
  const usaOrigen = hayBodegas && (tipo === "salida" || entreBodegas);
  const usaDestino = hayBodegas && (tipo === "entrada" || tipo === "ajuste" || entreBodegas);
  const stockEn = (bid: string) => (producto?.ubicaciones ?? []).find((u) => String(u.bodegaId) === bid)?.stockActual ?? 0;
  const motivos: readonly string[] = tipo === "entrada" ? MOTIVOS_ENTRADA : tipo === "salida" ? MOTIVOS_SALIDA : [MOTIVO_AJUSTE];

  const stockTotal = producto?.stockActual ?? 0;
  const stock = !hayBodegas ? stockTotal : entreBodegas || tipo === "salida" ? (origenId ? stockEn(origenId) : 0) : destinoId ? stockEn(destinoId) : 0;
  const cant = cantidad.trim() === "" ? NaN : Number(cantidad);
  const resultante = Number.isNaN(cant) ? null : entreBodegas ? stock - cant : tipo === "entrada" ? stock + cant : tipo === "salida" ? stock - cant : cant;
  const mismaBodega = entreBodegas && !!origenId && origenId === destinoId;
  const faltaBodega = (usaOrigen && !origenId) || (usaDestino && !destinoId);
  const invalido =
    Number.isNaN(cant) || cant < 0 || (tipo !== "ajuste" && cant <= 0) ||
    ((tipo === "salida" || entreBodegas) && cant > stock) || !motivo || faltaBodega || mismaBodega;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalido) return;
    crear.mutate({ id, data: {
      tipo, cantidad: cant, motivo,
      bodegaOrigenId: usaOrigen ? Number(origenId) : null,
      bodegaDestinoId: usaDestino ? Number(destinoId) : null,
    } }, {
      onSuccess: (p) => {
        qc.setQueryData(getGetProductoQueryKey(id), p);
        invalidateInventario(qc, id);
        setCantidad(""); setMotivo("");
        toast({ title: "Movimiento registrado", description: `Stock actual: ${formatQty(p.stockActual ?? 0)}` });
      },
      onError: (err) => toast({ title: "No se pudo registrar", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="max-w-5xl mx-auto animate-pulse space-y-4"><div className="h-8 w-60 bg-muted rounded" /><div className="h-64 bg-muted/60 rounded-xl" /></div>;
  if (isError || !producto) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No pudimos cargar este producto.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/inventario">Volver</Link></Button>
        </div>
      </div>
    );
  }
  if (producto.tipo === "servicio") {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">Los servicios no manejan stock.</p>
        <Button asChild size="sm"><Link href={`/inventario/${id}/editar`}>Editar servicio</Link></Button>
      </div>
    );
  }

  const unidad = producto.unidadMedida || "un";

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/inventario" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />Volver al inventario
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{producto.nombre}</h1>
          <div className="mt-2 flex items-center gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums">{formatQty(stockTotal)}</span>
            <span className="text-sm text-muted-foreground">{unidad} en stock · crítico en {formatQty(producto.stockCritico)}</span>
            <EstadoStockBadge estado={estadoVisual(producto)} />
          </div>
        </div>
        <div className="w-full sm:w-80 order-last sm:order-none">
          <ScanLookup productos={(inventario.data ?? []).filter((p) => p.tipo === "producto")} testId="scanner-movimiento" label="Escanear otro producto"
            onSelect={(p) => { if (p.id !== id) setLocation(`/inventario/${p.id}/movimiento`); }} />
        </div>
        <Button asChild variant="outline" size="sm"><Link href={`/inventario/${id}/editar`}><Pencil className="h-4 w-4 mr-1.5" />Editar producto</Link></Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card className="shadow-sm h-fit">
          <CardHeader className="pb-3"><CardTitle className="text-base">Registrar movimiento</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-3 gap-1.5">
                {TIPOS.map(({ v, label, Icon }) => (
                  <button key={v} type="button" onClick={() => setTipo(v)}
                    className={`rounded-lg border px-2 py-2.5 text-sm font-medium flex flex-col items-center gap-1 transition-colors ${tipo === v ? "border-primary bg-primary/5 text-primary" : "border-border/60 text-muted-foreground hover:bg-secondary/50"}`}>
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground -mt-2">{TIPOS.find((t) => t.v === tipo)!.desc}</p>
              <div className="space-y-1.5">
                <Label>Motivo</Label>
                {tipo === "ajuste" ? (
                  <div className="h-10 rounded-md border bg-muted/40 px-3 flex items-center text-sm" data-testid="text-motivo-ajuste">{MOTIVO_AJUSTE}</div>
                ) : (
                  <Select value={motivo} onValueChange={setMotivo}>
                    <SelectTrigger data-testid="select-motivo"><SelectValue placeholder="Selecciona un motivo" /></SelectTrigger>
                    <SelectContent>{motivos.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {tipo === "salida" && <p className="text-[11px] text-muted-foreground">Las salidas por Cobro se registran solas al pagarse un cobro.</p>}
              </div>
              {usaOrigen && (
                <div className="space-y-1.5">
                  <Label>{entreBodegas ? "Bodega de origen" : "Bodega de salida"}</Label>
                  <Select value={origenId} onValueChange={setOrigenId}>
                    <SelectTrigger data-testid="select-bodega-origen"><SelectValue placeholder="Selecciona bodega" /></SelectTrigger>
                    <SelectContent>{bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{etiquetaUbicacion({ localNombre: b.localNombre, bodegaNombre: b.nombre })} · {formatQty(stockEn(String(b.id)))}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {usaDestino && (
                <div className="space-y-1.5">
                  <Label>{entreBodegas ? "Bodega de destino" : tipo === "ajuste" ? "Bodega contada" : "Bodega de entrada"}</Label>
                  <Select value={destinoId} onValueChange={setDestinoId}>
                    <SelectTrigger data-testid="select-bodega-destino"><SelectValue placeholder="Selecciona bodega" /></SelectTrigger>
                    <SelectContent>{bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{etiquetaUbicacion({ localNombre: b.localNombre, bodegaNombre: b.nombre })} · {formatQty(stockEn(String(b.id)))}</SelectItem>)}</SelectContent>
                  </Select>
                  {mismaBodega && <p className="text-xs text-red-600">Origen y destino deben ser bodegas distintas.</p>}
                </div>
              )}
              {entreBodegas && hayBodegas && <p className="text-[11px] text-muted-foreground -mt-2">Se registra como un solo movimiento: descuenta del origen y suma al destino.</p>}
              <div className="space-y-1.5">
                <Label>{tipo === "ajuste" ? "Stock final contado" : "Cantidad"}</Label>
                <Input type="number" min="0" step="any" className="font-mono" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
                {(tipo === "salida" || entreBodegas) && !Number.isNaN(cant) && cant > stock && <p className="text-xs text-red-600">Stock insuficiente: solo hay {formatQty(stock)} {unidad}.</p>}
              </div>

              {resultante != null && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm flex justify-between font-mono">
                  <span className="text-muted-foreground font-sans">{hayBodegas ? (entreBodegas ? "Origen quedará en" : "Bodega quedará en") : "Quedará en"}</span>
                  <span className={resultante < 0 ? "text-red-600 font-bold" : "font-bold"}>{formatQty(resultante)} {unidad}</span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={invalido || crear.isPending}>
                {crear.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Registrando...</> : "Registrar"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Historial</CardTitle></CardHeader>
          <CardContent className="p-0">
            {movs.isLoading ? (
              <div className="p-5 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
            ) : movs.isError ? (
              <div className="p-8 text-center space-y-2"><p className="text-sm">No se pudo cargar el historial.</p><Button size="sm" variant="outline" onClick={() => movs.refetch()}>Reintentar</Button></div>
            ) : (movs.data ?? []).length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">Aún no hay movimientos para este producto.</p>
            ) : (
              <ul className="divide-y">
                {movs.data!.map((m) => {
                  const delta = m.tipo === "salida" ? -m.cantidad : m.cantidad;
                  return (
                    <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                      <span className={`mt-0.5 h-7 w-7 shrink-0 rounded-full flex items-center justify-center ${delta < 0 ? "bg-red-50 text-red-600" : delta > 0 ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                        {m.tipo === "entrada" ? <ArrowDownToLine className="h-3.5 w-3.5" /> : m.tipo === "salida" ? <ArrowUpFromLine className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium capitalize">{m.tipo}{m.referenciaCobroId && <> · <Link href={`/cobros/${m.referenciaCobroId}`} className="text-primary hover:underline normal-case">Cobro #{m.referenciaCobroId}</Link></>}</p>
                        <p className="text-sm text-muted-foreground break-words">{m.motivo}</p>
                        {(m.bodegaOrigenId || m.bodegaDestinoId) && (
                          <p className="text-[11px] text-muted-foreground">
                            {[m.bodegaOrigenId, m.bodegaDestinoId].map((b) => (b ? bodegas.find((x) => x.id === b)?.nombre ?? `Bodega #${b}` : null)).filter(Boolean).join(" → ")}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5">{formatDate(m.creadoEn)}</p>
                      </div>
                      <span className={`font-mono font-semibold tabular-nums ${delta < 0 ? "text-red-600" : delta > 0 ? "text-emerald-700" : ""}`}>{delta > 0 ? "+" : ""}{formatQty(delta)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
