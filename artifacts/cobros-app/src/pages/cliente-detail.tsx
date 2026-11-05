import { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetCliente, useUpdateCliente, useEnviarPortalCliente, useRegenerarPortalCliente, getGetClienteQueryKey } from "@workspace/api-client-react";
import type { EnviarPortalInputCanal } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { ScoreBadge, SCORE_META } from "@/components/score-badge";
import { formatCurrency, formatShortDate, formatMoney, formatTotalesPorMoneda } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Edit2, Loader2, Mail, Phone, FileText, Clock, CheckCircle2, Send, Link2, Copy, Check, Gauge, TrendingUp, Minus, TrendingDown, RefreshCw, ShieldAlert, Zap, CalendarClock, Percent, PhoneCall, MapPin } from "lucide-react";

function formatFechaCorta(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}

function haceDias(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}

const editSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio").max(200),
  empresa: z.string().max(200).optional(),
  rut: z.string().max(20).optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  telefono: z.string().max(30).optional(),
  direccion: z.string().max(300).optional(),
});
type EditForm = z.infer<typeof editSchema>;

function EditClienteDialog({ cliente, onUpdated }: { cliente: { id: number; nombre: string; empresa?: string | null; rut?: string | null; email?: string | null; telefono?: string | null; direccion?: string | null }; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const updateCliente = useUpdateCliente();

  const form = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    values: {
      nombre: cliente.nombre,
      empresa: cliente.empresa ?? "",
      rut: cliente.rut ?? "",
      email: cliente.email ?? "",
      telefono: cliente.telefono ?? "",
      direccion: cliente.direccion ?? "",
    },
  });

  const onSubmit = (values: EditForm) => {
    updateCliente.mutate(
      { id: cliente.id, data: { nombre: values.nombre, empresa: values.empresa || undefined, rut: values.rut || undefined, email: values.email || undefined, telefono: values.telefono || undefined, direccion: values.direccion?.trim() ?? "" } },
      {
        onSuccess: () => {
          toast({ title: "Cliente actualizado" });
          setOpen(false);
          onUpdated();
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Edit2 className="h-3.5 w-3.5" /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <FormField control={form.control} name="nombre" render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre *</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="empresa" render={({ field }) => (
              <FormItem>
                <FormLabel>Empresa</FormLabel>
                <FormControl><Input placeholder="Empresa (opcional)" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="rut" render={({ field }) => (
              <FormItem>
                <FormLabel>RUT</FormLabel>
                <FormControl><Input placeholder="12.345.678-9" className="font-mono" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="telefono" render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="direccion" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Dirección</FormLabel>
                  <FormControl><Input placeholder="Calle, número, comuna" data-testid="input-edit-direccion" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={updateCliente.isPending}>
                {updateCliente.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</> : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const CANAL_LABEL: Record<string, string> = {
  email: "email",
  whatsapp: "WhatsApp",
  ambos: "email y WhatsApp",
};

function EnviarPortalDialog({
  cliente,
  onChanged,
}: {
  cliente: {
    id: number;
    nombre: string;
    email?: string | null;
    telefono?: string | null;
    portalEnviadoEn?: string | null;
    portalEnviadoCanal?: string | null;
    portalTokenGeneradoEn?: string | null;
  };
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [canal, setCanal] = useState<EnviarPortalInputCanal>("email");
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerado, setRegenerado] = useState(false);
  // Local overrides so the dialog reflects the latest send/regeneration
  // immediately, before the cliente query refetches.
  const [ultimoEnvio, setUltimoEnvio] = useState<{ en: string; canal: string | null } | null>(null);
  const [tokenGeneradoLocal, setTokenGeneradoLocal] = useState<string | null>(null);
  const { toast } = useToast();
  const enviarPortal = useEnviarPortalCliente();
  const regenerarPortal = useRegenerarPortalCliente();

  const envioEn = ultimoEnvio?.en ?? cliente.portalEnviadoEn ?? null;
  const envioCanal = ultimoEnvio ? ultimoEnvio.canal : cliente.portalEnviadoCanal ?? null;
  const tokenGeneradoEn = tokenGeneradoLocal ?? cliente.portalTokenGeneradoEn ?? null;
  // The debtor has a stale link when the token was rotated after the last send.
  const linkDesactualizado =
    !!envioEn && !!tokenGeneradoEn && new Date(tokenGeneradoEn) > new Date(envioEn);

  const onRegenerar = () => {
    regenerarPortal.mutate(
      { id: cliente.id },
      {
        onSuccess: (res) => {
          setUrl(res.url);
          setCopied(false);
          setRegenerado(true);
          setTokenGeneradoLocal(new Date().toISOString());
          onChanged();
          toast({
            title: "Link regenerado",
            description:
              "El enlace anterior quedó invalidado. Reenvía el nuevo enlace al cliente.",
          });
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo regenerar el link.", variant: "destructive" });
        },
      },
    );
  };

  const tieneEmail = !!cliente.email;
  const tieneTelefono = !!cliente.telefono;

  const onSubmit = () => {
    enviarPortal.mutate(
      { id: cliente.id, data: { canal } },
      {
        onSuccess: (res) => {
          setUrl(res.url);
          setRegenerado(false);
          if (res.portalEnviadoEn) {
            setUltimoEnvio({ en: res.portalEnviadoEn, canal: res.portalEnviadoCanal ?? null });
          }
          onChanged();
          const partes: string[] = [];
          if (res.emailEnviado) partes.push("email");
          if (res.whatsappEnviado) partes.push("WhatsApp");
          toast({
            title: "Portal enviado",
            description:
              partes.length > 0
                ? `Enlace enviado por ${partes.join(" y ")}.`
                : res.mensaje || "Enlace generado. Cópialo y compártelo manualmente.",
          });
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo enviar el portal.", variant: "destructive" });
        },
      },
    );
  };

  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "No se pudo copiar", variant: "destructive" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setUrl(null);
          setCopied(false);
          setRegenerado(false);
          setUltimoEnvio(null);
          setTokenGeneradoLocal(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> Enviar portal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar portal de pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Genera un enlace privado para que {cliente.nombre} vea y pague sus cobros pendientes
            sin necesidad de iniciar sesión.
          </p>

          {envioEn ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>
                Último envío:{" "}
                <span className="font-medium text-foreground">
                  {new Date(envioEn).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" })}
                </span>
                {envioCanal ? <> por {CANAL_LABEL[envioCanal] ?? envioCanal}</> : null}
              </span>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              El enlace del portal aún no se ha enviado a este cliente.
            </div>
          )}

          {linkDesactualizado && !regenerado && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              El enlace se regeneró después del último envío: el cliente tiene un link antiguo que
              ya no funciona. Reenvíale el enlace vigente.
            </div>
          )}

          <div className="space-y-2">
            <Label>Enviar por</Label>
            <Select value={canal} onValueChange={(v) => setCanal(v as EnviarPortalInputCanal)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email" disabled={!tieneEmail}>
                  Email {tieneEmail ? `(${cliente.email})` : "(sin email)"}
                </SelectItem>
                <SelectItem value="whatsapp" disabled={!tieneTelefono}>
                  WhatsApp {tieneTelefono ? `(${cliente.telefono})` : "(sin teléfono)"}
                </SelectItem>
                <SelectItem value="ambos" disabled={!tieneEmail || !tieneTelefono}>
                  Email y WhatsApp
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {regenerado && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              El enlace anterior quedó invalidado: si el cliente lo abre verá un error.{" "}
              {tieneEmail || tieneTelefono
                ? "Reenvíale el nuevo enlace por el canal seleccionado."
                : "Este cliente no tiene email ni teléfono registrado: copia el nuevo enlace y compártelo manualmente."}
            </div>
          )}

          {url && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" /> Enlace del portal
              </Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={url} className="font-mono text-xs" />
                <Button type="button" size="icon" variant="outline" onClick={copyUrl}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRegenerar}
              disabled={regenerarPortal.isPending}
              className="gap-1.5 text-muted-foreground"
              title="Invalida el enlace anterior y genera uno nuevo"
            >
              {regenerarPortal.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenerar link
            </Button>
            <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button type="button" onClick={onSubmit} disabled={enviarPortal.isPending} className="gap-1.5">
              {enviarPortal.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> {regenerado ? "Reenviar nuevo enlace" : url ? "Reenviar" : "Enviar"}
                </>
              )}
            </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const clienteId = Number(id);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useGetCliente(clienteId);

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: getGetClienteQueryKey(clienteId) });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <Card className="animate-pulse">
          <CardHeader className="h-20 bg-muted/50" />
          <CardContent className="h-32 bg-muted/20" />
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-24">
        <p className="text-muted-foreground">Cliente no encontrado.</p>
        <Link href="/clientes" className="text-primary hover:underline text-sm mt-2 inline-block">
          ← Volver a clientes
        </Link>
      </div>
    );
  }

  const cobros = data.cobros ?? [];
  const pagados = cobros.filter((c) => c.estado === "pagado");
  const pendientes = cobros.filter((c) => c.estado === "pendiente");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <Link href="/clientes" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Clientes
        </Link>
        <div className="flex items-center gap-2">
          <EnviarPortalDialog cliente={data} onChanged={handleUpdated} />
          <EditClienteDialog cliente={data as typeof data & { direccion?: string | null }} onUpdated={handleUpdated} />
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl shrink-0">
              {data.nombre.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight">{data.nombre}</h1>
              {data.empresa && <p className="text-muted-foreground text-sm mt-0.5">{data.empresa}</p>}
              {data.rut && <p className="text-muted-foreground font-mono text-sm mt-0.5">{data.rut}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {data.email && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <a href={`mailto:${data.email}`} className="hover:text-foreground hover:underline">{data.email}</a>
                  </div>
                )}
                {data.telefono && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    <span>{data.telefono}</span>
                  </div>
                )}
                {(data as { direccion?: string | null }).direccion && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="text-cliente-direccion">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{(data as { direccion?: string | null }).direccion}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {data.scoreDetalle && (
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="flex items-center gap-4 shrink-0">
                <div
                  className={`h-20 w-20 rounded-2xl flex flex-col items-center justify-center ${SCORE_META[data.scoreDetalle.categoria].bg} border ${SCORE_META[data.scoreDetalle.categoria].border}`}
                >
                  {data.scoreDetalle.score != null ? (
                    <span className={`text-3xl font-bold tabular-nums ${SCORE_META[data.scoreDetalle.categoria].text}`}>
                      {data.scoreDetalle.score}
                    </span>
                  ) : (
                    <Gauge className={`h-8 w-8 ${SCORE_META[data.scoreDetalle.categoria].text}`} />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Gauge className="h-4 w-4" />
                    Comportamiento de pago
                  </div>
                  <ScoreBadge score={data.scoreDetalle.score} categoria={data.scoreDetalle.categoria} />
                  <p className="text-xs text-muted-foreground mt-2">
                    {data.scoreDetalle.totalCobros} cobro{data.scoreDetalle.totalCobros !== 1 ? "s" : ""} ·{" "}
                    {formatCurrency(data.scoreDetalle.totalPendiente)} pendiente (CLP)
                  </p>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 sm:border-l sm:pl-5">
                {data.scoreDetalle.factores.map((f, i) => {
                  const Icon = f.tipo === "positivo" ? TrendingUp : f.tipo === "negativo" ? TrendingDown : Minus;
                  const color =
                    f.tipo === "positivo"
                      ? "text-emerald-600"
                      : f.tipo === "negativo"
                        ? "text-red-600"
                        : "text-muted-foreground";
                  return (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                      <span className="text-foreground/90">{f.texto}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.scoreDetalle && data.scoreDetalle.categoria !== "sin_datos" && (
        <Card className="shadow-sm border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight">Perfil de riesgo</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Percent className="h-3.5 w-3.5" /> Probabilidad de pago (7 días)
                </div>
                {data.scoreDetalle.probabilidadPago != null ? (
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xl font-bold tabular-nums ${
                        data.scoreDetalle.probabilidadPago >= 60
                          ? "text-emerald-600"
                          : data.scoreDetalle.probabilidadPago >= 35
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}
                    >
                      {data.scoreDetalle.probabilidadPago}%
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Sin cobros pendientes</span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <CalendarClock className="h-3.5 w-3.5" /> Fecha estimada de pago
                </div>
                {data.scoreDetalle.fechaEstimadaPago ? (
                  <span className="text-sm font-semibold">~{formatFechaCorta(data.scoreDetalle.fechaEstimadaPago)}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3.5 w-3.5" /> Días promedio de mora
                </div>
                <span className="text-sm font-semibold">
                  {data.scoreDetalle.promedioDiasAtraso > 0
                    ? `${Math.round(data.scoreDetalle.promedioDiasAtraso)} día${Math.round(data.scoreDetalle.promedioDiasAtraso) !== 1 ? "s" : ""} de retraso`
                    : "Paga a tiempo"}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <TrendingDown className="h-3.5 w-3.5" /> Promesas incumplidas
                </div>
                <span className={`text-sm font-semibold ${(data.scoreDetalle.promesasIncumplidas ?? 0) > 0 ? "text-red-600" : ""}`}>
                  {(data.scoreDetalle.promesasIncumplidas ?? 0) > 0
                    ? `${data.scoreDetalle.promesasIncumplidas} en los últimos 6 meses`
                    : "Ninguna registrada"}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <PhoneCall className="h-3.5 w-3.5" /> Último contacto
                </div>
                <span className="text-sm font-semibold">
                  {data.scoreDetalle.ultimoContactoEn ? haceDias(data.scoreDetalle.ultimoContactoEn) : "Sin contacto registrado"}
                </span>
              </div>
            </div>
            {data.scoreDetalle.recomendacion && (
              <div className="mt-5 rounded-lg border border-primary/25 bg-primary/5 p-4 flex items-start gap-3">
                <Zap className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">IA recomienda: {data.scoreDetalle.recomendacion.titulo}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{data.scoreDetalle.recomendacion.detalle}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 grid-cols-3">
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <FileText className="h-4 w-4" />
              <span className="text-sm">Total cobros</span>
            </div>
            <p className="text-2xl font-bold font-mono">{cobros.length}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-green-500/20 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm">Recaudado</span>
            </div>
            <p className="text-2xl font-bold font-mono text-green-700">{formatTotalesPorMoneda(pagados, (c) => Number(c.monto))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{pagados.length} pagados</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4 text-amber-600" />
              <span className="text-sm">Pendientes</span>
            </div>
            <p className="text-2xl font-bold font-mono">{pendientes.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pendientes.length > 0 ? formatTotalesPorMoneda(pendientes, (c) => Number(c.monto)) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight mb-4">Historial de cobros</h2>
        <Card className="shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Fecha</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cobros.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    No hay cobros registrados para este cliente.
                  </TableCell>
                </TableRow>
              ) : (
                cobros.map((cobro) => (
                  <TableRow key={cobro.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground text-sm">{formatShortDate(cobro.creadoEn)}</TableCell>
                    <TableCell>
                      <Link href={`/cobros/${cobro.id}`} className="font-medium hover:underline text-foreground">
                        {cobro.descripcion}
                      </Link>
                    </TableCell>
                    <TableCell><StatusBadge status={cobro.estado} /></TableCell>
                    <TableCell className="text-right font-mono font-medium">{formatMoney(cobro.monto, cobro.moneda, cobro.decimales)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
