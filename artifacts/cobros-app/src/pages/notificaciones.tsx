import {
  useListNotificaciones,
  getListNotificacionesQueryKey,
  useMarcarNotificacionLeida,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { Bell, MessageCircle, ExternalLink, Check, Loader2 } from "lucide-react";

export default function Notificaciones() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: notificaciones, isLoading } = useListNotificaciones(
    {},
    { query: { queryKey: getListNotificacionesQueryKey({}) } }
  );
  const marcarLeida = useMarcarNotificacionLeida();

  const handleMarcarLeida = (id: number) => {
    marcarLeida.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNotificacionesQueryKey() });
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo marcar como leída.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bell className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            Recordatorios de WhatsApp pendientes de enviar a tus clientes.
          </p>
        </div>
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Todas las notificaciones</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted/40 rounded animate-pulse" />)}
            </div>
          ) : !notificaciones || notificaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No tienes notificaciones.</p>
          ) : (
            <div className="space-y-2">
              {notificaciones.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 rounded-md border px-3 py-3 ${
                    n.leida ? "border-border/50 bg-background opacity-70" : "border-primary/30 bg-primary/5"
                  }`}
                >
                  <MessageCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{n.titulo}</span>
                      {!n.leida && (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/20">
                          Nueva
                        </span>
                      )}
                    </div>
                    {n.mensaje && <p className="text-xs text-muted-foreground mt-0.5">{n.mensaje}</p>}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{formatDate(n.creadoEn)}</span>
                      {n.cobroId && (
                        <Link
                          href={`/cobros/${n.cobroId}`}
                          className="text-[10px] text-primary hover:underline"
                        >
                          Ver cobro
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {n.waUrl && (
                      <a href={n.waUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" className="h-7 gap-1 text-[11px] bg-emerald-600 hover:bg-emerald-700">
                          <ExternalLink className="h-3 w-3" />
                          Abrir WhatsApp
                        </Button>
                      </a>
                    )}
                    {!n.leida && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-[11px]"
                        onClick={() => handleMarcarLeida(n.id)}
                        disabled={marcarLeida.isPending}
                      >
                        {marcarLeida.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Listo
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
