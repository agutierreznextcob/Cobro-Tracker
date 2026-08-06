import { useState } from "react";
import {
  useListComprobantesTransferencia,
  getListComprobantesTransferenciaQueryKey,
  useConfirmarComprobanteTransferencia,
  useRechazarComprobanteTransferencia,
  getGetCobroQueryKey,
} from "@workspace/api-client-react";
import type { ComprobanteTransferencia } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { FileCheck2, Loader2, CheckCircle2, XCircle, Eye } from "lucide-react";

const ESTADO_LABEL: Record<ComprobanteTransferencia["estado"], { label: string; cls: string }> = {
  pendiente: { label: "Pendiente de revisión", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmado: { label: "Pago confirmado", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rechazado: { label: "Rechazado", cls: "bg-red-50 text-red-700 border-red-200" },
};

export function ComprobantesTransferenciaSection({ cobroId }: { cobroId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [verComprobante, setVerComprobante] = useState<ComprobanteTransferencia | null>(null);

  const { data: comprobantes } = useListComprobantesTransferencia(cobroId, {
    query: { enabled: !!cobroId, queryKey: getListComprobantesTransferenciaQueryKey(cobroId) },
  });
  const confirmar = useConfirmarComprobanteTransferencia();
  const rechazar = useRechazarComprobanteTransferencia();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListComprobantesTransferenciaQueryKey(cobroId) });
    queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(cobroId) });
  };

  const handleConfirmar = async (comprobanteId: number) => {
    try {
      await confirmar.mutateAsync({ id: cobroId, comprobanteId });
      invalidate();
      setVerComprobante(null);
      toast({ title: "Pago confirmado", description: "El cobro fue marcado como pagado." });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo confirmar el pago";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleRechazar = async (comprobanteId: number) => {
    try {
      await rechazar.mutateAsync({ id: cobroId, comprobanteId });
      invalidate();
      setVerComprobante(null);
      toast({ title: "Comprobante rechazado" });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo rechazar el comprobante";
      toast({ title: msg, variant: "destructive" });
    }
  };

  if (!comprobantes || comprobantes.length === 0) return null;

  const pendientes = comprobantes.filter((c) => c.estado === "pendiente").length;

  return (
    <Card className="shadow-sm border-border/50" data-testid="seccion-comprobantes-transferencia">
      <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" />
          Comprobantes de transferencia
          {pendientes > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              {pendientes} por revisar
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-2">
        {comprobantes.map((c) => {
          const meta = ESTADO_LABEL[c.estado];
          return (
            <div
              key={c.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border border-border/50 px-3 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">
                    {c.nombreArchivo || "Comprobante"}
                  </span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
                    {meta.label}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Recibido el {formatDate(c.creadoEn)}
                  {c.resueltoEn ? ` · Resuelto el ${formatDate(c.resueltoEn)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => setVerComprobante(c)}
                  data-testid={`button-ver-comprobante-${c.id}`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  {c.estado === "pendiente" ? "Ver comprobante y confirmar pago" : "Ver comprobante"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!verComprobante} onOpenChange={(open) => !open && setVerComprobante(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Comprobante de transferencia</DialogTitle>
            <DialogDescription>
              {verComprobante?.nombreArchivo || "Archivo enviado por el cliente"} · Recibido el{" "}
              {verComprobante ? formatDate(verComprobante.creadoEn) : ""}
            </DialogDescription>
          </DialogHeader>
          {verComprobante && (
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              {verComprobante.archivo.startsWith("data:application/pdf") ? (
                <iframe
                  src={verComprobante.archivo}
                  title="Comprobante PDF"
                  className="w-full h-[50vh]"
                />
              ) : (
                <img src={verComprobante.archivo} alt="Comprobante" className="w-full h-auto" />
              )}
            </div>
          )}
          {verComprobante?.comentario && (
            <p className="text-sm text-muted-foreground">"{verComprobante.comentario}"</p>
          )}
          {verComprobante?.estado === "pendiente" && (
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10 border-destructive/30"
                onClick={() => handleRechazar(verComprobante.id)}
                disabled={rechazar.isPending || confirmar.isPending}
                data-testid="button-rechazar-comprobante"
              >
                {rechazar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <XCircle className="h-4 w-4 mr-1.5" />}
                Rechazar
              </Button>
              <Button
                onClick={() => handleConfirmar(verComprobante.id)}
                disabled={confirmar.isPending || rechazar.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
                data-testid="button-confirmar-pago"
              >
                {confirmar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                Confirmar pago
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
