import { useState } from "react";
import {
  useListAdminUsuarios,
  useGetAdminMetricas,
  useSendAdminRecordatorioEmail,
  useExtenderTrial,
  useActivarCuenta,
  useDesactivarCuenta,
  getListAdminUsuariosQueryKey,
  getGetAdminMetricasQueryKey,
  type AdminUsuario,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DollarSign,
  Wallet,
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
  const [sendingEmail, setSendingEmail] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListAdminUsuariosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAdminMetricasQueryKey() });
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

  const handleExtender = () => {
    extender.mutate(
      { id: u.id, data: { dias: 14 } },
      {
        onSuccess: (res) => {
          toast({
            title: res.ok ? "Prueba extendida" : "No se pudo extender",
            description: res.mensaje ?? undefined,
            variant: res.ok ? undefined : "destructive",
          });
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

  const busy =
    extender.isPending || activar.isPending || desactivar.isPending;

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
          <DropdownMenuItem onClick={handleExtender}>
            <CalendarPlus className="h-4 w-4 mr-2" />
            Extender prueba 14 días
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
    </div>
  );
}

export default function AdminPage() {
  const { data: usuarios, isLoading } = useListAdminUsuarios();
  const { data: metricas } = useGetAdminMetricas();

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
      </div>

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
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando cuentas...
            </div>
          ) : !usuarios || usuarios.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Users className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No hay cuentas registradas.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>RUT</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Usuarios</TableHead>
                    <TableHead className="text-right">Plan mensual</TableHead>
                    <TableHead className="text-right">Recaudado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usuarios.map((u) => (
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
                        <VencimientoCell u={u} />
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
    </div>
  );
}
