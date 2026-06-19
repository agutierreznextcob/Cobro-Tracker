import { useEffect, useState } from "react";
import {
  useGetCobro,
  getGetCobroQueryKey,
  useUpdateCobro,
  useGenerarFlowLink,
  useGenerarMpLink,
  useEnviarRecordatorioEmail,
  useAvisarCliente,
  useListSeguimientos,
  getListCobrosQueryKey,
  getGetCobrosSummaryQueryKey,
  useListAbonos,
  useCrearAbono,
  useConfirmarAbono,
  getListAbonosQueryKey,
  useListRecordatorios,
  useCreateRecordatorio,
  useDeleteRecordatorio,
  useListRecordatoriosHistorial,
  getListRecordatoriosQueryKey,
  getListRecordatoriosHistorialQueryKey,
  type RecordatorioInputCanal,
  type RecordatorioInputMomento,
} from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate, formatDateOnly } from "@/lib/format";
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
  CheckCircle2,
  Clock,
  Send,
  Plus,
  CreditCard,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Bell,
  Trash2,
  CalendarClock,
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

function describirRecordatorio(canal: string, momento: string, diasOffset: number): string {
  const canalLabel = canal === "ambos" ? "Email y WhatsApp" : canal === "whatsapp" ? "WhatsApp" : "Email";
  const dias = diasOffset === 1 ? "1 día" : `${diasOffset} días`;
  let cuando: string;
  switch (momento) {
    case "antes":
      cuando = `${dias} antes del vencimiento`;
      break;
    case "dia":
      cuando = "el día del vencimiento";
      break;
    case "despues":
      cuando = `${dias} después del vencimiento`;
      break;
    case "recurrente":
      cuando = `cada ${dias} tras el vencimiento`;
      break;
    default:
      cuando = momento;
  }
  return `${canalLabel} · ${cuando}`;
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

  // Link generation modal state
  const [showFlowConfig, setShowFlowConfig] = useState(false);
  const [showMpConfig, setShowMpConfig] = useState(false);
  const [linkTipo, setLinkTipo] = useState<"total" | "parcial">("total");
  const [linkMonto, setLinkMonto] = useState("");
  const [linkEmail, setLinkEmail] = useState("");

  const resetLinkConfig = () => {
    setShowFlowConfig(false);
    setShowMpConfig(false);
    setLinkTipo("total");
    setLinkMonto("");
    setLinkEmail("");
  };

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

  const handleConfirmarFlowLink = () => {
    const email = linkEmail.trim() || cobro?.emailPagador || "";
    if (!email) {
      toast({ title: "Email requerido", description: "Ingresa el email del pagador para generar el link de Flow.", variant: "destructive" });
      return;
    }
    if (linkTipo === "parcial") {
      const montoNum = Math.round(parseFloat(linkMonto.replace(/\./g, "").replace(",", ".")));
      if (!montoNum || montoNum <= 0) {
        toast({ title: "Monto inválido", description: "Ingresa un monto válido.", variant: "destructive" });
        return;
      }
      if (montoNum > saldoPendiente) {
        toast({ title: "Monto excede saldo", description: `El monto no puede superar el saldo pendiente (${formatCurrency(saldoPendiente)}).`, variant: "destructive" });
        return;
      }
      crearAbono.mutate(
        { id, data: { monto: montoNum, metodo: "flow", emailPagador: email } },
        {
          onSuccess: () => {
            toast({ title: "Abono generado", description: "El link de pago parcial en Flow fue creado." });
            queryClient.invalidateQueries({ queryKey: getListAbonosQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
            resetLinkConfig();
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : "No se pudo generar el link.";
            toast({ title: "Error al crear abono Flow", description: msg, variant: "destructive" });
          },
        }
      );
    } else {
      generarFlowLink.mutate(
        { id, data: { emailPagador: email } },
        {
          onSuccess: () => {
            toast({ title: "Link de pago generado", description: "El link de Flow fue creado y el email fue enviado al cliente." });
            queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
            resetLinkConfig();
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : "No se pudo generar el link.";
            toast({ title: "Error al generar link Flow", description: msg, variant: "destructive" });
          },
        }
      );
    }
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

  const handleConfirmarMpLink = () => {
    if (linkTipo === "parcial") {
      const montoNum = Math.round(parseFloat(linkMonto.replace(/\./g, "").replace(",", ".")));
      if (!montoNum || montoNum <= 0) {
        toast({ title: "Monto inválido", description: "Ingresa un monto válido.", variant: "destructive" });
        return;
      }
      if (montoNum > saldoPendiente) {
        toast({ title: "Monto excede saldo", description: `El monto no puede superar el saldo pendiente (${formatCurrency(saldoPendiente)}).`, variant: "destructive" });
        return;
      }
      crearAbono.mutate(
        { id, data: { monto: montoNum, metodo: "mp" } },
        {
          onSuccess: () => {
            toast({ title: "Abono generado", description: "El link de pago parcial en MercadoPago fue creado." });
            queryClient.invalidateQueries({ queryKey: getListAbonosQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
            resetLinkConfig();
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : "No se pudo generar el link.";
            toast({ title: "Error al crear abono MP", description: msg, variant: "destructive" });
          },
        }
      );
    } else {
      generarMpLink.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Link de pago generado", description: "El link de MercadoPago fue creado exitosamente." });
            queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
            resetLinkConfig();
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : "No se pudo generar el link.";
            toast({ title: "Error al generar link MP", description: msg, variant: "destructive" });
          },
        }
      );
    }
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

  // --- Abonos / pagos parciales ---
  const { data: abonos, isLoading: isLoadingAbonos } = useListAbonos(id, {
    query: { enabled: !!id, queryKey: getListAbonosQueryKey(id) },
  });
  const crearAbono = useCrearAbono();
  const confirmarAbono = useConfirmarAbono();
  const [abonoMonto, setAbonoMonto] = useState("");
  const [abonoMetodo, setAbonoMetodo] = useState<"flow" | "mp" | "manual">("manual");
  const [abonoEmail, setAbonoEmail] = useState("");
  const [abonoNotas, setAbonoNotas] = useState("");
  const [showAbonoForm, setShowAbonoForm] = useState(false);

  const totalAbonado = (abonos ?? []).filter((a) => a.estado === "confirmado").reduce((acc, a) => acc + a.monto, 0);
  const saldoPendiente = cobro ? cobro.monto - totalAbonado : 0;

  const handleCrearAbono = () => {
    const montoNum = parseFloat(abonoMonto.replace(/\./g, "").replace(",", "."));
    if (!montoNum || montoNum <= 0) {
      toast({ title: "Monto inválido", description: "Ingresa un monto válido.", variant: "destructive" });
      return;
    }
    const body: { monto: number; metodo: "flow" | "mp" | "manual"; notas?: string; emailPagador?: string } = {
      monto: montoNum,
      metodo: abonoMetodo,
      ...(abonoNotas ? { notas: abonoNotas } : {}),
      ...(abonoMetodo === "flow" && abonoEmail ? { emailPagador: abonoEmail } : {}),
    };
    crearAbono.mutate(
      { id, data: body },
      {
        onSuccess: () => {
          toast({ title: "Abono registrado", description: abonoMetodo === "manual" ? "Abono manual confirmado." : "Link de pago generado para el abono." });
          queryClient.invalidateQueries({ queryKey: getListAbonosQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
          setAbonoMonto("");
          setAbonoNotas("");
          setAbonoEmail("");
          setShowAbonoForm(false);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo registrar el abono.";
          toast({ title: "Error al crear abono", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleConfirmarAbono = (abonoId: number) => {
    confirmarAbono.mutate(
      { id, abonoId },
      {
        onSuccess: () => {
          toast({ title: "Abono confirmado", description: "El abono fue marcado como confirmado." });
          queryClient.invalidateQueries({ queryKey: getListAbonosQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo confirmar el abono.", variant: "destructive" });
        },
      }
    );
  };

  // --- Seguimiento de cobranza manual ---
  const avisarCliente = useAvisarCliente();
  const { data: seguimientos, isLoading: isLoadingSeguimientos } = useListSeguimientos(id, {
    query: { enabled: !!id, queryKey: ["listSeguimientos", id] as const },
  });

  const noTieneLink = !cobro?.flowLinkPago && !cobro?.mpPaymentLinkUrl;

  const handleAvisarEmail = () => {
    avisarCliente.mutate(
      { id, data: { tipo: "email" } },
      {
        onSuccess: (res) => {
          if (res.emailEnviado) {
            toast({ title: "Aviso enviado", description: "El email fue enviado al cliente y se registró el seguimiento." });
          } else {
            toast({ title: "Seguimiento registrado", description: res.emailError ? `No se pudo enviar el email: ${res.emailError}` : "Seguimiento registrado sin email.", variant: res.emailError ? "destructive" : "default" });
          }
          queryClient.invalidateQueries({ queryKey: ["listSeguimientos", id] });
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo registrar el aviso.";
          toast({ title: "Error al avisar", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleAvisarWhatsApp = () => {
    if (!cobro) return;
    const monto = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(cobro.monto));
    const nombre = cobro.clienteNombre || "cliente";
    const msg = `Hola ${nombre}, tienes un cobro pendiente de ${monto} por concepto de "${cobro.descripcion}". Por favor comunícate para coordinar el pago.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");

    avisarCliente.mutate(
      { id, data: { tipo: "whatsapp" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["listSeguimientos", id] });
        },
      }
    );
  };

  // --- Recordatorios automáticos ---
  const { data: recordatorios, isLoading: isLoadingRecordatorios } = useListRecordatorios(id, {
    query: { enabled: !!id, queryKey: getListRecordatoriosQueryKey(id) },
  });
  const { data: recordatoriosHistorial, isLoading: isLoadingHistorial } = useListRecordatoriosHistorial(id, {
    query: { enabled: !!id, queryKey: getListRecordatoriosHistorialQueryKey(id) },
  });
  const crearRecordatorio = useCreateRecordatorio();
  const eliminarRecordatorio = useDeleteRecordatorio();

  const [nuevoCanal, setNuevoCanal] = useState<RecordatorioInputCanal>("email");
  const [nuevoMomento, setNuevoMomento] = useState<RecordatorioInputMomento>("despues");
  const [nuevoDias, setNuevoDias] = useState<string>("3");
  const [fechaVencimientoInput, setFechaVencimientoInput] = useState<string>("");

  useEffect(() => {
    setFechaVencimientoInput(cobro?.fechaVencimiento ?? "");
  }, [cobro?.fechaVencimiento]);

  const handleGuardarVencimiento = (valor: string | null) => {
    updateCobro.mutate(
      { id, data: { fechaVencimiento: valor } },
      {
        onSuccess: () => {
          toast({
            title: valor ? "Fecha de vencimiento actualizada" : "Fecha de vencimiento eliminada",
            description: valor
              ? "Se actualizó la fecha de vencimiento del cobro."
              : "El cobro ya no tiene fecha de vencimiento.",
          });
          queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
          invalidarRecordatorios();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo actualizar la fecha de vencimiento.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const invalidarRecordatorios = () => {
    queryClient.invalidateQueries({ queryKey: getListRecordatoriosQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListRecordatoriosHistorialQueryKey(id) });
  };

  const handleAgregarRecordatorio = () => {
    const dias = nuevoMomento === "dia" ? 0 : parseInt(nuevoDias || "0", 10);
    if (nuevoMomento !== "dia" && (isNaN(dias) || dias < 1)) {
      toast({ title: "Días inválidos", description: "Indica un número de días mayor a 0.", variant: "destructive" });
      return;
    }
    crearRecordatorio.mutate(
      { id, data: { canal: nuevoCanal, momento: nuevoMomento, diasOffset: dias } },
      {
        onSuccess: () => {
          toast({ title: "Recordatorio agregado", description: "Se programó el recordatorio automático." });
          setNuevoDias("3");
          invalidarRecordatorios();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo agregar el recordatorio.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleEliminarRecordatorio = (recordatorioId: number) => {
    eliminarRecordatorio.mutate(
      { id, recordatorioId },
      {
        onSuccess: () => {
          toast({ title: "Recordatorio eliminado", description: "El recordatorio fue eliminado." });
          invalidarRecordatorios();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo eliminar el recordatorio.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleMarcarPagado = () => {
    updateCobro.mutate(
      { id, data: { estado: "pagado" as CobroUpdateEstado } },
      {
        onSuccess: () => {
          toast({ title: "Cobro marcado como pagado", description: "El estado fue actualizado correctamente." });
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
                <SelectItem value="parcial">Parcial</SelectItem>
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
                  {showFlowConfig ? (
                    <div className="space-y-2.5">
                      {/* Tipo de pago */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tipo de pago</Label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setLinkTipo("total")}
                            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${linkTipo === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                          >
                            Pago total
                          </button>
                          <button
                            type="button"
                            onClick={() => setLinkTipo("parcial")}
                            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${linkTipo === "parcial" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                          >
                            Pago parcial
                          </button>
                        </div>
                      </div>
                      {/* Monto (solo si parcial) */}
                      {linkTipo === "parcial" && (
                        <div className="space-y-1">
                          <Label htmlFor="flowLinkMonto" className="text-xs">
                            Monto del abono <span className="text-muted-foreground">(saldo: {formatCurrency(saldoPendiente)})</span>
                          </Label>
                          <Input
                            id="flowLinkMonto"
                            type="number"
                            placeholder="0"
                            min={1}
                            max={saldoPendiente}
                            value={linkMonto}
                            onChange={(e) => setLinkMonto(e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                      )}
                      {/* Email (si no hay email del cobro) */}
                      {!cobro?.emailPagador && (
                        <div className="space-y-1">
                          <Label htmlFor="flowLinkEmail" className="text-xs">Email del pagador</Label>
                          <Input
                            id="flowLinkEmail"
                            type="email"
                            placeholder="pagador@ejemplo.com"
                            value={linkEmail}
                            onChange={(e) => setLinkEmail(e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                      )}
                      {/* Acciones */}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleConfirmarFlowLink}
                          disabled={generarFlowLink.isPending || crearAbono.isPending}
                          className="flex-1"
                        >
                          {(generarFlowLink.isPending || crearAbono.isPending) ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Generando...</>
                          ) : (
                            <><Link2 className="h-3.5 w-3.5 mr-1" />Generar link</>
                          )}
                        </Button>
                        <Button size="sm" variant="outline" onClick={resetLinkConfig}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Genera un link de pago en Flow. Se enviará un email al cliente automáticamente.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => { setShowFlowConfig(true); setLinkTipo("total"); setLinkMonto(""); setLinkEmail(""); }}
                        disabled={generarFlowLink.isPending}
                      >
                        <><Link2 className="h-3.5 w-3.5 mr-1.5" />Generar link Flow</>
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
                  {showMpConfig ? (
                    <div className="space-y-2.5">
                      {/* Tipo de pago */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tipo de pago</Label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setLinkTipo("total")}
                            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${linkTipo === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                          >
                            Pago total
                          </button>
                          <button
                            type="button"
                            onClick={() => setLinkTipo("parcial")}
                            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${linkTipo === "parcial" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                          >
                            Pago parcial
                          </button>
                        </div>
                      </div>
                      {/* Monto (solo si parcial) */}
                      {linkTipo === "parcial" && (
                        <div className="space-y-1">
                          <Label htmlFor="mpLinkMonto" className="text-xs">
                            Monto del abono <span className="text-muted-foreground">(saldo: {formatCurrency(saldoPendiente)})</span>
                          </Label>
                          <Input
                            id="mpLinkMonto"
                            type="number"
                            placeholder="0"
                            min={1}
                            max={saldoPendiente}
                            value={linkMonto}
                            onChange={(e) => setLinkMonto(e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                      )}
                      {/* Acciones */}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleConfirmarMpLink}
                          disabled={generarMpLink.isPending || crearAbono.isPending}
                          className="flex-1"
                        >
                          {(generarMpLink.isPending || crearAbono.isPending) ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Generando...</>
                          ) : (
                            <><Link2 className="h-3.5 w-3.5 mr-1" />Generar link</>
                          )}
                        </Button>
                        <Button size="sm" variant="outline" onClick={resetLinkConfig}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Genera un link de pago en MercadoPago. Requiere tener tu Access Token configurado en el perfil.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => { setShowMpConfig(true); setLinkTipo("total"); setLinkMonto(""); }}
                        disabled={generarMpLink.isPending}
                      >
                        <><Link2 className="h-3.5 w-3.5 mr-1.5" />Generar link MercadoPago</>
                      </Button>
                    </>
                  )}
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

          {/* Seguimiento de cobranza manual — only for cobros sin pasarela */}
          {noTieneLink && (
            <Card className="shadow-sm border-amber-200/60 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-800/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  Seguimiento de cobranza
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Este cobro no tiene pasarela de pago. Registra los avisos que hagas al cliente.
                </p>

                {/* Acciones */}
                {isPendiente && (
                  <div className="flex flex-col gap-2">
                    {hasEmail && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={handleAvisarEmail}
                        disabled={avisarCliente.isPending}
                      >
                        {avisarCliente.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Enviando...</>
                        ) : (
                          <><Send className="h-3.5 w-3.5 mr-1.5" />Avisar por email</>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-green-600/40 text-green-700 hover:bg-green-50 hover:border-green-600"
                      onClick={handleAvisarWhatsApp}
                      disabled={avisarCliente.isPending}
                    >
                      <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                      Avisar por WhatsApp
                    </Button>
                    <Button
                      size="sm"
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={handleMarcarPagado}
                      disabled={updateCobro.isPending}
                    >
                      {updateCobro.isPending ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Actualizando...</>
                      ) : (
                        <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Marcar como pagado</>
                      )}
                    </Button>
                  </div>
                )}

                {/* Historial */}
                {isLoadingSeguimientos ? (
                  <div className="space-y-2 pt-1">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-10 bg-muted/40 rounded animate-pulse" />
                    ))}
                  </div>
                ) : seguimientos && seguimientos.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Historial</p>
                    {seguimientos.map((seg) => (
                      <div key={seg.id} className="flex items-start gap-2 rounded-md border border-border/50 bg-background/60 px-3 py-2">
                        {seg.tipo === "email" ? (
                          <Mail className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                        ) : (
                          <MessageCircle className="h-3.5 w-3.5 mt-0.5 text-green-600 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium capitalize">{seg.tipo}</p>
                          {seg.notas && <p className="text-[11px] text-muted-foreground truncate">{seg.notas}</p>}
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {formatDate(seg.creadoEn)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/60 text-center py-1">Sin avisos registrados aún.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recordatorios automáticos */}
      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Recordatorios automáticos
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          {/* Editar fecha de vencimiento */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
            <div className="space-y-1.5 flex-1">
              <Label className="text-xs">Fecha de vencimiento</Label>
              <Input
                type="date"
                value={fechaVencimientoInput}
                onChange={(e) => setFechaVencimientoInput(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <Button
              onClick={() => handleGuardarVencimiento(fechaVencimientoInput || null)}
              disabled={
                updateCobro.isPending ||
                !fechaVencimientoInput ||
                fechaVencimientoInput === (cobro?.fechaVencimiento ?? "")
              }
              className="h-9 gap-1.5"
            >
              {updateCobro.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
            {cobro?.fechaVencimiento ? (
              <Button
                variant="outline"
                onClick={() => handleGuardarVencimiento(null)}
                disabled={updateCobro.isPending}
                className="h-9"
              >
                Quitar
              </Button>
            ) : null}
          </div>

          {!cobro?.fechaVencimiento ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-3">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Agrega una fecha de vencimiento a este cobro para programar recordatorios automáticos.
              </p>
            </div>
          ) : (
            <>
              {/* Formulario para agregar */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">Canal</Label>
                  <Select value={nuevoCanal} onValueChange={(v) => setNuevoCanal(v as RecordatorioInputCanal)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="ambos">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">Momento</Label>
                  <Select value={nuevoMomento} onValueChange={(v) => setNuevoMomento(v as RecordatorioInputMomento)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="antes">Antes del vencimiento</SelectItem>
                      <SelectItem value="dia">El día del vencimiento</SelectItem>
                      <SelectItem value="despues">Después del vencimiento</SelectItem>
                      <SelectItem value="recurrente">Recurrente (cada X días)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {nuevoMomento !== "dia" && (
                  <div className="space-y-1.5 w-full sm:w-24">
                    <Label className="text-xs">Días</Label>
                    <Input
                      type="number"
                      min={1}
                      value={nuevoDias}
                      onChange={(e) => setNuevoDias(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                )}
                <Button
                  onClick={handleAgregarRecordatorio}
                  disabled={crearRecordatorio.isPending}
                  className="h-9 gap-1.5"
                >
                  {crearRecordatorio.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Agregar
                </Button>
              </div>

              {/* Lista de recordatorios */}
              {isLoadingRecordatorios ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="h-12 bg-muted/40 rounded animate-pulse" />)}
                </div>
              ) : !recordatorios || recordatorios.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">
                  No hay recordatorios programados para este cobro.
                </p>
              ) : (
                <div className="space-y-2">
                  {recordatorios.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {r.canal === "whatsapp" ? (
                          <MessageCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                        ) : r.canal === "ambos" ? (
                          <Send className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <Mail className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <span className="text-sm truncate">{describirRecordatorio(r.canal, r.momento, r.diasOffset)}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => handleEliminarRecordatorio(r.id)}
                        disabled={eliminarRecordatorio.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Historial de recordatorios */}
      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Historial de recordatorios
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoadingHistorial ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-12 bg-muted/40 rounded animate-pulse" />)}
            </div>
          ) : !recordatoriosHistorial || recordatoriosHistorial.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">
              Aún no se han enviado recordatorios para este cobro.
            </p>
          ) : (
            <div className="space-y-2">
              {recordatoriosHistorial.map((h) => {
                const isEnviado = h.estado === "enviado";
                const isFallido = h.estado === "fallido";
                return (
                  <div
                    key={h.id}
                    className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${
                      isEnviado ? "border-emerald-200 bg-emerald-50/50" :
                      isFallido ? "border-red-200 bg-red-50/50" :
                      "border-border/50 bg-background"
                    }`}
                  >
                    {h.canal === "whatsapp" ? (
                      <MessageCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Mail className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium capitalize">{h.canal}</span>
                        <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full border ${
                          isEnviado ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                          isFallido ? "bg-red-100 text-red-700 border-red-200" :
                          "bg-yellow-50 text-yellow-700 border-yellow-200"
                        }`}>
                          {isEnviado ? "Enviado" : isFallido ? "Fallido" : "Pendiente"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-muted-foreground">{formatDateOnly(h.fecha)}</span>
                        {h.detalle && <span className="text-[10px] text-muted-foreground truncate">· {h.detalle}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Abonos / pagos parciales */}
      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              Pagos parciales (abonos)
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs"
              onClick={() => setShowAbonoForm((v) => !v)}
            >
              {showAbonoForm ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showAbonoForm ? "Ocultar" : "Registrar abono"}
            </Button>
          </div>

          {/* Resumen */}
          {cobro && (
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="rounded-md bg-background border border-border/50 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Total cobro</p>
                <p className="text-sm font-semibold font-mono">{formatCurrency(cobro.monto)}</p>
              </div>
              <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-center">
                <p className="text-[10px] text-emerald-700 uppercase tracking-wide mb-0.5">Pagado</p>
                <p className="text-sm font-semibold font-mono text-emerald-700">{formatCurrency(totalAbonado)}</p>
              </div>
              <div className={`rounded-md border px-3 py-2 text-center ${saldoPendiente > 0 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                <p className={`text-[10px] uppercase tracking-wide mb-0.5 ${saldoPendiente > 0 ? "text-amber-700" : "text-emerald-700"}`}>Saldo</p>
                <p className={`text-sm font-semibold font-mono ${saldoPendiente > 0 ? "text-amber-700" : "text-emerald-700"}`}>{formatCurrency(Math.max(0, saldoPendiente))}</p>
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-5 space-y-4">
          {/* Formulario nuevo abono */}
          {showAbonoForm && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Nuevo abono</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Monto (CLP)</Label>
                  <Input
                    type="number"
                    placeholder="Ej: 50000"
                    value={abonoMonto}
                    onChange={(e) => setAbonoMonto(e.target.value)}
                    className="h-8 text-sm"
                    min="1"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Método</Label>
                  <Select value={abonoMetodo} onValueChange={(v) => setAbonoMetodo(v as "flow" | "mp" | "manual")}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual" className="text-xs">Manual / Transferencia</SelectItem>
                      <SelectItem value="flow" className="text-xs">Link Flow</SelectItem>
                      <SelectItem value="mp" className="text-xs">Link MercadoPago</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {abonoMetodo === "flow" && (
                <div className="space-y-1">
                  <Label className="text-xs">Email pagador (para Flow)</Label>
                  <Input
                    type="email"
                    placeholder={cobro?.emailPagador ?? "email@ejemplo.com"}
                    value={abonoEmail}
                    onChange={(e) => setAbonoEmail(e.target.value)}
                    className="h-8 text-sm"
                  />
                  {!cobro?.emailPagador && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Flow requiere un email del pagador.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Notas (opcional)</Label>
                <Input
                  placeholder="Ej: Abono en efectivo"
                  value={abonoNotas}
                  onChange={(e) => setAbonoNotas(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={handleCrearAbono}
                  disabled={crearAbono.isPending}
                >
                  {crearAbono.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Registrando...</>
                  ) : (
                    <><Plus className="h-3.5 w-3.5 mr-1.5" />{abonoMetodo === "manual" ? "Confirmar abono" : "Generar link de pago"}</>
                  )}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowAbonoForm(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Historial de abonos */}
          {isLoadingAbonos ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-14 bg-muted/40 rounded animate-pulse" />)}
            </div>
          ) : !abonos || abonos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin abonos registrados aún.</p>
          ) : (
            <div className="space-y-2">
              {abonos.map((abono) => {
                const isConfirmado = abono.estado === "confirmado";
                const isFallido = abono.estado === "fallido";
                return (
                  <div
                    key={abono.id}
                    className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${
                      isConfirmado ? "border-emerald-200 bg-emerald-50/50" :
                      isFallido ? "border-red-200 bg-red-50/50" :
                      "border-border/50 bg-background"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold font-mono">{formatCurrency(abono.monto)}</span>
                        <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full border ${
                          abono.metodo === "flow" ? "bg-blue-100 text-blue-700 border-blue-200" :
                          abono.metodo === "mp" ? "bg-[#009ee3]/10 text-[#009ee3] border-[#009ee3]/30" :
                          "bg-amber-50 text-amber-700 border-amber-200"
                        }`}>
                          {abono.metodo === "manual" ? "Manual" : abono.metodo === "flow" ? "Flow" : "MP"}
                        </span>
                        <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full border ${
                          isConfirmado ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                          isFallido ? "bg-red-100 text-red-700 border-red-200" :
                          "bg-yellow-50 text-yellow-700 border-yellow-200"
                        }`}>
                          {isConfirmado ? "Confirmado" : isFallido ? "Fallido" : "Pendiente"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-muted-foreground">{formatDate(abono.creadoEn)}</span>
                        {abono.notas && <span className="text-[10px] text-muted-foreground truncate">· {abono.notas}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {abono.linkPago && (
                        <a
                          href={abono.linkPago}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Link
                        </a>
                      )}
                      {abono.estado === "pendiente" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => handleConfirmarAbono(abono.id)}
                          disabled={confirmarAbono.isPending}
                        >
                          {confirmarAbono.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                          Confirmar
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
