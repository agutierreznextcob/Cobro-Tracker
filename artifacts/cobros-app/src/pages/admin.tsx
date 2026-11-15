import { useEffect, useState } from "react";
import { CotizacionesSoporte } from "@/components/cotizaciones-soporte";
import { Link } from "wouter";
import {
  useListAdminUsuarios,
  useGetAdminMetricas,
  useSendAdminRecordatorioEmail,
  useExtenderTrial,
  useActivarCuenta,
  useDesactivarCuenta,
  useMarcarDemo,
  useReclamarCobrosHuerfanos,
  useActualizarPacksUsuarios,
  useActualizarOrgRole,
  useListAdminCobrosEliminados,
  useListAdminTrialExtensiones,
  getListAdminTrialExtensionesQueryKey,
  getListAdminUsuariosQueryKey,
  getGetAdminMetricasQueryKey,
  getListAdminCobrosEliminadosQueryKey,
  type AdminUsuario,
} from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Mail,
  MessageCircle,
  Loader2,
  AlertTriangle,
  Users,
  MoreHorizontal,
  CalendarPlus,
  CheckCircle2,
  Ban,
  Star,
  DollarSign,
  Wallet,
  Trash2,
  Headset,
  Copy,
  Webhook,
} from "lucide-react";

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCLP(n: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);
}

function EstadoBadge({ u }: { u: AdminUsuario }) {
  if (u.isAdmin) {
    return (
      <Badge variant="default" className="gap-1">
        <Shield className="h-3 w-3" />
        Administrador
      </Badge>
    );
  }
  if (!u.activo) {
    return <Badge variant="outline">Desactivada</Badge>;
  }
  if (u.esDemo) {
    return <Badge variant="secondary">Demo</Badge>;
  }
  if (u.subscriptionStatus === "activa") {
    return <Badge variant="default">Activa</Badge>;
  }
  if (u.subscriptionStatus === "prueba") {
    return <Badge variant="secondary">Prueba</Badge>;
  }
  if (u.subscriptionStatus === "cancelada") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-500">
        Cancelada
      </Badge>
    );
  }
  return <Badge variant="destructive">Vencida</Badge>;
}

function VencimientoCell({ u }: { u: AdminUsuario }) {
  if (u.isAdmin || u.esDemo) {
    return <span className="text-muted-foreground">Sin vencimiento</span>;
  }
  const fecha = formatFecha(u.vencimiento);
  if (u.diasParaVencer === null) {
    return <span>{fecha}</span>;
  }
  if (u.diasParaVencer < 0) {
    return (
      <span className="text-destructive font-medium">
        {fecha} · venció hace {Math.abs(u.diasParaVencer)}d
      </span>
    );
  }
  if (u.diasParaVencer <= 3) {
    return (
      <span className="text-amber-600 dark:text-amber-500 font-medium">
        {fecha} · {u.diasParaVencer}d restantes
      </span>
    );
  }
  return <span>{fecha} · {u.diasParaVencer}d</span>;
}

function buildWhatsappRenovacionUrl(u: AdminUsuario): string {
  const nombre = u.nombre || "";
  const saludo = nombre ? `Hola ${nombre}` : "Hola";
  const vencido = u.subscriptionStatus === "vencida" || !u.hasAccess;
  const fecha = formatFecha(u.vencimiento);
  const msg = vencido
    ? `${saludo}, te escribimos de NextCob. Tu acceso venció el ${fecha}. Renueva tu suscripción para seguir usando la plataforma. ¡Gracias!`
    : `${saludo}, te escribimos de NextCob. Tu acceso vence el ${fecha}. Renueva tu suscripción para no perder el acceso. ¡Gracias!`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function MetricCard({
  icon,
  value,
  label,
  tone = "primary",
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  tone?: "primary" | "amber" | "green" | "red";
}) {
  const toneClass =
    tone === "amber"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-500"
      : tone === "green"
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500"
        : tone === "red"
          ? "bg-destructive/10 text-destructive"
          : "bg-primary/10 text-primary";
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${toneClass}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CuentaActions({ u }: { u: AdminUsuario }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sendEmail = useSendAdminRecordatorioEmail();
  const extender = useExtenderTrial();
  const activar = useActivarCuenta();
  const desactivar = useDesactivarCuenta();
  const marcarDemo = useMarcarDemo();
  const reclamarCobros = useReclamarCobrosHuerfanos();
  const actualizarPacks = useActualizarPacksUsuarios();
  const actualizarOrgRole = useActualizarOrgRole();
  const [sendingEmail, setSendingEmail] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [packsInput, setPacksInput] = useState("");
  const [orgRoleOpen, setOrgRoleOpen] = useState(false);
  const [orgRoleInput, setOrgRoleInput] = useState<"admin_org" | "supervisor" | "ejecutivo">("admin_org");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListAdminUsuariosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAdminMetricasQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListAdminTrialExtensionesQueryKey(),
    });
  };

  const handleEmail = () => {
    if (!u.email) {
      toast({
        title: "Sin email",
        description: "Este usuario no tiene un email registrado.",
        variant: "destructive",
      });
      return;
    }
    setSendingEmail(true);
    sendEmail.mutate(
      { id: u.id },
      {
        onSuccess: (res) => {
          toast({
            title: res.ok ? "Recordatorio enviado" : "No se pudo enviar",
            description:
              res.message ??
              (res.ok ? "El correo de renovación fue enviado." : "Intenta nuevamente."),
            variant: res.ok ? undefined : "destructive",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "No se pudo enviar el recordatorio por email.",
            variant: "destructive",
          });
        },
        onSettled: () => setSendingEmail(false),
      },
    );
  };

  const [extenderOpen, setExtenderOpen] = useState(false);
  const [fecha, setFecha] = useState<Date | undefined>(undefined);
  const [motivo, setMotivo] = useState("");

  const abrirExtender = () => {
    setFecha(undefined);
    setMotivo("");
    setExtenderOpen(true);
  };

  const handleExtender = () => {
    if (!fecha) return;
    // YYYY-MM-DD en hora local (no UTC) para que la fecha elegida en el
    // calendario sea exactamente la que recibe el backend.
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, "0");
    const d = String(fecha.getDate()).padStart(2, "0");
    extender.mutate(
      {
        id: u.id,
        data: {
          nuevaFecha: `${y}-${m}-${d}`,
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        },
      },
      {
        onSuccess: (res) => {
          toast({
            title: res.ok ? "Prueba extendida" : "No se pudo extender",
            description: res.mensaje ?? undefined,
            variant: res.ok ? undefined : "destructive",
          });
          if (res.ok) setExtenderOpen(false);
          refresh();
        },
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudo extender la prueba.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleActivar = () => {
    activar.mutate(
      { id: u.id },
      {
        onSuccess: (res) => {
          toast({
            title: res.ok ? "Cuenta activada" : "No se pudo activar",
            description: res.mensaje ?? undefined,
            variant: res.ok ? undefined : "destructive",
          });
          refresh();
        },
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudo activar la cuenta.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleDesactivar = () => {
    desactivar.mutate(
      { id: u.id },
      {
        onSuccess: (res) => {
          toast({
            title: res.ok ? "Cuenta desactivada" : "No se pudo desactivar",
            description: res.mensaje ?? undefined,
            variant: res.ok ? undefined : "destructive",
          });
          refresh();
        },
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudo desactivar la cuenta.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleDemo = (esDemo: boolean) => {
    marcarDemo.mutate(
      { id: u.id, data: { esDemo } },
      {
        onSuccess: (res) => {
          toast({
            title: res.ok
              ? esDemo
                ? "Marcada como demo"
                : "Demo desmarcada"
              : "No se pudo actualizar",
            description: res.mensaje ?? undefined,
            variant: res.ok ? undefined : "destructive",
          });
          refresh();
        },
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudo actualizar la cuenta demo.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleReclamarCobros = () => {
    reclamarCobros.mutate(
      { id: u.id },
      {
        onSuccess: (res) => {
          toast({
            title: res.ok ? "Cobros reasignados" : "No se pudo reasignar",
            description: res.mensaje ?? undefined,
            variant: res.ok ? undefined : "destructive",
          });
          refresh();
        },
        onError: () =>
          toast({
            title: "Error",
            description: "No se pudieron reasignar los cobros.",
            variant: "destructive",
          }),
      },
    );
  };

  const handlePacks = () => {
    const n = Number(packsInput);
    if (!Number.isInteger(n) || n < 0 || n > 50) return;
    actualizarPacks.mutate(
      { userId: u.id, usuariosExtra: n },
      {
        onSuccess: (res) => {
          toast({ title: res.ok ? "Packs actualizados" : "Error", description: res.mensaje });
          if (res.ok) { setPacksOpen(false); refresh(); }
        },
        onError: () => toast({ title: "Error", description: "No se pudieron actualizar los packs.", variant: "destructive" }),
      },
    );
  };

  const handleOrgRole = () => {
    actualizarOrgRole.mutate(
      { userId: u.id, orgRole: orgRoleInput },
      {
        onSuccess: (res) => {
          toast({ title: res.ok ? "Rol actualizado" : "Error", description: res.mensaje });
          if (res.ok) { setOrgRoleOpen(false); refresh(); }
        },
        onError: () => toast({ title: "Error", description: "No se pudo actualizar el rol.", variant: "destructive" }),
      },
    );
  };

  const busy =
    extender.isPending ||
    activar.isPending ||
    desactivar.isPending ||
    marcarDemo.isPending ||
    reclamarCobros.isPending ||
    actualizarPacks.isPending ||
    actualizarOrgRole.isPending;

  if (u.isAdmin) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={handleEmail}
        disabled={sendingEmail}
      >
        {sendingEmail ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Mail className="h-3.5 w-3.5" />
        )}
        Email
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() =>
          window.open(
            buildWhatsappRenovacionUrl(u),
            "_blank",
            "noopener,noreferrer",
          )
        }
      >
        <MessageCircle className="h-3.5 w-3.5" />
        WhatsApp
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreHorizontal className="h-3.5 w-3.5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={abrirExtender}>
            <CalendarPlus className="h-4 w-4 mr-2" />
            Extender trial
          </DropdownMenuItem>
          {u.esDemo ? (
            <DropdownMenuItem onClick={() => handleDemo(false)}>
              <Star className="h-4 w-4 mr-2" />
              Quitar cuenta demo
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => handleDemo(true)}>
              <Star className="h-4 w-4 mr-2" />
              Marcar como demo
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => { setOrgRoleInput((u as any).orgRole ?? "admin_org"); setOrgRoleOpen(true); }}>
            Rol en org
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setPacksInput(String(u.usuariosExtra ?? 0)); setPacksOpen(true); }}>
            <Users className="h-4 w-4 mr-2" />
            Usuarios extra ({u.usuariosExtra ?? 0})
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleReclamarCobros}>
            <Users className="h-4 w-4 mr-2" />
            Reasignar cobros sin dueño
          </DropdownMenuItem>
          {u.activo ? (
            <DropdownMenuItem onClick={handleDesactivar} className="text-destructive">
              <Ban className="h-4 w-4 mr-2" />
              Desactivar cuenta
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={handleActivar}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Activar cuenta
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={extenderOpen} onOpenChange={setExtenderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extender período de prueba</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 pt-1">
                <p>
                  Usuario:{" "}
                  <span className="font-medium text-foreground">
                    {u.nombre || u.email || u.id}
                  </span>{" "}
                  {u.accountId ? `(${u.accountId})` : ""}
                </p>
                <p>
                  Trial actual vence:{" "}
                  <span className="font-medium text-foreground">
                    {formatFecha(u.trialEndsAt)}
                  </span>
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <Calendar
              mode="single"
              selected={fecha}
              onSelect={setFecha}
              disabled={{ before: new Date(Date.now() + 24 * 60 * 60 * 1000) }}
              className="rounded-md border"
            />
            <p className="text-sm w-full">
              Nueva fecha de vencimiento:{" "}
              <span className="font-semibold">
                {fecha
                  ? fecha.toLocaleDateString("es-CL", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "—"}
              </span>
            </p>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (opcional, queda en el registro de auditoría)"
              rows={2}
              maxLength={500}
              className="w-full"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtenderOpen(false)}
              disabled={extender.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleExtender}
              disabled={!fecha || extender.isPending}
              data-testid="confirmar-extension"
            >
              {extender.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CalendarPlus className="h-4 w-4 mr-2" />
              )}
              Confirmar extensión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orgRoleOpen} onOpenChange={setOrgRoleOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rol en organización</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 pt-1">
                <p className="text-sm text-muted-foreground">{u.nombre} · {u.email}</p>
                <p className="text-sm text-muted-foreground">Cambia el rol del usuario dentro de su organización.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <label className="text-sm font-medium">Rol</label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              value={orgRoleInput}
              onChange={(e) => setOrgRoleInput(e.target.value as "admin_org" | "supervisor" | "ejecutivo")}
            >
              <option value="admin_org">admin_org (Administrador)</option>
              <option value="supervisor">supervisor</option>
              <option value="ejecutivo">ejecutivo</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgRoleOpen(false)}>Cancelar</Button>
            <Button onClick={handleOrgRole} disabled={actualizarOrgRole.isPending}>
              {actualizarOrgRole.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={packsOpen} onOpenChange={setPacksOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Usuarios extra</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 pt-1">
                <p className="text-sm text-muted-foreground">{u.nombre} · {u.email}</p>
                <p className="text-sm text-muted-foreground">Actualmente: <strong>{u.usuariosExtra ?? 0}</strong> usuario(s) extra.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <label className="text-sm font-medium">Total de usuarios extra a asignar</label>
            <Input
              type="number"
              min={0}
              max={50}
              value={packsInput}
              onChange={(e) => setPacksInput(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">Ej: 10 → la cuenta tendrá el cupo base + 10 usuarios extra.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPacksOpen(false)}>Cancelar</Button>
            <Button onClick={handlePacks} disabled={actualizarPacks.isPending || packsInput === ""}>
              {actualizarPacks.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminPage() {
  const [busqueda, setBusqueda] = useState("");
  // Debounce so we don't hit the server on every keystroke; the search itself
  // runs server-side (accountId/email/RUT/nombre) so the panel stays fast with
  // many accounts.
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const q = busquedaDebounced;
  const { data: usuarios, isLoading } = useListAdminUsuarios(
    q ? { q } : undefined,
    {
      query: {
        queryKey: getListAdminUsuariosQueryKey(q ? { q } : undefined),
        placeholderData: (prev) => prev,
      },
    },
  );
  const { data: metricas } = useGetAdminMetricas();
  const { data: cobrosEliminados, isLoading: isLoadingEliminados } = useListAdminCobrosEliminados({
    query: { queryKey: getListAdminCobrosEliminadosQueryKey() },
  });

  const usuariosFiltrados = usuarios ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Administración</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Cuentas de la plataforma, suscripciones y métricas de negocio.
          </p>
        </div>
        <div className="w-full sm:w-80">
          <Input
            placeholder="Buscar por ID (NCB-…), nombre, email o RUT"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      <CotizacionesSoporte />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<Users className="h-5 w-5" />}
          value={metricas?.totalCuentas ?? "—"}
          label="Cuentas totales"
        />
        <MetricCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          value={metricas?.activas ?? "—"}
          label="Suscripciones activas"
          tone="green"
        />
        <MetricCard
          icon={<CalendarPlus className="h-5 w-5" />}
          value={metricas?.enPrueba ?? "—"}
          label="En prueba"
          tone="amber"
        />
        <MetricCard
          icon={<AlertTriangle className="h-5 w-5" />}
          value={metricas?.vencidas ?? "—"}
          label="Vencidas"
          tone="red"
        />
        <MetricCard
          icon={<DollarSign className="h-5 w-5" />}
          value={metricas ? formatCLP(metricas.revenueMensual) : "—"}
          label="Ingresos mensuales (MRR)"
          tone="green"
        />
        <MetricCard
          icon={<Wallet className="h-5 w-5" />}
          value={metricas ? formatCLP(metricas.totalRecaudado) : "—"}
          label="Total recaudado (clientes)"
        />
        <MetricCard
          icon={<Users className="h-5 w-5" />}
          value={metricas?.demo ?? "—"}
          label="Cuentas demo"
        />
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <Webhook className="h-4 w-4 text-primary" />
              Herramientas técnicas
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Diagnóstico interno de integraciones y eventos de pago.
            </p>
          </div>
          <Link href="/webhooks/log">
            <Button variant="outline" className="w-full sm:w-auto">
              Ver log de webhooks
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando cuentas...
            </div>
          ) : usuariosFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Users className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">
                {q
                  ? "No hay cuentas que coincidan con la búsqueda."
                  : "No hay cuentas registradas."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>RUT</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead>Último pago</TableHead>
                    <TableHead>Próximo cobro</TableHead>
                    <TableHead className="text-right">Usuarios</TableHead>
                    <TableHead className="text-right">Plan mensual</TableHead>
                    <TableHead className="text-right">Recaudado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usuariosFiltrados.map((u) => (
                    <TableRow
                      key={u.id}
                      className={
                        !u.activo
                          ? "opacity-60"
                          : u.requiereRecordatorio
                            ? "bg-amber-500/5"
                            : undefined
                      }
                    >
                      <TableCell className="font-mono text-xs whitespace-nowrap font-semibold text-primary">
                        {u.accountId || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {u.nombre || (
                            <span className="text-muted-foreground">Sin nombre</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {u.email || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {u.rut || "—"}
                      </TableCell>
                      <TableCell>
                        <EstadoBadge u={u} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {u.isAdmin ? (
                          "—"
                        ) : (
                          <>
                            {u.planNombre ?? "NextCob"}
                            {u.plan == null && !u.esDemo && (
                              <span className="text-xs text-muted-foreground"> (sin elegir)</span>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <VencimientoCell u={u} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {u.ultimoPagoEn ? (
                          <>
                            {formatFecha(u.ultimoPagoEn)}
                            {u.ultimoPagoMonto != null && (
                              <span className="text-xs text-muted-foreground">
                                {" "}· {formatCLP(u.ultimoPagoMonto)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {u.proximoCobroEn ? (
                          formatFecha(u.proximoCobroEn)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {u.isAdmin ? "—" : 1 + u.usuariosExtra}
                        {u.usuariosExtra > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            (+{u.usuariosExtra})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {u.isAdmin || u.esDemo ? "—" : formatCLP(u.montoMensual)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {u.isAdmin ? "—" : formatCLP(u.totalRecaudado)}
                      </TableCell>
                      <TableCell className="text-right">
                        <CuentaActions u={u} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Trash2 className="h-5 w-5 text-destructive" />
          <h2 className="text-xl font-bold tracking-tight">Cobros eliminados</h2>
        </div>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            {isLoadingEliminados ? (
              <div className="flex items-center justify-center py-24 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando cobros eliminados...
              </div>
            ) : (cobrosEliminados ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Trash2 className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-muted-foreground text-sm">
                  No hay cobros eliminados registrados.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID original</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Eliminado por</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(cobrosEliminados ?? []).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs whitespace-nowrap font-semibold text-primary">
                          #{c.cobroIdOriginal}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="text-sm">{c.descripcion || "—"}</span>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap font-mono">
                          {formatCurrency(c.montoACobrar ?? c.monto)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={c.estado} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.clienteNombre || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.eliminadoPorNombre || "—"}
                        </TableCell>
                        <TableCell className="max-w-[220px] text-muted-foreground text-sm">
                          {c.motivo || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(c.eliminadoEn)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TrialExtensionesSection />

      <ConsultoresSection />
    </div>
  );
}

// Registro de auditoría de extensiones de trial hechas por el superadmin.
function TrialExtensionesSection() {
  const { data: extensiones, isLoading } = useListAdminTrialExtensiones({
    query: { queryKey: getListAdminTrialExtensionesQueryKey() },
  });
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CalendarPlus className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold tracking-tight">Extensiones de trial</h2>
      </div>
      <Card className="shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando extensiones...
            </div>
          ) : (extensiones ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarPlus className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">
                Aún no se han registrado extensiones de trial.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Vencía</TableHead>
                    <TableHead>Nuevo vencimiento</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Extendido por</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(extensiones ?? []).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(e.creadoEn)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{e.usuarioNombre || e.usuarioEmail || e.usuarioId}</div>
                        {e.usuarioAccountId && (
                          <div className="font-mono text-xs text-muted-foreground">
                            {e.usuarioAccountId}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {e.fechaAnterior ? formatDate(e.fechaAnterior) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm font-medium">
                        {formatDate(e.fechaNueva)}
                      </TableCell>
                      <TableCell className="max-w-[240px] text-sm text-muted-foreground">
                        {e.motivo || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {e.adminNombre || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Consultores de soporte (acceso vía /consultor, Ley 21.719) -------------

type Consultor = { id: number; nombre: string; tipo: string; activo: boolean; creadoEn: string };
type SesionConsultor = {
  id: number;
  consultorNombre: string;
  userId: string;
  accountId: string | null;
  clienteNombre: string | null;
  inicioEn: string;
  finEn: string | null;
  acciones: number;
};
type AccionConsultor = { id: number; metodo: string; ruta: string; detalle: string | null; fecha: string };

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string })?.message || "Error de servidor");
  return data as T;
}

function duracion(inicioEn: string, finEn: string | null): string {
  if (!finEn) return "en curso";
  const ms = new Date(finEn).getTime() - new Date(inicioEn).getTime();
  if (ms < 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

function ConsultoresSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");
  const [nuevaPassword, setNuevaPassword] = useState<{ nombre: string; password: string } | null>(null);
  const [sesionDetalle, setSesionDetalle] = useState<number | null>(null);

  const { data: consultores, isLoading: loadingConsultores } = useQuery({
    queryKey: ["admin-consultores"],
    queryFn: () => apiJson<{ consultores: Consultor[] }>("/api/consultor/consultores"),
  });
  const { data: sesiones, isLoading: loadingSesiones } = useQuery({
    queryKey: ["admin-consultor-sesiones"],
    queryFn: () => apiJson<{ sesiones: SesionConsultor[] }>("/api/consultor/sesiones"),
  });
  const { data: acciones } = useQuery({
    queryKey: ["admin-consultor-acciones", sesionDetalle],
    enabled: sesionDetalle != null,
    queryFn: () =>
      apiJson<{ acciones: AccionConsultor[] }>(`/api/consultor/sesiones/${sesionDetalle}/acciones`),
  });

  const crear = useMutation({
    mutationFn: () =>
      apiJson<{ id: number; nombre: string; password: string }>("/api/consultor/consultores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      }),
    onSuccess: (data) => {
      setNuevaPassword({ nombre: data.nombre, password: data.password });
      setNombre("");
      queryClient.invalidateQueries({ queryKey: ["admin-consultores"] });
    },
    onError: (err: unknown) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "No se pudo crear el consultor.",
        variant: "destructive",
      }),
  });

  const toggleActivo = useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) =>
      apiJson(`/api/consultor/consultores/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-consultores"] }),
    onError: () =>
      toast({ title: "Error", description: "No se pudo actualizar el consultor.", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Headset className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold tracking-tight">Consultores de soporte</h2>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Acceden por <span className="font-mono">/consultor</span> con el ID de cuenta del cliente. Cada
        sesión y acción queda auditada (Ley 21.719) y el cliente la ve en su perfil.
      </p>

      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Nombre del consultor (ej: Juan Soto — Soporte)"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="sm:max-w-sm"
            />
            <Button
              onClick={() => crear.mutate()}
              disabled={crear.isPending || !nombre.trim()}
            >
              {crear.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creando...</>
              ) : (
                "Crear consultor"
              )}
            </Button>
          </div>

          {nuevaPassword ? (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Contraseña de {nuevaPassword.nombre} — se muestra UNA sola vez, cópiala ahora:
              </p>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm bg-background border rounded px-2 py-1 select-all">
                  {nuevaPassword.password}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(nuevaPassword.password);
                    toast({ title: "Copiada", description: "Contraseña copiada al portapapeles." });
                  }}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNuevaPassword(null)}>
                  Listo
                </Button>
              </div>
            </div>
          ) : null}

          {loadingConsultores ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando consultores...
            </div>
          ) : (consultores?.consultores ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Aún no hay consultores. Crea el primero para habilitar el acceso de soporte.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Creado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(consultores?.consultores ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.nombre}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.tipo === "soporte" ? "Consultor de soporte" : "Administrador"}
                      </TableCell>
                      <TableCell>
                        {c.activo ? (
                          <Badge variant="default">Activo</Badge>
                        ) : (
                          <Badge variant="outline">Desactivado</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatFecha(c.creadoEn)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggleActivo.isPending}
                          onClick={() => toggleActivo.mutate({ id: c.id, activo: !c.activo })}
                        >
                          {c.activo ? "Desactivar" : "Reactivar"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <h3 className="text-base font-semibold tracking-tight pt-2">Registro de accesos</h3>
      <Card className="shadow-sm">
        <CardContent className="p-0">
          {loadingSesiones ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando accesos...
            </div>
          ) : (sesiones?.sesiones ?? []).length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No hay sesiones de consultor registradas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Consultor</TableHead>
                    <TableHead>Cuenta visitada</TableHead>
                    <TableHead>Ingreso</TableHead>
                    <TableHead>Salida</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sesiones?.sesiones ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium whitespace-nowrap">{s.consultorNombre}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm">{s.clienteNombre || "—"}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">{s.accountId || ""}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatFechaHora(s.inicioEn)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {s.finEn ? formatFechaHora(s.finEn) : <Badge variant="secondary">Abierta</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {duracion(s.inicioEn, s.finEn)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSesionDetalle(sesionDetalle === s.id ? null : s.id)}
                        >
                          {s.acciones} {s.acciones === 1 ? "acción" : "acciones"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {sesionDetalle != null ? (
                <div className="border-t px-4 py-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Acciones de la sesión #{sesionDetalle}
                  </p>
                  {(acciones?.acciones ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin acciones registradas.</p>
                  ) : (
                    <ul className="space-y-1">
                      {(acciones?.acciones ?? []).map((a) => (
                        <li key={a.id} className="text-sm flex flex-wrap gap-2 items-baseline">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatFechaHora(a.fecha)}
                          </span>
                          <span>{a.detalle || `${a.metodo} ${a.ruta}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
