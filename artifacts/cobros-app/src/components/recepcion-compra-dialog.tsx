import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  previewRecepcionCompra, useRecibirCompra, getGetCompraQueryKey,
  type Compra, type CompraRecepcionPreview,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { apiErrorMessage } from "@/lib/inventario";
import { errorStatus, invalidateCompras, itemsDe } from "@/lib/compras";
import { AlertTriangle, ArrowRight, Loader2, PackageCheck, RotateCw } from "lucide-react";

/**
 * Loads the receipt preview, asks an explicit yes/no for every changed cost and posts the receipt.
 * On 409 the preview is reloaded and decisions reset; nothing is retried automatically.
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
  const [decisiones, setDecisiones] = useState<Record<number, boolean | undefined>>({});
  const idRef = useRef(compra.id);
  idRef.current = compra.id;

  const cargar = async () => {
    setCargando(true); setError(null); setDecisiones({});
    try { setPreview(await previewRecepcionCompra(idRef.current)); }
    catch (err) { setPreview(null); setError(apiErrorMessage(err, "No se pudo preparar la recepción.")); }
    finally { setCargando(false); }
  };

  useEffect(() => { if (open) { setAviso(null); cargar(); } }, [open, compra.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambios = preview?.cambiosCostos ?? [];
  const pendientes = cambios.filter((c) => decisiones[c.productoId] === undefined).length;
  const fmt = (n: number) => formatMoney(n, compra.moneda, compra.decimales);
  const lineasStock = itemsDe(compra).filter((i) => i.productoId != null && i.tipoProducto !== "servicio").length;
  const lineasSinStock = compra.items.length - lineasStock;

  const confirmar = async () => {
    if (!preview || pendientes > 0) return;
    setError(null);
    try {
      const res = await recibir.mutateAsync({ id: compra.id, data: {
        updatedAt: preview.updatedAt,
        decisiones: cambios.map((c) => ({ productoId: c.productoId, actualizar: decisiones[c.productoId] === true, costoAnterior: c.costoAnterior })),
      } });
      qc.setQueryData(getGetCompraQueryKey(res.id), res);
      invalidateCompras(qc, true);
      onRecibida(res);
      onOpenChange(false);
    } catch (err) {
      if (errorStatus(err) === 409) {
        setAviso("La compra o los costos cambiaron mientras revisabas. Cargamos los valores actuales: revisa y decide nuevamente.");
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
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />)}</div>
        ) : !preview ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 space-y-2">
            <p>{error ?? "No se pudo preparar la recepción."}</p>
            <Button size="sm" variant="outline" onClick={cargar}><RotateCw className="h-3.5 w-3.5 mr-1.5" />Reintentar</Button>
          </div>
        ) : cambios.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Ningún costo cambia respecto al registrado en inventario.</p>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            <p className="text-sm font-medium flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-600" />Cambios de costo: decide uno por uno</p>
            {cambios.map((c) => {
              const d = decisiones[c.productoId];
              return (
                <div key={c.productoId} className="rounded-lg border p-3 space-y-2" data-testid={`card-cambio-costo-${c.productoId}`}>
                  <p className="text-sm">El precio de costo de <strong>{c.nombre}</strong> cambió de <span className="font-mono">{fmt(c.costoAnterior)}</span> <ArrowRight className="inline h-3 w-3" /> <span className="font-mono font-semibold">{fmt(c.costoNuevo)}</span>. ¿Actualizar?</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant={d === true ? "default" : "outline"} onClick={() => setDecisiones((s) => ({ ...s, [c.productoId]: true }))} data-testid={`button-actualizar-costo-${c.productoId}`}>Sí, actualizar costo</Button>
                    <Button size="sm" variant={d === false ? "secondary" : "outline"} onClick={() => setDecisiones((s) => ({ ...s, [c.productoId]: false }))} data-testid={`button-mantener-costo-${c.productoId}`}>No, mantener {fmt(c.costoAnterior)}</Button>
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground">Si actualizas, se recalcula el precio sugerido según el margen configurado. El precio de venta vigente no cambia.</p>
          </div>
        )}

        {preview && error && <p className="text-sm text-red-600" data-testid="text-recepcion-error">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={recibir.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!preview || cargando || pendientes > 0 || recibir.isPending} data-testid="button-confirmar-recepcion-final">
            {recibir.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {pendientes > 0 ? `Decide ${pendientes} cambio${pendientes === 1 ? "" : "s"}` : "Confirmar recepción"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
