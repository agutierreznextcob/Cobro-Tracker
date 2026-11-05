import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  previewRecepcionCompra, useRecibirCompra, getGetCompraQueryKey,
  type Compra, type CompraRecepcionPreview,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { apiErrorMessage, invalidateInventario, invalidateNotificaciones } from "@/lib/inventario";
import { errorStatus, invalidateCompras, itemsDe } from "@/lib/compras";
import { ArrowRight, Info, Loader2, PackageCheck, RotateCw } from "lucide-react";

/**
 * Loads the receipt preview, shows (read-only) which product costs will be updated automatically
 * and posts the receipt with only the preview version. On 409 the preview is reloaded.
 */
export function RecepcionCompraDialog({ compra, open, onOpenChange, onRecibida }: {
  compra: Pick<Compra, "id" | "numeroFactura" | "moneda" | "decimales" | "items">; open: boolean; onOpenChange: (o: boolean) => void; onRecibida: (c: Compra) => void;
}) {
  const qc = useQueryClient();
  const recibir = useRecibirCompra();
  const [preview, setPreview] = useState<CompraRecepcionPreview | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const idRef = useRef(compra.id);
  idRef.current = compra.id;

  const cargar = async () => {
    setCargando(true); setError(null);
    try { setPreview(await previewRecepcionCompra(idRef.current)); }
    catch (err) { setPreview(null); setError(apiErrorMessage(err, "No se pudo preparar la recepción.")); }
    finally { setCargando(false); }
  };

  useEffect(() => { if (open) { setAviso(null); cargar(); } }, [open, compra.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambios = preview?.cambiosCostos ?? [];
  // Preserve fractional historical costs so old/new never appear identical.
  const fmt = (n: number) => formatMoney(n, compra.moneda,
    Math.round(n * 10 ** compra.decimales) / 10 ** compra.decimales === n ? compra.decimales : 2);
  const lineasStock = itemsDe(compra).filter((i) => i.productoId != null && i.tipoProducto !== "servicio").length;
  const lineasSinStock = compra.items.length - lineasStock;

  const confirmar = async () => {
    if (!preview) return;
    setError(null);
    try {
      const res = await recibir.mutateAsync({ id: compra.id, data: { updatedAt: preview.updatedAt } });
      qc.setQueryData(getGetCompraQueryKey(res.id), res);
      invalidateCompras(qc, true);
      invalidateInventario(qc);
      cambios.forEach((c) => invalidateInventario(qc, c.productoId));
      invalidateNotificaciones(qc);
      onRecibida(res);
      onOpenChange(false);
    } catch (err) {
      if (errorStatus(err) === 409) {
        setAviso("La compra o los costos cambiaron mientras revisabas. Cargamos los valores actuales.");
        await cargar();
      } else {
        setError(apiErrorMessage(err, "No se pudo confirmar la recepción."));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!recibir.isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" />Confirmar recepción · {compra.numeroFactura}</DialogTitle>
          <DialogDescription>
            Ingresará stock en {lineasStock} línea{lineasStock === 1 ? "" : "s"} con movimiento "Ingreso por compra" referenciado a esta factura.
            {lineasSinStock > 0 && ` ${lineasSinStock} línea${lineasSinStock === 1 ? "" : "s"} (servicios o texto libre) no afectan inventario.`}
          </DialogDescription>
        </DialogHeader>

        {aviso && <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="text-recepcion-conflicto">{aviso}</div>}

        {cargando ? (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />)}</div>
        ) : !preview ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 space-y-2">
            <p>{error ?? "No se pudo preparar la recepción."}</p>
            <Button size="sm" variant="outline" onClick={cargar}><RotateCw className="h-3.5 w-3.5 mr-1.5" />Reintentar</Button>
          </div>
        ) : cambios.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Ningún costo cambia respecto al registrado en inventario.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">Costos que se actualizarán automáticamente ({cambios.length})</p>
            <div className="rounded-lg border divide-y max-h-[40vh] overflow-y-auto">
              {cambios.map((c) => (
                <div key={c.productoId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`row-cambio-costo-${c.productoId}`}>
                  <span className="min-w-0 truncate font-medium">{c.nombre}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    <span className="text-muted-foreground line-through">{fmt(c.costoAnterior)}</span>
                    <ArrowRight className="inline h-3 w-3 mx-1" />
                    <span className="font-semibold">{fmt(c.costoNuevo)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <p>Los costos netos se toman de esta factura y quedan en el historial de cada producto. Se mantiene el margen configurado, el precio sugerido se recalcula y recibirás una notificación por cada cambio.</p>
            </div>
          </div>
        )}

        {preview && error && <p className="text-sm text-red-600" data-testid="text-recepcion-error">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={recibir.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!preview || cargando || recibir.isPending} data-testid="button-confirmar-recepcion-final">
            {recibir.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirmar recepción
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
