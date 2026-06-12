import { useState } from "react";
import { useListWebhookEventos, getListWebhookEventosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw, CheckCircle2, XCircle, Globe,
  Calendar, Info, Webhook, ChevronLeft, ChevronRight, Filter, X, Download
} from "lucide-react";
import { formatDate } from "@/lib/format";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PAGE_SIZE = 20;

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
  const [page, setPage] = useState(0);
  const [filterResultado, setFilterResultado] = useState<"exitoso" | "fallido" | "">("");
  const [filterEvento, setFilterEvento] = useState<string>("");

  const params = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(filterResultado ? { resultado: filterResultado as "exitoso" | "fallido" } : {}),
    ...(filterEvento ? { evento: filterEvento } : {}),
  };

  const { data, isLoading, isFetching } = useListWebhookEventos(params, {
    query: { queryKey: getListWebhookEventosQueryKey(params) },
  });

  const eventos = data?.items ?? [];
  const total = data?.total ?? 0;
  const eventosUnicos = data?.eventosUnicos ?? [];
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = !!filterResultado || !!filterEvento;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["webhooks", "eventos"] });
  };

  const handleExport = () => {
    const qs = new URLSearchParams();
    if (filterResultado) qs.set("resultado", filterResultado);
    if (filterEvento) qs.set("evento", filterEvento);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    const url = `${BASE}/api/webhooks/eventos/export${query}`;
    const a = document.createElement("a");
    a.href = url;
    a.click();
  };

  const resetFilters = () => {
    setFilterResultado("");
    setFilterEvento("");
    setPage(0);
  };

  const changeFilter = (type: "resultado" | "evento", value: string) => {
    setPage(0);
    if (type === "resultado") setFilterResultado(value as "exitoso" | "fallido" | "");
    else setFilterEvento(value);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Log de Webhooks</h1>
          <p className="text-muted-foreground mt-1">
            Historial de eventos recibidos, con filtros por resultado y tipo.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isLoading || total === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Exportar CSV
            {hasFilters && total > 0 && (
              <span className="ml-1 text-xs bg-primary/10 text-primary rounded-full px-1.5 py-0.5 font-medium">
                {total}
              </span>
            )}
          </Button>
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
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />
          Filtros
        </div>

        <Select value={filterResultado || "all"} onValueChange={(v) => changeFilter("resultado", v === "all" ? "" : v)}>
          <SelectTrigger className="w-[160px] h-9 text-sm">
            <SelectValue placeholder="Resultado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los resultados</SelectItem>
            <SelectItem value="exitoso">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Exitoso</span>
            </SelectItem>
            <SelectItem value="fallido">
              <span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-destructive" /> Fallido</span>
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterEvento || "all"} onValueChange={(v) => changeFilter("evento", v === "all" ? "" : v)}>
          <SelectTrigger className="w-[200px] h-9 text-sm">
            <SelectValue placeholder="Tipo de evento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los eventos</SelectItem>
            {eventosUnicos.map((e) => (
              <SelectItem key={e} value={e}>
                <span className="font-mono text-xs">{e}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5 h-9 text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            Limpiar
          </Button>
        )}

        {!isLoading && (
          <span className="text-sm text-muted-foreground ml-auto">
            {total} {total === 1 ? "evento" : "eventos"}
            {hasFilters && " encontrados"}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : eventos.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Webhook className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">
                {hasFilters ? "Sin eventos para estos filtros" : "Sin eventos registrados"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {hasFilters
                  ? "Prueba cambiando o limpiando los filtros."
                  : "Los eventos aparecerán aquí cuando se reciban webhooks."}
              </p>
            </div>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Limpiar filtros
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm border-border/50">
          <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">
                  {eventos.length === 1 ? "1 evento" : `${eventos.length} eventos`}
                  {totalPages > 1 && (
                    <span className="text-muted-foreground font-normal text-sm ml-2">
                      (pág. {page + 1} de {totalPages})
                    </span>
                  )}
                </CardTitle>
                {eventos[0] && (
                  <CardDescription className="mt-0.5">
                    Último: {formatDate(eventos[0].creadoEn)}
                  </CardDescription>
                )}
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
                  style={{ animationDelay: `${Math.min(idx * 20, 200)}ms` }}
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-border/50 px-6 py-3 flex items-center justify-between bg-muted/10">
              <span className="text-xs text-muted-foreground">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0 || isFetching}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
                  const pageNum = totalPages <= 7 ? i : (
                    page < 4 ? i :
                    page > totalPages - 5 ? totalPages - 7 + i :
                    page - 3 + i
                  );
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      disabled={isFetching}
                      className="h-8 w-8 p-0 text-xs"
                    >
                      {pageNum + 1}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || isFetching}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
