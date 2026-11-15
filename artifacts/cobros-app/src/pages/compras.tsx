import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListCompras, getListComprasQueryKey, useListProveedores, getListProveedoresQueryKey, type ListComprasParams } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EstadoCompraBadge } from "@/components/estado-compra-badge";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { apiErrorMessage } from "@/lib/inventario";
import { ORIGEN_COMPRA, SII_TOOLTIP } from "@/lib/compras";
import { CloudDownload, FileInput, Plus, RotateCw, Truck, X } from "lucide-react";

const TODOS = "__all";

export default function ComprasPage() {
  const [, navigate] = useLocation();
  const [proveedorId, setProveedorId] = useState(TODOS);
  const [estado, setEstado] = useState(TODOS);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const params = useMemo<ListComprasParams | undefined>(() => {
    const p: ListComprasParams = {};
    if (proveedorId !== TODOS) p.proveedorId = Number(proveedorId);
    if (estado !== TODOS) p.estado = estado as ListComprasParams["estado"];
    if (desde) p.desde = desde;
    if (hasta) p.hasta = hasta;
    return Object.keys(p).length ? p : undefined;
  }, [proveedorId, estado, desde, hasta]);

  const q = useListCompras(params, { query: { queryKey: getListComprasQueryKey(params), staleTime: 0, refetchOnMount: "always" } });
  const provQ = useListProveedores({ query: { queryKey: getListProveedoresQueryKey() } });
  const compras = q.data ?? [];
  const filtrando = !!params;

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Ventas · Abastecimiento</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Compras</h1>
          <p className="text-sm text-muted-foreground">Facturas de proveedores y su recepción en bodega.</p>
        </div>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild><span tabIndex={0} data-testid="wrap-importar-sii"><Button variant="outline" disabled data-testid="button-importar-sii"><CloudDownload className="h-4 w-4 mr-1.5" />Importar desde SII</Button></span></TooltipTrigger>
            <TooltipContent>{SII_TOOLTIP}</TooltipContent>
          </Tooltip>
          <Button asChild data-testid="button-nueva-compra"><Link href="/compras/nueva"><Plus className="h-4 w-4 mr-1.5" />Nueva compra</Link></Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_160px_auto] items-end">
        <div className="space-y-1"><Label className="text-xs">Proveedor</Label>
          <Select value={proveedorId} onValueChange={setProveedorId}>
            <SelectTrigger data-testid="filter-proveedor"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todos los proveedores</SelectItem>{(provQ.data ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.razonSocial}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Estado</Label>
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger data-testid="filter-estado-compra"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todos</SelectItem><SelectItem value="borrador">Borrador</SelectItem><SelectItem value="recibida">Recibida</SelectItem><SelectItem value="contabilizada">Contabilizada</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} data-testid="filter-desde" /></div>
        <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" min={desde} value={hasta} onChange={(e) => setHasta(e.target.value)} data-testid="filter-hasta" /></div>
        <Button variant="ghost" size="sm" disabled={!filtrando} onClick={() => { setProveedorId(TODOS); setEstado(TODOS); setDesde(""); setHasta(""); }} data-testid="button-limpiar-filtros"><X className="h-4 w-4 mr-1" />Limpiar</Button>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-14 rounded-lg bg-muted/60 animate-pulse" />)}</div>
      ) : q.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-2">
          <p className="text-sm text-red-800">{apiErrorMessage(q.error, "No se pudieron cargar las compras.")}</p>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
        </div>
      ) : compras.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 grid place-items-center"><Truck className="h-6 w-6 text-primary" /></div>
          <p className="font-medium">{filtrando ? "Ninguna compra coincide con los filtros." : "Aún no registras compras."}</p>
          <p className="text-sm text-muted-foreground">{filtrando ? "Ajusta o limpia los filtros." : "Ingresa la primera factura de proveedor y recibe su mercadería en bodega."}</p>
          {!filtrando && <Button asChild size="sm"><Link href="/compras/nueva"><FileInput className="h-4 w-4 mr-1.5" />Ingresar factura</Link></Button>}
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="hidden md:grid grid-cols-[120px_1fr_100px_120px_80px_110px_140px] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
            <span>N° factura</span><span>Proveedor</span><span>Fecha</span><span>Estado</span><span>Origen</span><span>Ítems recibidos</span><span className="text-right">Total</span>
          </div>
          {compras.map((c) => (
            <button key={c.id} type="button" onClick={() => navigate(`/compras/${c.id}`)} className="w-full grid grid-cols-2 md:grid-cols-[120px_1fr_100px_120px_80px_110px_140px] gap-x-3 gap-y-1 px-4 py-3 text-left text-sm border-b last:border-0 hover:bg-muted/40 transition-colors items-center" data-testid={`row-compra-${c.id}`}>
              <span className="font-mono font-medium">{c.numeroFactura}</span>
              <span className="truncate md:order-none order-first col-span-2 md:col-span-1 font-medium">{c.proveedorNombre}</span>
              <span className="text-muted-foreground">{formatDateOnly(c.fechaEmision)}</span>
              <span><EstadoCompraBadge estado={c.estado} /></span>
              <span className="text-xs text-muted-foreground" data-testid={`text-origen-${c.id}`}>{ORIGEN_COMPRA[c.origen] ?? c.origen}</span>
              <span className="text-xs font-mono" title="Líneas de productos ingresadas a inventario; no incluye servicios ni ítems libres" data-testid={`text-recibidos-${c.id}`}>{c.itemsRecibidos}</span>
              <span className="font-mono font-semibold text-right tabular-nums col-span-2 md:col-span-1">{formatMoney(c.total, c.moneda, c.decimales)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
