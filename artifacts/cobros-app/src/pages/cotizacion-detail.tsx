import { EquivalenciaCLP } from "@/components/equivalencia-clp";
import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCotizacion,
  getGetCotizacionQueryKey,
  useSendCotizacion,
  useSetCotizacionEstado,
  useConvertirCotizacion,
  type Cotizacion,
  type CotizacionItem,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { usePreferencias } from "@/hooks/use-preferencias";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EstadoCotizacionBadge } from "@/components/estado-cotizacion-badge";
import { formatMoney, formatFechaPref, formatDate } from "@/lib/format";
import { apiErrorMessage } from "@/lib/inventario";
import { descargarPdfCotizacion, invalidateCobrosTrasConversion, invalidateCotizaciones } from "@/lib/cotizaciones";
import { ArrowLeft, ArrowRightLeft, Check, Download, ExternalLink, Eye, Loader2, Mail, Package, Pencil, RotateCw, X } from "lucide-react";
import { downloadCotizacionPdf } from "@workspace/api-client-react";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import { useConvertirCotizacionAPedido, PEDIDOS_KEY } from "@/lib/pedidos";

type Confirm = null | "enviar" | "aceptada" | "rechazada" | "convertir" | "convertir-pedido";

export default function CotizacionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id) || 0;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { prefs } = usePreferencias();

  const { data: c, isLoading, isError, refetch, isFetching } = useGetCotizacion(id, {
    query: { enabled: !!id, queryKey: getGetCotizacionQueryKey(id), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 },
  });
  const enviar = useSendCotizacion();
  const setEstado = useSetCotizacionEstado();
  const convertir = useConvertirCotizacion();
  const convertirPedido = useConvertirCotizacionAPedido();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [descargando, setDescargando] = useState(false);
  const [preview, setPreview] = useState(false);

  const aplicar = (res: Cotizacion) => {
    qc.setQueryData(getGetCotizacionQueryKey(res.id), res);
    invalidateCotizaciones(qc, res.id);
  };
  const onErr = (title: string) => (err: unknown) => {
    toast({ title, description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" });
    refetch();
  };

  const ejecutarConfirm = () => {
    if (!c || !confirm) return;
    const which = confirm;
    setConfirm(null);
    if (which === "enviar") {
      enviar.mutate({ id: c.id }, {
        onSuccess: (r) => { aplicar(r); toast({ title: "Cotización enviada", description: `Enviada a ${r.clienteEmail ?? "el cliente"}.` }); },
        onError: onErr("No se pudo enviar"),
      });
    } else if (which === "convertir") {
      convertir.mutate({ id: c.id }, {
        onSuccess: (r) => {
          aplicar(r);
          invalidateCobrosTrasConversion(qc);
          toast({ title: "Cobro creado", description: "La cotización se convirtió en cobro." });
          if (r.cobroId) navigate(`/cobros/${r.cobroId}`);
        },
        onError: onErr("No se pudo convertir"),
      });
    } else if (which === "convertir-pedido") {
      convertirPedido.mutate(c.id, {
        onSuccess: (pedido) => {
          qc.invalidateQueries({ queryKey: PEDIDOS_KEY });
          toast({ title: "Pedido creado", description: `${pedido.numeroPedido} generado desde la cotización.` });
          navigate(`/pedidos/${pedido.id}`);
        },
        onError: onErr("No se pudo crear el pedido"),
      });
    } else {
      setEstado.mutate({ id: c.id, data: { estado: which } }, {
        onSuccess: (r) => { aplicar(r); toast({ title: which === "aceptada" ? "Marcada como aceptada" : "Marcada como rechazada" }); },
        onError: onErr("No se pudo actualizar el estado"),
      });
    }
  };

  const pdf = async (enviado = false) => {
    if (!c) return;
    setDescargando(true);
    try {
      await descargarPdfCotizacion(c, enviado);
    } catch (err) {
      toast({ title: "No se pudo generar el PDF", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" });
    } finally {
      setDescargando(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 w-40 bg-muted rounded" />
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <div className="h-[520px] bg-muted/60 rounded-xl" />
          <div className="h-56 bg-muted/60 rounded-xl" />
        </div>
      </div>
    );
  }
  if (isError || !c) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos esta cotización.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/cotizaciones">Volver</Link></Button>
        </div>
      </div>
    );
  }

  const fmt = (n: number) => formatMoney(n, c.moneda, c.decimales);
  const fecha = (s: string) => formatFechaPref(s, prefs.formatoFecha);
  const pending = enviar.isPending || setEstado.isPending || convertir.isPending || convertirPedido.isPending;
  const items = (c.items ?? []) as CotizacionItem[];

  const confirmCopy: Record<Exclude<Confirm, null>, { title: string; desc: string; cta: string }> = {
    enviar: { title: "Enviar cotización", desc: `Se enviará ${c.numeroCotizacion} con su PDF a ${c.clienteEmail ?? "el cliente"}. Quedará como enviada solo si el envío es exitoso.`, cta: "Enviar" },
    aceptada: { title: "Registrar aceptación", desc: "Marca esta cotización como aceptada por el cliente. Luego podrás convertirla en cobro.", cta: "Marcar aceptada" },
    rechazada: { title: "Registrar rechazo", desc: "Marca esta cotización como rechazada por el cliente. Esta acción cierra la cotización.", cta: "Marcar rechazada" },
    convertir: { title: "Convertir en cobro", desc: `Se creará un cobro en ${c.moneda} por ${fmt(c.total)} con los mismos ítems y cliente, vinculado a esta cotización.`, cta: "Crear cobro" },
    "convertir-pedido": { title: "Convertir en pedido", desc: `Se creará un pedido de logística en ${c.moneda} por ${fmt(c.total)} con los mismos ítems y cliente, para que logística confirme disponibilidad.`, cta: "Crear pedido" },
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/cotizaciones" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />Volver a cotizaciones
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono" data-testid="text-numero-cotizacion">{c.numeroCotizacion}</h1>
            <EstadoCotizacionBadge estado={c.estado} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">Actualizada {formatDate(c.updatedAt)}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_280px] items-start">
        {/* Paper preview */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden" data-testid="preview-cotizacion">
          <div className="h-1.5 bg-primary" />
          <div className="p-6 sm:p-10 space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Cotización</p>
                <p className="font-mono text-xl font-bold mt-1">{c.numeroCotizacion}</p>
              </div>
              <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Emisión</dt><dd className="font-mono tabular-nums text-right">{fecha(c.fechaEmision)}</dd>
                <dt className="text-muted-foreground">Válida hasta</dt><dd className="font-mono tabular-nums text-right">{fecha(c.fechaVencimiento)}</dd>
                <dt className="text-muted-foreground">Moneda</dt><dd className="font-mono text-right">{c.moneda}</dd>
              </dl>
            </div>

            <div className="rounded-lg bg-muted/30 p-4 grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente</p>
                <p className="font-semibold">{c.clienteNombre}</p>
                {c.clienteRut && <p className="font-mono text-xs text-muted-foreground">{c.clienteRut}</p>}
              </div>
              <div className="sm:text-right">
                {c.clienteEmail && <p>{c.clienteEmail}</p>}
                {c.clienteDireccion && <p className="text-muted-foreground">{c.clienteDireccion}</p>}
                {!c.clienteEmail && <p className="text-amber-700 text-xs">Cliente sin email</p>}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 text-left font-medium">Descripción</th>
                    <th className="py-2 text-right font-medium">Cant.</th>
                    <th className="py-2 text-right font-medium">Precio unit.</th>
                    <th className="py-2 text-right font-medium">Desc.</th>
                    <th className="py-2 text-right font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Sin ítems</td></tr>
                  ) : items.map((it) => (
                    <tr key={it.id} className="border-b border-border/50 align-top" data-testid={`row-item-${it.id}`}>
                      <td className="py-2.5 pr-3 whitespace-pre-wrap">{it.descripcion}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{it.cantidad.toLocaleString("es-CL")}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums whitespace-nowrap">{fmt(it.precioUnitario)}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{it.descuentoPorcentaje ? `${it.descuentoPorcentaje}%` : "—"}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums whitespace-nowrap">{fmt(it.subtotalLinea)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <dl className="w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="font-mono tabular-nums">{fmt(c.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">IVA ({c.porcentajeIva}%)</dt><dd className="font-mono tabular-nums">{fmt(c.montoIva)}</dd></div>
                <div className="flex items-baseline justify-between border-t pt-2"><dt className="font-semibold">Total</dt><dd className="font-mono text-xl font-bold text-primary tabular-nums" data-testid="text-total-cotizacion">{fmt(c.total)}</dd></div>
                {c.moneda !== "CLP" && <EquivalenciaCLP monto={c.total} moneda={c.moneda} decimales={c.decimales ?? 0} compact testId="equivalencia-clp-cotizacion" />}
              </dl>
            </div>

            {c.notas && (
              <div className="border-t pt-5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Notas</p>
                <p className="text-sm whitespace-pre-wrap">{c.notas}</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <Card className="p-4 shadow-sm space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Acciones</p>
            {(c.estado === "borrador" || c.envioPendiente) && (
              <>
                <Button className="w-full" onClick={() => setConfirm("enviar")} disabled={pending || !c.clienteEmail} data-testid="button-enviar">
                  {enviar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}Enviar al cliente
                </Button>
                {!c.clienteEmail && <p className="text-[11px] text-amber-700">Agrega un email al cliente para enviarla.</p>}
                {c.envioPendiente && <p className="text-xs text-amber-700">Envío pendiente de confirmar. Reintentar utiliza el mismo documento y no genera un nuevo correo. El borrador queda bloqueado hasta confirmar.</p>}
                {!c.envioPendiente && <Button asChild variant="outline" className="w-full" data-testid="button-editar">
                  <Link href={`/cotizaciones/${c.id}/editar`}><Pencil className="h-4 w-4 mr-2" />Editar borrador</Link>
                </Button>}
              </>
            )}
            {c.estado === "enviada" && (
              <>
                <p className="text-xs text-muted-foreground pb-1">Registra la respuesta del cliente:</p>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setConfirm("aceptada")} disabled={pending} data-testid="button-aceptar">
                  {setEstado.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}Aceptada
                </Button>
                <Button variant="outline" className="w-full text-red-700 hover:text-red-800" onClick={() => setConfirm("rechazada")} disabled={pending} data-testid="button-rechazar">
                  <X className="h-4 w-4 mr-2" />Rechazada
                </Button>
              </>
            )}
            {c.estado === "aceptada" && (
              c.cobroId ? (
                <Button asChild className="w-full" data-testid="link-cobro-generado">
                  <Link href={`/cobros/${c.cobroId}`}><ExternalLink className="h-4 w-4 mr-2" />Ver cobro generado</Link>
                </Button>
              ) : (
                <Button className="w-full" onClick={() => setConfirm("convertir")} disabled={pending} data-testid="button-convertir">
                  {convertir.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRightLeft className="h-4 w-4 mr-2" />}Convertir a cobro
                </Button>
              )
            )}
            {(c.estado === "aceptada" || c.estado === "enviada" || c.estado === "borrador") && !(c as unknown as { pedidoId?: number }).pedidoId && (
              <Button variant="outline" className="w-full" onClick={() => setConfirm("convertir-pedido")} disabled={pending} data-testid="button-convertir-pedido">
                {convertirPedido.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Package className="h-4 w-4 mr-2" />}Crear pedido de logística
              </Button>
            )}
            {(c as unknown as { pedidoId?: number }).pedidoId && (
              <Button asChild variant="outline" className="w-full" data-testid="link-pedido-generado">
                <Link href={`/pedidos/${(c as unknown as { pedidoId: number }).pedidoId}`}><ExternalLink className="h-4 w-4 mr-2" />Ver pedido de logística</Link>
              </Button>
            )}
            {c.estado === "vencida" && <p className="text-xs text-muted-foreground">Cotización vencida: ya no se puede aceptar ni convertir. Crea una nueva si el cliente sigue interesado.</p>}
            {c.estado === "rechazada" && <p className="text-xs text-muted-foreground">El cliente rechazó esta propuesta.</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setPreview(true)} data-testid="button-vista-previa">
                <Eye className="h-4 w-4 mr-2" />Vista previa
              </Button>
              <Button variant="ghost" onClick={() => pdf()} disabled={descargando} data-testid="button-pdf">
                {descargando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}PDF
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">La vista previa y el PDF actual se regeneran con la identidad vigente del negocio.</p>
            {c.pdfEnviadoDisponible ? (
              <Button variant="outline" className="w-full" onClick={() => pdf(true)} disabled={descargando} data-testid="button-pdf-enviado">
                <Download className="h-4 w-4 mr-2" />Descargar PDF enviado
              </Button>
            ) : c.estado !== "borrador" && !c.envioPendiente && (
              <p className="text-xs text-muted-foreground">No hay copia del PDF enviado. Los envíos anteriores a esta función no tienen copia histórica.</p>
            )}
            <PdfPreviewDialog open={preview} onOpenChange={setPreview} cargar={() => downloadCotizacionPdf(c.id)} filename={c.numeroCotizacion || `cotizacion-${c.id}`} titulo={`Cotización ${c.numeroCotizacion}`} />
          </Card>

          <Card className="p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recorrido</p>
            <ol className="space-y-2.5 text-sm">
              {(["borrador", "enviada", "aceptada", "cobro"] as const).map((paso, i) => {
                const orden = { borrador: 0, enviada: 1, aceptada: 2, rechazada: 2, vencida: 1 }[c.estado];
                const hecho = paso === "cobro" ? !!c.cobroId : i <= orden && !(paso === "aceptada" && c.estado !== "aceptada");
                const label = { borrador: "Borrador", enviada: "Enviada", aceptada: "Aceptada", cobro: "Convertida en cobro" }[paso];
                return (
                  <li key={paso} className="flex items-center gap-2.5">
                    <span className={`h-5 w-5 rounded-full border flex items-center justify-center text-[10px] font-semibold ${hecho ? "bg-primary border-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>{hecho ? <Check className="h-3 w-3" /> : i + 1}</span>
                    <span className={hecho ? "font-medium" : "text-muted-foreground"}>{label}</span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy[confirm].title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmCopy[confirm].desc}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={ejecutarConfirm} data-testid="button-confirmar-accion">{confirmCopy[confirm].cta}</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
