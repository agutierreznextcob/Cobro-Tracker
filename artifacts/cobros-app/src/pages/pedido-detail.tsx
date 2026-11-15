import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatFechaPref } from "@/lib/format";
import { usePreferencias } from "@/hooks/use-preferencias";
import { useToast } from "@/hooks/use-toast";
import { useGetPedido, useCambiarEstadoPedido, ESTADO_PEDIDO, type EstadoPedido } from "@/lib/pedidos";
import { useEmitirGuiaDesdePedido as useEmitirGuia, GUIAS_KEY } from "@/lib/guias-despacho";
import { ArrowLeft, Check, Loader2, Package, RotateCw, Truck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

type ConfirmAccion = null | "aprobar" | "despachar" | "cancelar" | "emitir-guia";

export default function PedidoDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id) || 0;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { prefs } = usePreferencias();
  const qc = useQueryClient();

  const { data: p, isLoading, isError, refetch, isFetching } = useGetPedido(id);
  const cambiarEstado = useCambiarEstadoPedido(id);
  const emitirGuia = useEmitirGuia();

  const [confirm, setConfirm] = useState<ConfirmAccion>(null);
  const [notasLogistica, setNotasLogistica] = useState("");

  const onErr = (title: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : "Intenta nuevamente.";
    toast({ title, description: msg, variant: "destructive" });
    refetch();
  };

  const ejecutarConfirm = () => {
    if (!p || !confirm) return;
    const which = confirm;
    setConfirm(null);

    if (which === "aprobar") {
      cambiarEstado.mutate({ estado: "aprobado", notasLogistica }, {
        onSuccess: () => toast({ title: "Pedido aprobado", description: "El pedido fue marcado como aprobado." }),
        onError: onErr("No se pudo aprobar"),
      });
    } else if (which === "despachar") {
      cambiarEstado.mutate({ estado: "despachado" }, {
        onSuccess: () => toast({ title: "Pedido despachado" }),
        onError: onErr("No se pudo despachar"),
      });
    } else if (which === "cancelar") {
      cambiarEstado.mutate({ estado: "cancelado" }, {
        onSuccess: () => toast({ title: "Pedido cancelado" }),
        onError: onErr("No se pudo cancelar"),
      });
    } else if (which === "emitir-guia") {
      emitirGuia.mutate({ pedidoId: p.id }, {
        onSuccess: (guia) => {
          qc.invalidateQueries({ queryKey: GUIAS_KEY });
          toast({ title: "Guía de despacho emitida", description: `Guía ${guia.numeroGuia} creada.` });
          navigate(`/guias-despacho/${guia.id}`);
        },
        onError: onErr("No se pudo emitir la guía"),
      });
    }
  };

  const isBusy = cambiarEstado.isPending || emitirGuia.isPending;

  if (isLoading) return (
    <div className="max-w-6xl mx-auto py-12 text-center text-muted-foreground">Cargando pedido…</div>
  );
  if (isError || !p) return (
    <div className="max-w-6xl mx-auto py-12 text-center text-destructive">No se pudo cargar el pedido.</div>
  );

  const cfg = ESTADO_PEDIDO[p.estado];
  const subtotal = Number(p.subtotal);
  const iva = Number(p.montoIva);
  const total = Number(p.total);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/pedidos"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{p.numeroPedido}</h1>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border", cfg.className)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                {cfg.label}
              </span>
            </div>
            <p className="text-muted-foreground text-sm mt-0.5">
              {p.clienteNombre} · {formatFechaPref(p.creadoEn, prefs?.formatoFecha)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching || isBusy}>
            <RotateCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
            Actualizar
          </Button>

          {p.estado === "pendiente" && (
            <>
              <Button size="sm" onClick={() => setConfirm("aprobar")} disabled={isBusy} className="gap-1.5">
                <Check className="h-3.5 w-3.5" />Aprobar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm("cancelar")} disabled={isBusy} className="gap-1.5 text-destructive hover:text-destructive">
                <X className="h-3.5 w-3.5" />Cancelar
              </Button>
            </>
          )}

          {p.estado === "aprobado" && (
            <>
              <Button size="sm" onClick={() => setConfirm("emitir-guia")} disabled={isBusy} className="gap-1.5">
                <Truck className="h-3.5 w-3.5" />Emitir guía
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm("despachar")} disabled={isBusy} className="gap-1.5">
                <Package className="h-3.5 w-3.5" />Marcar despachado
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm("cancelar")} disabled={isBusy} className="gap-1.5 text-destructive hover:text-destructive">
                <X className="h-3.5 w-3.5" />Cancelar
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
              <h3 className="font-semibold text-sm">Información del pedido</h3>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Número</p>
                <p className="font-mono text-sm font-medium">{p.numeroPedido}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fecha</p>
                <p className="text-sm">{formatFechaPref(p.creadoEn, prefs?.formatoFecha)}</p>
              </div>
              {p.cotizacionId && (
                <div>
                  <p className="text-xs text-muted-foreground">Cotización origen</p>
                  <Link href={`/cotizaciones/${p.cotizacionId}`} className="text-sm text-primary hover:underline">
                    Ver cotización #{p.cotizacionId}
                  </Link>
                </div>
              )}
              {p.guiaDespachoId && (
                <div>
                  <p className="text-xs text-muted-foreground">Guía de despacho</p>
                  <Link href={`/guias-despacho/${p.guiaDespachoId}`} className="text-sm text-primary hover:underline">
                    Ver guía #{p.guiaDespachoId}
                  </Link>
                </div>
              )}
              {p.aprobadoEn && (
                <div>
                  <p className="text-xs text-muted-foreground">Aprobado</p>
                  <p className="text-sm">{formatFechaPref(p.aprobadoEn, prefs?.formatoFecha)}</p>
                </div>
              )}
              {p.despachadoEn && (
                <div>
                  <p className="text-xs text-muted-foreground">Despachado</p>
                  <p className="text-sm">{formatFechaPref(p.despachadoEn, prefs?.formatoFecha)}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Cliente */}
          <Card className="shadow-sm border-border/50">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="font-semibold text-sm">Cliente</h3>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Razón social</p>
                <p className="text-sm font-medium">{p.clienteNombre}</p>
              </div>
              {p.clienteRut && <div>
                <p className="text-xs text-muted-foreground">RUT</p>
                <p className="text-sm">{p.clienteRut}</p>
              </div>}
              {p.clienteEmail && <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm">{p.clienteEmail}</p>
              </div>}
              {p.clienteDireccion && <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Dirección</p>
                <p className="text-sm">{p.clienteDireccion}</p>
              </div>}
            </div>
          </Card>

          {/* Notas logística */}
          {(p.notas || p.notasLogistica) && (
            <Card className="shadow-sm border-border/50">
              <div className="px-5 py-4 border-b border-border/60">
                <h3 className="font-semibold text-sm">Notas</h3>
              </div>
              <div className="p-5 space-y-3">
                {p.notas && <div>
                  <p className="text-xs text-muted-foreground mb-1">Notas generales</p>
                  <p className="text-sm whitespace-pre-wrap">{p.notas}</p>
                </div>}
                {p.notasLogistica && <div>
                  <p className="text-xs text-muted-foreground mb-1">Notas de logística</p>
                  <p className="text-sm whitespace-pre-wrap">{p.notasLogistica}</p>
                </div>}
              </div>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Totales */}
          <Card className="shadow-sm border-border/50">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="font-semibold text-sm">Resumen</h3>
            </div>
            <div className="p-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium tabular-nums">{formatMoney(subtotal, p.moneda, p.decimales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">IVA ({p.porcentajeIva}%)</span>
                <span className="tabular-nums">{formatMoney(iva, p.moneda, p.decimales)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base pt-2 border-t border-border/60">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(total, p.moneda, p.decimales)}</span>
              </div>
            </div>
          </Card>

          {/* Ítems */}
          <Card className="shadow-sm border-border/50">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="font-semibold text-sm">Ítems ({p.items.length})</h3>
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
                  {p.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">{item.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{item.cantidad}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {formatMoney(Number(item.subtotalLinea), p.moneda, p.decimales)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </div>

      {/* Confirm dialog */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "aprobar" && "Aprobar pedido"}
              {confirm === "despachar" && "Marcar como despachado"}
              {confirm === "cancelar" && "Cancelar pedido"}
              {confirm === "emitir-guia" && "Emitir guía de despacho"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "aprobar" && "Confirma que hay stock disponible y el pedido está listo para despacho."}
              {confirm === "despachar" && "El pedido se marcará como despachado sin emitir guía de despacho."}
              {confirm === "cancelar" && "Esta acción no se puede deshacer."}
              {confirm === "emitir-guia" && "Se creará una guía de despacho vinculada a este pedido y el pedido pasará a estado 'Despachado'."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {confirm === "aprobar" && (
            <div className="mt-2">
              <label className="text-sm text-muted-foreground mb-1.5 block">Notas de logística (opcional)</label>
              <Textarea
                value={notasLogistica}
                onChange={(e) => setNotasLogistica(e.target.value)}
                placeholder="Instrucciones especiales, horarios, etc."
                rows={3}
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={ejecutarConfirm}
              className={confirm === "cancelar" ? "bg-destructive hover:bg-destructive/90" : ""}
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                confirm === "aprobar" ? "Aprobar" :
                confirm === "despachar" ? "Despachar" :
                confirm === "emitir-guia" ? "Emitir guía" :
                "Cancelar pedido"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
