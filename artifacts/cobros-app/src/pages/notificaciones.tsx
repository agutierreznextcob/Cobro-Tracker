import {
  useListNotificaciones,
  getListNotificacionesQueryKey,
  useMarcarNotificacionLeida,
  useMarcarTodasNotificacionesLeidas,
  type Notificacion,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock,
  Mail, Settings, FileText, Users, AlertOctagon,
  MessageCircle, Bell, ExternalLink, Check, Loader2, CheckCheck, RefreshCcw
} from "lucide-react";

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "hace un momento";
  if (diffMins < 60) return `hace ${diffMins} min`;
  if (diffHours < 24) return `hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `hace ${diffDays} días`;

  // sensible fallback for older dates
  return new Intl.DateTimeFormat("es-CL", {
    month: "short",
    day: "numeric",
    year: now.getFullYear() === date.getFullYear() ? undefined : "numeric"
  }).format(date);
}

function getNotificationIcon(tipo: string) {
  const t = tipo.toLowerCase();
  if (t.includes("pago") || t.includes("success") || t.includes("exito")) {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />;
  }
  if (t.includes("parcial") || t.includes("warning") || t === "abono") {
    return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
  }
  if (t.includes("fall") || t.includes("error") || t.includes("rechazado")) {
    return <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />;
  }
  if (t.includes("venci") || t.includes("due")) {
    return <Clock className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />;
  }
  if (t.includes("recordatorio") || t.includes("email") || t.includes("correo")) {
    return <Mail className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />;
  }
  if (t.includes("workflow") || t.includes("sistema") || t.includes("automat")) {
    return <Settings className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />;
  }
  if (t.includes("boleta") || t.includes("factura") || t.includes("documento") || t.includes("recibo") || t === "comprobante") {
    return <FileText className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />;
  }
  if (t.includes("equipo") || t.includes("usuario") || t.includes("team") || t === "equipo") {
    return <Users className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />;
  }
  if (t.includes("trial") || t.includes("prueba") || t === "trial") {
    return <AlertOctagon className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />;
  }
  if (t.includes("whatsapp") || t.includes("wa")) {
    return <MessageCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  }
  return <Bell className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />;
}

export default function Notificaciones() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: notificaciones, isLoading, isError, refetch } = useListNotificaciones(
    {},
    { query: { queryKey: getListNotificacionesQueryKey({}) } }
  );

  const marcarLeida = useMarcarNotificacionLeida();
  const marcarTodasLeidas = useMarcarTodasNotificacionesLeidas();

  const updateCacheItem = (id: number) => {
    // Update main list
    queryClient.setQueryData<Notificacion[]>(getListNotificacionesQueryKey({}), (old) => {
      if (!old) return old;
      return old.map((n) => n.id === id ? { ...n, leida: true } : n);
    });
    // Update unread polling list
    queryClient.setQueryData<Notificacion[]>(getListNotificacionesQueryKey({ soloNoLeidas: true }), (old) => {
      if (!old) return old;
      return old.filter((n) => n.id !== id);
    });
  };

  const handleMarcarLeida = (id: number) => {
    marcarLeida.mutate(
      { id },
      {
        onSuccess: () => {
          updateCacheItem(id);
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo marcar como leída.", variant: "destructive" });
          queryClient.invalidateQueries({ queryKey: getListNotificacionesQueryKey() });
        },
      }
    );
  };

  const handleMarcarTodasLeidas = () => {
    marcarTodasLeidas.mutate(undefined, {
      onSuccess: () => {
        // Update main list
        queryClient.setQueryData<Notificacion[]>(getListNotificacionesQueryKey({}), (old) => {
          if (!old) return old;
          return old.map((n) => ({ ...n, leida: true }));
        });
        // Update unread polling list
        queryClient.setQueryData<Notificacion[]>(getListNotificacionesQueryKey({ soloNoLeidas: true }), () => []);

        toast({ title: "Éxito", description: "Todas las notificaciones fueron marcadas como leídas." });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err?.message || "No se pudo marcar las notificaciones.", variant: "destructive" });
      }
    });
  };

  const unreadCount = notificaciones?.filter(n => !n.leida).length || 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Centro de Actividades</h1>
            <p className="text-sm text-muted-foreground">
              Historial de notificaciones, recordatorios y eventos de tu cuenta.
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarcarTodasLeidas}
            disabled={marcarTodasLeidas.isPending}
            className="shrink-0"
          >
            {marcarTodasLeidas.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4 mr-2" />
            )}
            Marcar todas como leídas
          </Button>
        )}
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Todas las notificaciones</CardTitle>
            {unreadCount > 0 && (
              <CardDescription>Tienes {unreadCount} {unreadCount === 1 ? "notificación no leída" : "notificaciones no leídas"}</CardDescription>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 p-0 sm:p-6">
          {isLoading ? (
            <div className="space-y-3 p-4 sm:p-0">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-muted/40 rounded-lg animate-pulse" />)}
            </div>
          ) : isError ? (
            <div className="text-center py-10 px-4">
              <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3 opacity-80" />
              <h3 className="text-lg font-medium mb-1">Error al cargar notificaciones</h3>
              <p className="text-sm text-muted-foreground mb-4">Ocurrió un problema de conexión con el servidor.</p>
              <Button onClick={() => refetch()} variant="outline" size="sm">
                <RefreshCcw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            </div>
          ) : !notificaciones || notificaciones.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <Bell className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-medium mb-1">Tu historial está vacío</h3>
              <p className="text-sm text-muted-foreground">Cuando tengas actividad nueva, aparecerá aquí.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50 sm:space-y-3 sm:divide-y-0 p-0 sm:p-0">
              {notificaciones.map((n) => (
                <div
                  key={n.id}
                  className={`flex flex-col sm:flex-row sm:items-start gap-3 sm:rounded-lg p-4 sm:p-4 transition-colors ${
                    n.leida
                      ? "bg-background sm:border sm:border-border/50 opacity-70"
                      : "bg-primary/[0.03] sm:border sm:border-primary/20"
                  }`}
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="relative mt-0.5">
                      {getNotificationIcon(n.tipo)}
                      {!n.leida && (
                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-blue-500 border border-background" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-sm ${!n.leida ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>
                          {n.titulo}
                        </span>
                        {!n.leida && (
                          <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-sm bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            Nueva
                          </span>
                        )}
                      </div>
                      {n.mensaje && (
                        <p className={`text-sm ${!n.leida ? 'text-muted-foreground' : 'text-muted-foreground/80'} leading-relaxed mb-2`}>
                          {n.mensaje}
                        </p>
                      )}
                      <div className="flex items-center gap-4 flex-wrap mt-1">
                        <span className="text-xs text-muted-foreground/70 font-medium">
                          {formatRelativeTime(n.creadoEn)}
                        </span>
                        {n.cobroId && (
                          <Link
                            href={`/cobros/${n.cobroId}`}
                            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                          >
                            Ver cobro
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-7 sm:ml-0 mt-3 sm:mt-0">
                    {n.waUrl && (
                      <a href={n.waUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50 dark:hover:bg-emerald-900/40">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir WhatsApp
                        </Button>
                      </a>
                    )}
                    {!n.leida && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => handleMarcarLeida(n.id)}
                        disabled={marcarLeida.isPending}
                      >
                        {marcarLeida.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Leída
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
