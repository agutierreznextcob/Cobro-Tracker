import { useState } from "react";
import {
  useGetCobro,
  getGetCobroQueryKey,
  useUpdateCobro,
  useGenerarFlowLink,
  useGenerarMpLink,
  useEnviarRecordatorioEmail,
  getListCobrosQueryKey,
  getGetCobrosSummaryQueryKey,
} from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import {
  ArrowLeft,
  RefreshCw,
  Calendar,
  FileText,
  Hash,
  Wallet,
  User,
  Link2,
  ExternalLink,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
} from "lucide-react";
import { CobroUpdateEstado } from "@workspace/api-client-react";

function buildWhatsappUrl(opts: {
  clienteNombre: string | null;
  monto: number;
  descripcion: string;
  linkPago: string;
}): string {
  const nombre = opts.clienteNombre || "cliente";
  const monto = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(opts.monto));

  const msg =
    `Hola ${nombre}, tienes un cobro pendiente de ${monto} ` +
    `por concepto de "${opts.descripcion}". ` +
    `Puedes pagar aquí: ${opts.linkPago}`;

  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export default function CobroDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);

  const { data: cobro, isLoading } = useGetCobro(id, {
    query: { enabled: !!id, queryKey: getGetCobroQueryKey(id) },
  });
  const updateCobro = useUpdateCobro();
  const generarFlowLink = useGenerarFlowLink();
  const generarMpLink = useGenerarMpLink();
  const enviarRecordatorio = useEnviarRecordatorioEmail();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [emailPagador, setEmailPagador] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);

  const handleStatusChange = (newStatus: string) => {
    updateCobro.mutate(
      { id, data: { estado: newStatus as CobroUpdateEstado } },
      {
        onSuccess: () => {
          toast({ title: "Estado actualizado", description: `Cobro marcado como ${newStatus}.` });
          queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
        },
        onError: () => {
          toast({ title: "Error al actualizar", description: "No se pudo cambiar el estado.", variant: "destructive" });
        },
      }
    );
  };

  const handleGenerarLink = () => {
    const email = emailPagador.trim() || cobro?.emailPagador || "";
    if (!email) {
      setShowEmailInput(true);
      return;
    }
    generarFlowLink.mutate(
      { id, data: { emailPagador: email } },
      {
        onSuccess: () => {
          toast({ title: "Link de pago generado", description: "El link de Flow fue creado y el email fue enviado al cliente." });
          queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
          setShowEmailInput(false);
          setEmailPagador("");
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo generar el link.";
          toast({ title: "Error al generar link Flow", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleCopyLink = async () => {
    if (cobro?.flowLinkPago) {
      await navigator.clipboard.writeText(cobro.flowLinkPago);
      toast({ title: "Link copiado", description: "El link de pago fue copiado al portapapeles." });
    }
  };

  const handleRecordatorioEmail = () => {
    enviarRecordatorio.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Recordatorio enviado", description: "El email de recordatorio fue enviado al cliente." });
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo enviar el recordatorio.";
          toast({ title: "Error al enviar recordatorio", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleWhatsApp = () => {
    if (!cobro?.flowLinkPago) return;
    const url = buildWhatsappUrl({
      clienteNombre: cobro.clienteNombre ?? null,
      monto: cobro.monto,
      descripcion: cobro.descripcion,
      linkPago: cobro.flowLinkPago,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleGenerarMpLink = () => {
    generarMpLink.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Link de pago generado", description: "El link de MercadoPago fue creado exitosamente." });
          queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo generar el link.";
          toast({ title: "Error al generar link MP", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleCopyMpLink = async () => {
    if (cobro?.mpPaymentLinkUrl) {
      await navigator.clipboard.writeText(cobro.mpPaymentLinkUrl);
      toast({ title: "Link copiado", description: "El link de MercadoPago fue copiado al portapapeles." });
    }
  };

  const handleWhatsAppMp = () => {
    if (!cobro?.mpPaymentLinkUrl) return;
    const url = buildWhatsappUrl({
      clienteNombre: cobro.clienteNombre ?? null,
      monto: cobro.monto,
      descripcion: cobro.descripcion,
      linkPago: cobro.mpPaymentLinkUrl,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <Card className="animate-pulse">
          <CardHeader className="h-20 bg-muted/50 border-b border-border/50" />
          <CardContent className="h-64 bg-muted/20" />
        </Card>
      </div>
    );
  }

  if (!cobro) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <h2 className="text-2xl font-bold mb-2">Cobro no encontrado</h2>
        <p className="text-muted-foreground mb-6">El cobro que buscas no existe o fue eliminado.</p>
        <Link href="/dashboard">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver al Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const isPendiente = cobro.estado === "pendiente";
  const hasFlowLink = !!cobro.flowLinkPago;
  const hasMpLink = !!cobro.mpPaymentLinkUrl;
  const hasEmail = !!cobro.emailPagador;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
      <Link
        href="/dashboard"
        className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver al Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cobro #{cobro.id}</h1>
          <p className="text-muted-foreground mt-1">Creado el {formatDate(cobro.creadoEn)}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-card border rounded-md px-3 py-1.5 shadow-sm flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Estado:</span>
            <Select
              value={cobro.estado}
              onValueChange={handleStatusChange}
              disabled={updateCobro.isPending}
            >
              <SelectTrigger className="w-[140px] h-8 border-0 bg-transparent p-0 focus:ring-0 [&>span]:flex [&>span]:items-center [&>span]:gap-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CobroUpdateEstado.pendiente}>Pendiente</SelectItem>
                <SelectItem value={CobroUpdateEstado.pagado}>Pagado</SelectItem>
                <SelectItem value={CobroUpdateEstado.fallido}>Fallido</SelectItem>
                <SelectItem value={CobroUpdateEstado.cancelado}>Cancelado</SelectItem>
              </SelectContent>
            </Select>
            {updateCobro.isPending && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground ml-2" />}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main details */}
        <Card className="md:col-span-2 shadow-sm border-border/50">
          <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Detalles
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Descripción</p>
              <p className="text-base">{cobro.descripcion}</p>
            </div>

            <div className="grid grid-cols-2 gap-6 pt-4 border-t border-border/50">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" /> Referencia
                </p>
                <p className="font-mono text-sm">{cobro.referencia || "No especificada"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Última actualización
                </p>
                <p className="text-sm">{cobro.actualizadoEn ? formatDate(cobro.actualizadoEn) : "Nunca"}</p>
              </div>
            </div>

            {cobro.responsableNombre && (
              <div className="pt-4 border-t border-border/50">
                <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" /> Responsable
                </p>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
                    {cobro.responsableNombre
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <span className="text-sm font-medium">{cobro.responsableNombre}</span>
                </div>
              </div>
            )}

            {cobro.emailPagador && (
              <div className="pt-4 border-t border-border/50">
                <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email del pagador
                </p>
                <p className="text-sm font-mono">{cobro.emailPagador}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Amount card */}
          <Card className="shadow-sm border-primary/20 bg-primary/5">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                Monto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold font-mono text-primary tracking-tight">
                {formatCurrency(cobro.monto)}
              </div>
              <div className="mt-6 pt-6 border-t border-primary/10">
                <StatusBadge status={cobro.estado} />
              </div>
            </CardContent>
          </Card>

          {/* Flow payment card */}
          <Card className="shadow-sm border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                Pago con Flow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasFlowLink ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Orden Flow: <span className="font-mono">{cobro.flowOrdenId}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {/* Primary: send email */}
                    {hasEmail ? (
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={handleRecordatorioEmail}
                        disabled={enviarRecordatorio.isPending}
                      >
                        {enviarRecordatorio.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Enviando...</>
                        ) : (
                          <><Mail className="h-3.5 w-3.5 mr-1.5" />Enviar por email</>
                        )}
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        Sin email del pagador para enviar.
                      </p>
                    )}
                    {/* WhatsApp */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-green-600/40 text-green-700 hover:bg-green-50 hover:border-green-600"
                      onClick={handleWhatsApp}
                    >
                      <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                      Enviar por WhatsApp
                    </Button>
                    {/* Secondary: link actions row */}
                    <div className="flex gap-1.5 pt-1">
                      <a
                        href={cobro.flowLinkPago ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border h-8 px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Ir al pago
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground"
                        onClick={handleCopyLink}
                        title="Copiar link"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {showEmailInput ? (
                    <div className="space-y-2">
                      <Label htmlFor="emailPagador" className="text-xs">Email del pagador</Label>
                      <Input
                        id="emailPagador"
                        type="email"
                        placeholder="pagador@ejemplo.com"
                        value={emailPagador}
                        onChange={(e) => setEmailPagador(e.target.value)}
                        className="h-8 text-sm"
                        onKeyDown={(e) => e.key === "Enter" && handleGenerarLink()}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleGenerarLink}
                          disabled={generarFlowLink.isPending}
                          className="flex-1"
                        >
                          {generarFlowLink.isPending ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Generando...</>
                          ) : (
                            "Generar"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setShowEmailInput(false); setEmailPagador(""); }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Genera un link de pago real en Flow. Se enviará un email al cliente automáticamente.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={handleGenerarLink}
                        disabled={generarFlowLink.isPending}
                      >
                        {generarFlowLink.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Generando...</>
                        ) : (
                          <><Link2 className="h-3.5 w-3.5 mr-1.5" />Generar link Flow</>
                        )}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* MercadoPago payment card */}
          <Card className="shadow-sm border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Link2 className="h-4 w-4 text-[#009ee3]" />
                Pago con MercadoPago
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasMpLink ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-green-600/40 text-green-700 hover:bg-green-50 hover:border-green-600"
                      onClick={handleWhatsAppMp}
                    >
                      <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                      Enviar por WhatsApp
                    </Button>
                    <div className="flex gap-1.5 pt-1">
                      <a
                        href={cobro.mpPaymentLinkUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border h-8 px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Ir al pago
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground"
                        onClick={handleCopyMpLink}
                        title="Copiar link"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Genera un link de pago en MercadoPago. Requiere tener tu Access Token configurado en el perfil.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={handleGenerarMpLink}
                    disabled={generarMpLink.isPending}
                  >
                    {generarMpLink.isPending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Generando...</>
                    ) : (
                      <><Link2 className="h-3.5 w-3.5 mr-1.5" />Generar link MercadoPago</>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Communication card — only for pending cobros with flow link */}
          {isPendiente && hasFlowLink && (
            <Card className="shadow-sm border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  Recordar al cliente
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {hasEmail ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleRecordatorioEmail}
                    disabled={enviarRecordatorio.isPending}
                  >
                    {enviarRecordatorio.isPending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Enviando...</>
                    ) : (
                      <><Mail className="h-3.5 w-3.5 mr-1.5" />Recordar por email</>
                    )}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sin email del pagador. Agrega uno para enviar recordatorios.
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-green-600/40 text-green-700 hover:bg-green-50 hover:border-green-600"
                  onClick={handleWhatsApp}
                >
                  <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                  Recordar por WhatsApp
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
