import { useState } from "react";
import {
  useListAdminUsuarios,
  useSendAdminRecordatorioEmail,
  type AdminUsuario,
} from "@workspace/api-client-react";
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
import { useToast } from "@/hooks/use-toast";
import { Shield, Mail, MessageCircle, Loader2, AlertTriangle, Users } from "lucide-react";

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
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
  if (u.subscriptionStatus === "activa") {
    return <Badge variant="default">Activa</Badge>;
  }
  if (u.subscriptionStatus === "prueba") {
    return <Badge variant="secondary">Prueba</Badge>;
  }
  return <Badge variant="destructive">Vencida</Badge>;
}

function VencimientoCell({ u }: { u: AdminUsuario }) {
  if (u.isAdmin) {
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
    ? `${saludo}, te escribimos de Cobro Simple. Tu acceso venció el ${fecha}. Renueva tu suscripción para seguir usando la plataforma. ¡Gracias!`
    : `${saludo}, te escribimos de Cobro Simple. Tu acceso vence el ${fecha}. Renueva tu suscripción para no perder el acceso. ¡Gracias!`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function RecordatorioActions({ u }: { u: AdminUsuario }) {
  const { toast } = useToast();
  const sendEmail = useSendAdminRecordatorioEmail();
  const [sendingId, setSendingId] = useState(false);

  const handleEmail = () => {
    if (!u.email) {
      toast({
        title: "Sin email",
        description: "Este usuario no tiene un email registrado.",
        variant: "destructive",
      });
      return;
    }
    setSendingId(true);
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
        onSettled: () => setSendingId(false),
      },
    );
  };

  const handleWhatsapp = () => {
    window.open(buildWhatsappRenovacionUrl(u), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={handleEmail}
        disabled={sendingId}
      >
        {sendingId ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Mail className="h-3.5 w-3.5" />
        )}
        Recordar por email
      </Button>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={handleWhatsapp}>
        <MessageCircle className="h-3.5 w-3.5" />
        Recordar por WhatsApp
      </Button>
    </div>
  );
}

export default function AdminPage() {
  const { data: usuarios, isLoading } = useListAdminUsuarios();

  const total = usuarios?.length ?? 0;
  const porVencer = usuarios?.filter((u) => u.requiereRecordatorio).length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Administración</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Todos los usuarios de la plataforma y el estado de su suscripción.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 max-w-lg">
        <Card className="shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{total}</p>
              <p className="text-xs text-muted-foreground mt-1">Usuarios registrados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{porVencer}</p>
              <p className="text-xs text-muted-foreground mt-1">Por vencer o vencidos</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando usuarios...
            </div>
          ) : !usuarios || usuarios.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Users className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No hay usuarios registrados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Recordatorios</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usuarios.map((u) => (
                    <TableRow
                      key={u.id}
                      className={u.requiereRecordatorio ? "bg-amber-500/5" : undefined}
                    >
                      <TableCell className="font-medium">
                        {u.nombre || <span className="text-muted-foreground">Sin nombre</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.email || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatFecha(u.createdAt)}
                      </TableCell>
                      <TableCell>
                        <EstadoBadge u={u} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <VencimientoCell u={u} />
                      </TableCell>
                      <TableCell className="text-right">
                        {u.requiereRecordatorio ? (
                          <RecordatorioActions u={u} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
