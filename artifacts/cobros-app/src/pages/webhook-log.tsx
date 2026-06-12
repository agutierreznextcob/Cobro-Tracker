import { useListWebhookEventos, getListWebhookEventosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RefreshCw, CheckCircle2, XCircle, Globe, Calendar, Info, Webhook } from "lucide-react";
import { formatDate } from "@/lib/format";

const EVENTO_LABELS: Record<string, string> = {
  "pago.completado": "Pago completado",
  "pago.fallido": "Pago fallido",
  "pago.cancelado": "Pago cancelado",
  "pago.pendiente": "Pago pendiente",
  "desconocido": "Desconocido",
};

function ResultadoBadge({ exitoso }: { exitoso: boolean }) {
  if (exitoso) {
    return (
      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 gap-1.5 font-medium shrink-0">
        <CheckCircle2 className="h-3 w-3" />
        Exitoso
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1.5 font-medium shrink-0">
      <XCircle className="h-3 w-3" />
      Fallido
    </Badge>
  );
}

export default function WebhookLog() {
  const queryClient = useQueryClient();
  const { data: eventos, isLoading, isFetching } = useListWebhookEventos(
    { limit: 100 },
    { query: { queryKey: getListWebhookEventosQueryKey({ limit: 100 }) } }
  );

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getListWebhookEventosQueryKey({ limit: 100 }) });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Log de Webhooks</h1>
          <p className="text-muted-foreground mt-1">
            Historial de todos los eventos recibidos, con IP, resultado y detalle.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-16 bg-muted/20 rounded-lg" />
            </Card>
          ))}
        </div>
      ) : !eventos || eventos.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Webhook className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Sin eventos registrados</p>
              <p className="text-sm text-muted-foreground mt-1">
                Los eventos aparecerán aquí cuando se reciban webhooks.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm border-border/50">
          <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">{eventos.length} eventos</CardTitle>
                <CardDescription className="mt-0.5">
                  Último: {formatDate(eventos[0].creadoEn)}
                </CardDescription>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-emerald-600 font-medium">
                  {eventos.filter(e => e.exitoso).length} exitosos
                </span>
                <span className="text-destructive font-medium">
                  {eventos.filter(e => !e.exitoso).length} fallidos
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {eventos.map((evento, idx) => (
                <div
                  key={evento.id}
                  className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors animate-in fade-in slide-in-from-top-1"
                  style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                >
                  <div className="pt-0.5 shrink-0">
                    {evento.exitoso
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      : <XCircle className="h-4 w-4 text-destructive" />
                    }
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {EVENTO_LABELS[evento.evento] ?? evento.evento}
                      </span>
                      <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                        {evento.evento}
                      </code>
                      <ResultadoBadge exitoso={evento.exitoso} />
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      {evento.cobroId !== null && evento.cobroId !== undefined && (
                        <span className="flex items-center gap-1">
                          <Info className="h-3 w-3" />
                          Cobro #{evento.cobroId}
                        </span>
                      )}
                      {evento.ipOrigen && (
                        <span className="flex items-center gap-1 font-mono">
                          <Globe className="h-3 w-3" />
                          {evento.ipOrigen}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(evento.creadoEn)}
                      </span>
                    </div>

                    {evento.detalle && (
                      <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 font-mono">
                        {evento.detalle}
                      </p>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground font-mono shrink-0">
                    #{evento.id}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
