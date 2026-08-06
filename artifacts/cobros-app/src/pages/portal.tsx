import { useParams } from "wouter";
import { useRef, useState } from "react";
import { useGetPortalDeudor, useSubirComprobantePortal } from "@workspace/api-client-react";
import type { PortalCobro } from "@workspace/api-client-react";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { Building2, CheckCircle2, Clock, AlertTriangle, ExternalLink, Receipt, Upload, Loader2, FileCheck2 } from "lucide-react";

const MAX_COMPROBANTE_CHARS = 1_500_000;

function SubirComprobanteButton({ token, cobroId }: { token: string; cobroId: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const subir = useSubirComprobantePortal();
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    setError(null);
    if (!/^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/.test(file.type)) {
      setError("Sube una imagen (JPG, PNG) o un PDF.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      if (dataUrl.length > MAX_COMPROBANTE_CHARS) {
        setError("El archivo es muy pesado. Máximo ~1 MB.");
        return;
      }
      try {
        await subir.mutateAsync({
          token,
          data: { cobroId, archivo: dataUrl, nombreArchivo: file.name },
        });
        setEnviado(true);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "No se pudo enviar el comprobante. Inténtalo de nuevo.";
        setError(msg);
      }
    };
    reader.readAsDataURL(file);
  };

  if (enviado) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700" data-testid="comprobante-enviado">
        <FileCheck2 className="h-4 w-4" />
        Comprobante enviado. Te confirmarán el pago pronto.
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={subir.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#6C5CE7] px-4 py-2 text-sm font-medium text-[#6C5CE7] hover:bg-[#6C5CE7]/5 transition-colors disabled:opacity-60"
        data-testid="button-subir-comprobante"
      >
        {subir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {subir.isPending ? "Enviando..." : "Enviar comprobante"}
      </button>
      {error && <span className="text-[11px] text-red-600 max-w-52 text-right">{error}</span>}
    </div>
  );
}

const ESTADO_META: Record<
  PortalCobro["estado"],
  { label: string; className: string; icon: typeof Clock }
> = {
  pendiente: {
    label: "Pendiente",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Clock,
  },
  vencido: {
    label: "Vencido",
    className: "bg-red-50 text-red-700 border-red-200",
    icon: AlertTriangle,
  },
  parcial: {
    label: "Pago parcial",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    icon: Clock,
  },
  pagado: {
    label: "Pagado",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
  },
};

function EstadoBadge({ estado }: { estado: PortalCobro["estado"] }) {
  const meta = ESTADO_META[estado];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export default function PortalPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useGetPortalDeudor(token);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Cargando...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Enlace no válido</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Este enlace de pago ya no está disponible: es posible que haya sido reemplazado por uno
            nuevo. Pide el enlace actualizado a la empresa que te contactó.
          </p>
        </div>
      </div>
    );
  }

  const totalPendiente = data.pendientes.reduce((acc, c) => acc + c.saldo, 0);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Brand header */}
      <header className="bg-[#6C5CE7] text-white">
        <div className="mx-auto max-w-3xl px-5 py-8">
          <div className="flex items-center gap-2 text-white/80 text-sm font-medium mb-3">
            <Building2 className="h-4 w-4" />
            {data.empresa}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Hola, {data.clienteNombre}</h1>
          <p className="text-white/80 text-sm mt-1">
            {data.pendientes.length > 0
              ? `Tienes ${data.pendientes.length} cobro${data.pendientes.length !== 1 ? "s" : ""} pendiente${data.pendientes.length !== 1 ? "s" : ""} de pago.`
              : "No tienes cobros pendientes. ¡Gracias!"}
          </p>
          {data.pendientes.length > 0 && (
            <div className="mt-5 rounded-xl bg-white/10 backdrop-blur px-4 py-3">
              <p className="text-xs text-white/70">Total por pagar</p>
              <p className="text-3xl font-bold tracking-tight mt-0.5">
                {formatCurrency(totalPendiente)}
              </p>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 space-y-8">
        {/* Pendientes */}
        {data.pendientes.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Cobros pendientes
            </h2>
            <div className="space-y-3">
              {data.pendientes.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border bg-card p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{c.descripcion}</p>
                      <EstadoBadge estado={c.estado} />
                    </div>
                    {c.fechaVencimiento && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Vence el {formatShortDate(c.fechaVencimiento)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end shrink-0">
                    <div className="text-right">
                      <p className="font-mono font-semibold text-lg">{formatCurrency(c.saldo)}</p>
                      {c.saldo !== c.montoACobrar && (
                        <p className="text-[11px] text-muted-foreground">
                          de {formatCurrency(c.montoACobrar)}
                        </p>
                      )}
                    </div>
                    {c.linkPago ? (
                      <a
                        href={c.linkPago}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#6C5CE7] px-4 py-2 text-sm font-medium text-white hover:bg-[#5a4cd1] transition-colors"
                      >
                        Pagar
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <SubirComprobanteButton token={token!} cobroId={c.id} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pagados */}
        {data.pagados.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Historial de pagos
            </h2>
            <div className="rounded-xl border bg-card shadow-sm divide-y">
              {data.pagados.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.descripcion}</p>
                      {c.fechaVencimiento && (
                        <p className="text-xs text-muted-foreground">
                          {formatShortDate(c.fechaVencimiento)}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="font-mono text-sm text-muted-foreground shrink-0">
                    {formatCurrency(c.montoACobrar)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.pendientes.length === 0 && data.pagados.length === 0 && (
          <div className="text-center py-16">
            <div className="mx-auto h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Receipt className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">No hay cobros registrados.</p>
          </div>
        )}

        <footer className="pt-4 text-center">
          <p className="text-xs text-muted-foreground">
            Pagos procesados de forma segura · {data.empresa}
          </p>
        </footer>
      </main>
    </div>
  );
}
