import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListInventario, getListInventarioQueryKey, useListBodegas, getListBodegasQueryKey, type Producto, type StockUbicacion } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency } from "@/lib/format";
import { estadoVisual, formatQty } from "@/lib/inventario";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScanLookup } from "@/components/barcode-scanner";
import { useToast } from "@/hooks/use-toast";
import { Boxes, Plus, Search, Trash2 } from "lucide-react";

export type LineaCatalogo = {
  productoId: number;
  nombre: string;
  tipo: "producto" | "servicio";
  cantidad: string;
  precioUnitario: string;
  stockActual: number | null;
  /** Bodega id as string; empty/undefined = server picks the bodega with the most stock. */
  bodegaId?: string;
  ubicaciones?: StockUbicacion[];
};

export function lineaDesdeProducto(p: Producto): LineaCatalogo {
  return { productoId: p.id, nombre: p.nombre, tipo: p.tipo as "producto" | "servicio", cantidad: "1", precioUnitario: String(p.precioUnitario), stockActual: p.stockActual ?? null, bodegaId: "", ubicaciones: p.ubicaciones ?? [] };
}

export const MAX_LINEAS = 100;

export function totalLineas(lineas: LineaCatalogo[]) {
  return Math.round(lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0));
}

export function lineasValidas(lineas: LineaCatalogo[]) {
  return lineas.every((l) => Number(l.cantidad) > 0 && Number(l.precioUnitario) >= 0 && l.precioUnitario.trim() !== "");
}

export function lineasPayload(lineas: LineaCatalogo[]) {
  return lineas.map((l) => ({
    productoId: l.productoId,
    cantidad: Number(l.cantidad),
    precioUnitario: Number(l.precioUnitario),
    ...(l.tipo === "producto" && l.bodegaId ? { bodegaId: Number(l.bodegaId) } : {}),
  }));
}

export function CatalogoLineas({ lineas, onChange, incluyeIva }: { lineas: LineaCatalogo[]; onChange: (l: LineaCatalogo[]) => void; incluyeIva: boolean }) {
  const { data: productos, isLoading, isError, refetch } = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const { data: bodegas = [] } = useListBodegas({ query: { queryKey: getListBodegasQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { toast } = useToast();

  const agregarEscaneado = (p: Producto) => {
    if (!p.activo) { toast({ title: "Ítem archivado", description: `${p.nombre} no está disponible para cobros.`, variant: "destructive" }); return; }
    const i = lineas.findIndex((l) => l.productoId === p.id);
    if (i >= 0) {
      onChange(lineas.map((l, j) => (j === i ? { ...l, cantidad: String((Number(l.cantidad) || 0) + 1) } : l)));
    } else {
      if (lineas.length >= MAX_LINEAS) { toast({ title: "Límite de ítems alcanzado", variant: "destructive" }); return; }
      onChange([...lineas, lineaDesdeProducto(p)]);
    }
  };

  const disponibles = useMemo(() => {
    const usados = new Set(lineas.map((l) => l.productoId));
    const s = q.trim().toLowerCase();
    return (productos ?? []).filter((p) => p.activo && !usados.has(p.id) && (!s || p.nombre.toLowerCase().includes(s))).slice(0, 50);
  }, [productos, lineas, q]);

  const update = (i: number, patch: Partial<LineaCatalogo>) => onChange(lineas.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = totalLineas(lineas);

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5" />Ítems del catálogo (opcional)</p>
          <p className="text-xs text-muted-foreground">Al agregar ítems, el monto{incluyeIva ? " neto" : ""} se calcula solo. El stock se descuenta cuando el cobro se pague.</p>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={lineas.length >= MAX_LINEAS}><Plus className="h-3.5 w-3.5 mr-1" />Agregar</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o servicio" className="pl-8 h-9" />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {isLoading ? (
                <div className="space-y-1.5 p-1">{[1, 2, 3].map((i) => <div key={i} className="h-9 rounded bg-muted animate-pulse" />)}</div>
              ) : isError ? (
                <div className="p-3 text-center text-sm">No se pudo cargar el catálogo. <button type="button" className="text-primary underline" onClick={() => refetch()}>Reintentar</button></div>
              ) : disponibles.length === 0 ? (
                <div className="p-3 text-center text-sm text-muted-foreground">
                  {(productos ?? []).some((p) => p.activo) ? "Sin coincidencias." : <>Tu catálogo está vacío. <Link href="/inventario/nuevo" className="text-primary underline">Crear ítem</Link></>}
                </div>
              ) : disponibles.map((p) => {
                const e = estadoVisual(p);
                return (
                  <button key={p.id} type="button"
                    onClick={() => {
                      onChange([...lineas, lineaDesdeProducto(p)]);
                      setOpen(false); setQ("");
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.nombre}</span>
                      <span className={`text-[11px] ${e === "critico" || e === "agotado" ? "text-red-600" : "text-muted-foreground"}`}>
                        {p.tipo === "servicio" ? "Servicio" : `Stock ${formatQty(p.stockActual ?? 0)}`}
                      </span>
                    </span>
                    <span className="font-mono text-xs shrink-0">{formatCurrency(p.precioUnitario)}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <ScanLookup productos={productos} onSelect={agregarEscaneado} testId="scanner-cobro" label="Escanear producto para agregarlo" autoActivate={false} />

      {lineas.length > 0 && (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[1fr_80px_120px_100px_32px] gap-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>Ítem</span><span>Cant.</span><span>Precio unit.</span><span className="text-right">Subtotal</span><span />
          </div>
          {lineas.map((l, i) => {
            const cant = Number(l.cantidad) || 0;
            const current = productos?.find(p => p.id === l.productoId);
            const ubic = current?.ubicaciones ?? l.ubicaciones ?? [];
            const disp = l.bodegaId ? ubic.find((u) => String(u.bodegaId) === l.bodegaId)?.stockActual ?? 0
              : bodegas.length ? Math.max(...bodegas.map(b => ubic.find(u => u.bodegaId === b.id)?.stockActual ?? 0)) : current?.stockActual ?? l.stockActual;
            const sinStock = l.tipo === "producto" && disp != null && cant > disp;
            return (
              <div key={l.productoId} className="grid grid-cols-[1fr_32px] sm:grid-cols-[1fr_80px_120px_100px_32px] gap-2 items-center rounded-md bg-muted/30 p-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{l.nombre}</p>
                  <p className={`text-[11px] ${sinStock ? "text-amber-700" : "text-muted-foreground"}`}>
                    {l.tipo === "servicio" ? "Servicio" : sinStock ? `Stock disponible ${formatQty(disp ?? 0)}; quedará negativo al pagarse` : "Producto"}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 sm:order-last text-muted-foreground hover:text-red-600" onClick={() => onChange(lineas.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 className="h-4 w-4" /></Button>
                <Input type="number" min="0" step="any" value={l.cantidad} onChange={(e) => update(i, { cantidad: e.target.value })} className="h-8 font-mono col-span-1" />
                <div className="relative"><span className="absolute left-2 top-1.5 text-xs text-muted-foreground">$</span>
                  <Input type="number" min="0" step="1" value={l.precioUnitario} onChange={(e) => update(i, { precioUnitario: e.target.value })} className="h-8 pl-5 font-mono" /></div>
                <span className="font-mono text-sm text-right col-span-2 sm:col-span-1">{formatCurrency(cant * (Number(l.precioUnitario) || 0))}</span>
                {l.tipo === "producto" && bodegas.length > 0 && (
                  <div className="col-span-2 sm:col-span-5">
                    <Select value={l.bodegaId || "auto"} onValueChange={(v) => update(i, { bodegaId: v === "auto" ? "" : v })}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-bodega-linea-${l.productoId}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Descontar de la bodega con más stock (automático)</SelectItem>
                        {bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.localNombre} → {b.nombre} · {formatQty(ubic.find(u => u.bodegaId === b.id)?.stockActual ?? 0)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-between border-t pt-2 text-sm">
            <span className="text-muted-foreground">{lineas.length} ítem{lineas.length === 1 ? "" : "s"} · Total{incluyeIva ? " neto" : ""}</span>
            <span className="font-mono font-bold text-primary">{formatCurrency(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
