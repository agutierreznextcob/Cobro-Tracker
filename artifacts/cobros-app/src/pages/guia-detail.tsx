import { useState } from "react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatFechaPref } from "@/lib/format";
import { usePreferencias } from "@/hooks/use-preferencias";
import { useToast } from "@/hooks/use-toast";
import { useGetGuia, useCambiarEstadoGuia, ESTADO_GUIA, type EstadoGuia } from "@/lib/guias-despacho";
import { ArrowLeft, Check, Download, Loader2, RotateCw, Truck, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ConfirmAccion = null | "despachar" | "entregar" | "anular";

export default function GuiaDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id) || 0;
  const { toast } = useToast();
  const { prefs } = usePreferencias();

  const { data: g, isLoading, isError, refetch, isFetching } = useGetGuia(id);
  const cambiarEstado = useCambiarEstadoGuia(id);
  const [confirm, setConfirm] = useState<ConfirmAccion>(null);

  const onErr = (title: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : "Intenta nuevamente.";
    toast({ title, description: msg, variant: "destructive" });
    refetch();
  };

  const ejecutarConfirm = () => {
    if (!g || !confirm) return;
    const which = confirm;
    setConfirm(null);

    if (which === "despachar") {
      cambiarEstado.mutate("en_despacho", {
        onSuccess: () => toast({ title: "Guía en despacho", description: "La guía está en camino al destinatario." }),
        onError: onErr("No se pudo actualizar"),
      });
    } else if (which === "entregar") {
      cambiarEstado.mutate("entregada", {
        onSuccess: () => toast({ title: "Guía entregada", description: "Se registró la entrega al destinatario." }),
        onError: onErr("No se pudo actualizar"),
      });
    } else if (which === "anular") {
      cambiarEstado.mutate("anulada", {
        onSuccess: () => toast({ title: "Guía anulada" }),
        onError: onErr("No se pudo anular"),
      });
    }
  };

  const descargarPDF = () => {
    window.open(`/api/guias-despacho/${id}/pdf`, "_blank");
  };

  if (isLoading) return <div className="max-w-6xl mx-auto py-12 text-center text-muted-foreground">Cargando guía…</div>;
  if (isError || !g) return <div className="max-w-6xl mx-auto py-12 text-center text-destructive">No se pudo cargar la guía.</div>;

  const cfg = ESTADO_GUIA[g.estado];
  const subtotal = Number(g.subtotal);
  const iva = Number(g.montoIva);
  const total = Number(g.total);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/guias-despacho"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{g.numeroGuia}</h1>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border", cfg.className)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                {cfg.label}
              </span>
            </div>
            <p className="text-muted-foreground text-sm mt-0.5">
              {g.clienteNombre} · Emitida el {formatFechaPref(g.fechaEmision, prefs?.formatoFecha)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RotateCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
            Actualizar
          </Button>
          {/* Botón de descarga PDF — siempre visible */}
          <Button variant="outline" size="sm" onClick={descargarPDF} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />Descargar PDF
          </Button>
          {/* Acciones según estado */}
          {g.estado === "emitida" && (
            <>
              <Button size="sm" onClick={() => setConfirm("despachar")} disabled={cambiarEstado.isPending} className="gap-1.5">
                <Truck className="h-3.5 w-3.5" />Marcar en despacho
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm("anular")} disabled={cambiarEstado.isPending} className="gap-1.5 text-destructive hover:text-destructive">
                <X className="h-3.5 w-3.5" />Anular
              </Button>
            </>
          )}
          {g.estado === "en_despacho" && (
            <>
              <Button size="sm" onClick={() => setConfirm("entregar")} disabled={cambiarEstado.isPending} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                <Check className="h-3.5 w-3.5" />Marcar entregada
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm("anular")} disabled={cambiarEstado.isPending} className="gap-1.5 text-destructive hover:text-destructive">
                <X className="h-3.5 w-3.5" />Anular
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Detalles */}
          <Card className="shadow-sm border-border/50">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="font-semibold text-sm">Información de despacho</h3>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Número guía</p>
                <p className="font-mono text-sm font-medium">{g.numeroGuia}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fecha emisión</p>
                <p className="text-sm">{formatFechaPref(g.fechaEmision, prefs?.formatoFecha)}</p>
              </div>
              {g.pedidoId && (
                <div>
                  <p className="text-xs text-muted-foreground">Pedido origen</p>
                  <Link href={`/pedidos/${g.pedidoId}`} className="text-sm text-primary hover:underline">
                    Ver pedido #{g.pedidoId}
                  </Link>
                </div>
              )}
              {g.transportista && <div>
                <p className="text-xs text-muted-foreground">Transportista</p>
                <p className="text-sm">{g.transportista}</p>
              </div>}
              {g.chofer && <div>
                <p className="text-xs text-muted-foreground">Chofer</p>
                <p className="text-sm">{g.chofer}</p>
              </div>}
              {g.patenteVehiculo && <div>
                <p className="text-xs text-muted-foreground">Patente</p>
                <p className="text-sm">{g.patenteVehiculo}</p>
              </div>}
              {g.direccionOrigen && <div>
                <p className="text-xs text-muted-foreground">Origen</p>
                <p className="text-sm">{g.direccionOrigen}</p>
              </div>}
              {g.direccionDestino && <div>
                <p className="text-xs text-muted-foreground">Destino</p>
                <p className="text-sm">{g.direccionDestino}</p>
              </div>}
              {g.observaciones && <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Observaciones</p>
                <p className="text-sm whitespace-pre-wrap">{g.observaciones}</p>
              </div>}
            </div>
          </Card>

          {/* Cliente */}
          <Card className="shadow-sm border-border/50">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="font-semibold text-sm">Destinatario</h3>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Razón social</p>
                <p className="text-sm font-medium">{g.clienteNombre}</p>
              </div>
              {g.clienteRut && <div>
                <p className="text-xs text-muted-foreground">RUT</p>
                <p className="text-sm">{g.clienteRut}</p>
              </div>}
              {g.clienteDireccion && <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Dirección de entrega</p>
                <p className="text-sm">{g.clienteDireccion}</p>
              </div>}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="font-semibold text-sm">Resumen</h3>
            </div>
            <div className="p-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium tabular-nums">{formatMoney(subtotal, g.moneda, g.decimales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">IVA ({g.porcentajeIva}%)</span>
                <span className="tabular-nums">{formatMoney(iva, g.moneda, g.decimales)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base pt-2 border-t border-border/60">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(total, g.moneda, g.decimales)}</span>
              </div>
            </div>
          </Card>

          <Card className="shadow-sm border-border/50">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="font-semibold text-sm">Ítems ({g.items.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">{item.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{item.cantidad}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {formatMoney(Number(item.subtotalLinea), g.moneda, g.decimales)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "despachar" ? "Marcar guía en despacho"
                : confirm === "entregar" ? "Marcar guía como entregada"
                : "Anular guía"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "despachar"
                ? "Se registrará que la guía salió a despacho. Luego podrás marcarla como entregada."
                : confirm === "entregar"
                ? "Se registrará que la guía fue entregada al destinatario. Esta acción no se puede deshacer."
                : "Esta acción no se puede deshacer. La guía quedará anulada."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={ejecutarConfirm}
              className={confirm === "anular" ? "bg-destructive hover:bg-destructive/90" : ""}
            >
              {cambiarEstado.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> :
                confirm === "despachar" ? "Confirmar despacho"
                : confirm === "entregar" ? "Confirmar entrega"
                : "Anular guía"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
