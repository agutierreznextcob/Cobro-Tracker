import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCompra, getGetCompraQueryKey, useDeleteCompra, useContabilizarCompra, useListBodegas, getListBodegasQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EstadoCompraBadge } from "@/components/estado-compra-badge";
import { RecepcionCompraDialog } from "@/components/recepcion-compra-dialog";
import { CompraDevoluciones } from "@/components/compra-devoluciones";
import { EquivalenciaCLP } from "@/components/equivalencia-clp";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { apiErrorMessage, formatQty } from "@/lib/inventario";
import { invalidateCompras, itemsDe, ORIGEN_COMPRA } from "@/lib/compras";
import { ArrowLeft, BookCheck, Boxes, CheckCircle2, Loader2, PackageCheck, Pencil, RotateCw, Trash2 } from "lucide-react";

export default function CompraDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useGetCompra(id, { query: { enabled: !!id, queryKey: getGetCompraQueryKey(id), staleTime: 0, refetchOnMount: "always" } });
  const bodQ = useListBodegas({ query: { queryKey: getListBodegasQueryKey() } });
  const eliminar = useDeleteCompra();
  const contabilizar = useContabilizarCompra();
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmCont, setConfirmCont] = useState(false);
  const [recepcion, setRecepcion] = useState(false);

  if (q.isLoading) return <div className="max-w-5xl mx-auto space-y-4 animate-pulse"><div className="h-8 w-64 bg-muted rounded" /><div className="h-80 bg-muted/60 rounded-xl" /></div>;
  if (q.isError || !q.data) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos esta compra.</p>
        <p className="text-sm text-muted-foreground">{apiErrorMessage(q.error, "")}</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/compras">Volver</Link></Button>
        </div>
      </div>
    );
  }
  const c = q.data;
  const fmt = (n: number) => formatMoney(n, c.moneda, c.decimales);
  const bodega = (bid?: number | null) => { const b = (bodQ.data ?? []).find((x) => x.id === bid); return b ? `${b.localNombre} → ${b.nombre}` : bid ? `Bodega #${bid}` : null; };
  const borrador = c.estado === "borrador";

  const doDelete = async () => {
    try {
      await eliminar.mutateAsync({ id: c.id });
      invalidateCompras(qc);
      toast({ title: "Borrador eliminado", description: `Factura ${c.numeroFactura}` });
      navigate("/compras");
    } catch (err) { toast({ title: "No se pudo eliminar", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }); }
  };
  const doContabilizar = async () => {
    try {
      const res = await contabilizar.mutateAsync({ id: c.id });
      qc.setQueryData(getGetCompraQueryKey(res.id), res);
      invalidateCompras(qc);
      toast({ title: "Marcada como contabilizada" });
    } catch (err) { toast({ title: "No se pudo marcar", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/compras" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Volver a compras</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Factura de compra · {ORIGEN_COMPRA[c.origen] ?? c.origen}{c.siiFolio ? ` · Folio SII ${c.siiFolio}` : ""}</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex flex-wrap items-center gap-3"><span className="font-mono" data-testid="text-numero-factura">{c.numeroFactura}</span><EstadoCompraBadge estado={c.estado} /></h1>
          <p className="text-sm"><Link href={`/proveedores/${c.proveedorId}`} className="font-medium text-primary hover:underline" data-testid="link-proveedor">{c.proveedorNombre}</Link></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {borrador && <>
            <Button variant="outline" size="sm" onClick={() => setConfirmDel(true)} className="text-red-700 hover:text-red-800" data-testid="button-eliminar-compra"><Trash2 className="h-4 w-4 mr-1.5" />Eliminar</Button>
            <Button asChild variant="outline" size="sm" data-testid="button-editar-compra"><Link href={`/compras/${c.id}/editar`}><Pencil className="h-4 w-4 mr-1.5" />Editar</Link></Button>
            {c.puedeRecibir && <Button size="sm" onClick={() => setRecepcion(true)} data-testid="button-recibir-compra"><PackageCheck className="h-4 w-4 mr-1.5" />Confirmar recepción</Button>}
          </>}
          {c.estado === "recibida" && c.puedeRecibir && (
            <Button variant="outline" size="sm" onClick={() => setConfirmCont(true)} disabled={contabilizar.isPending} data-testid="button-contabilizar-compra">
              {contabilizar.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <BookCheck className="h-4 w-4 mr-1.5" />}Marcar como contabilizada
            </Button>
          )}
        </div>
      </div>
      {borrador && !c.puedeRecibir && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Este borrador espera que un administrador o supervisor confirme la recepción.</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Ítems ({c.items.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {itemsDe(c).map((it, i) => {
              const fisico = it.productoId != null && it.tipoProducto !== "servicio";
              return (
                <div key={it.id} className="grid grid-cols-[1fr_auto] gap-3 px-5 py-3 border-t text-sm" data-testid={`row-detalle-item-${i}`}>
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">{it.productoId ? <Link href={`/inventario/${it.productoId}/editar`} className="hover:underline">{it.descripcion}</Link> : it.descripcion}</p>
                    <p className="text-xs text-muted-foreground font-mono">{formatQty(it.cantidad)} × {fmt(it.precioUnitario)}</p>
                    <p className="text-[11px] flex flex-wrap items-center gap-x-2">
                      {it.productoId == null ? <span className="text-muted-foreground">Texto libre · sin inventario</span>
                        : !fisico ? <span className="text-sky-700">Servicio · sin stock</span>
                        : <span className="text-primary flex items-center gap-1"><Boxes className="h-3 w-3" />{bodega(it.bodegaDestinoId) ?? "Sin bodega"}{c.estado !== "borrador" ? " · stock ingresado" : ""}</span>}
                      {it.costoActualizado && <span className="text-emerald-700 flex items-center gap-1" data-testid={`text-costo-actualizado-${i}`}><CheckCircle2 className="h-3 w-3" />Costo actualizado{it.costoAnterior != null ? ` (antes ${fmt(it.costoAnterior)})` : ""}</span>}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums font-medium">{fmt(it.subtotalLinea)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card className="shadow-sm overflow-hidden border-primary/20">
            <div className="bg-primary/5 p-5 pr-20 sm:pr-5 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{fmt(c.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IVA ({c.porcentajeIva}%)</span><span className="font-mono">{fmt(c.montoIva)}</span></div>
              <div className="flex items-baseline justify-between border-t border-primary/20 pt-3"><span className="font-semibold">Total</span><span className="font-mono text-2xl font-bold text-primary" data-testid="text-total-compra">{fmt(c.total)}</span></div>
              {c.moneda !== "CLP" && <EquivalenciaCLP monto={c.total} moneda={c.moneda} decimales={c.decimales} compact testId="equivalencia-clp-compra" />}
            </div>
          </Card>
          <Card className="shadow-sm"><CardContent className="p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Emisión</span><span>{formatDateOnly(c.fechaEmision)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Recepción</span><span>{formatDateOnly(c.fechaRecepcion)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Ítems con stock recibido</span><span className="font-mono">{c.itemsRecibidos} / {c.items.length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Moneda</span><span className="font-mono">{c.moneda} · {c.decimales} dec.</span></div>
            {c.notas && <p className="pt-2 border-t text-muted-foreground whitespace-pre-wrap">{c.notas}</p>}
          </CardContent></Card>
        </div>
      </div>

      {!borrador && <CompraDevoluciones compra={c} />}
      <RecepcionCompraDialog compra={c} open={recepcion} onOpenChange={setRecepcion} onRecibida={() => toast({ title: "Recepción confirmada", description: "Stock ingresado y costos actualizados desde la factura." })} />

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Eliminar borrador {c.numeroFactura}</AlertDialogTitle><AlertDialogDescription>No afecta inventario. Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={doDelete} className="bg-red-600 hover:bg-red-700" data-testid="button-confirmar-eliminar-compra">Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmCont} onOpenChange={setConfirmCont}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Marcar como contabilizada</AlertDialogTitle><AlertDialogDescription>Es solo una marca interna para indicar que tu contador ya registró la factura. No envía nada al SII ni modifica stock.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={doContabilizar} data-testid="button-confirmar-contabilizar">Marcar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
