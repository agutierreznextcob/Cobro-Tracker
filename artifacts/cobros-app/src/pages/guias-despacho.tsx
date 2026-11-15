import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatFechaPref } from "@/lib/format";
import { usePreferencias } from "@/hooks/use-preferencias";
import { useListGuias, ESTADO_GUIA, type EstadoGuia } from "@/lib/guias-despacho";
import { FileText, Search, RotateCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const FILTROS: Array<EstadoGuia | "todas"> = ["todas", "emitida", "entregada", "anulada"];

export default function GuiasDespachoPage() {
  const { prefs } = usePreferencias();
  const { data, isLoading, isError, refetch, isFetching } = useListGuias();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<EstadoGuia | "todas">("todas");

  const conteo = useMemo(() => {
    const m: Record<string, number> = { todas: data?.length ?? 0 };
    for (const g of data ?? []) m[g.estado] = (m[g.estado] ?? 0) + 1;
    return m;
  }, [data]);

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? [])
      .filter((g) => filtro === "todas" || g.estado === filtro)
      .filter((g) => !s || `${g.numeroGuia} ${g.clienteNombre} ${g.clienteRut ?? ""}`.toLowerCase().includes(s))
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }, [data, q, filtro]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Logística</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Guías de Despacho</h1>
          <p className="text-muted-foreground mt-1">Documentos de despacho emitidos desde pedidos.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} className="gap-1.5">
          <RotateCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      <Card className="p-3 sm:p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const sel = filtro === f;
            const cfg = f !== "todas" ? ESTADO_GUIA[f] : null;
            return (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                  sel
                    ? cfg ? cfg.className : "bg-foreground text-background border-foreground"
                    : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted",
                )}
              >
                {cfg && <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />}
                {f === "todas" ? "Todas" : ESTADO_GUIA[f].label}
                <span className="opacity-60">({conteo[f] ?? 0})</span>
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por número, cliente o RUT…"
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Cargando guías…</div>
        ) : isError ? (
          <div className="text-center py-12 text-destructive">Error al cargar guías.</div>
        ) : lista.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">
              {data?.length === 0
                ? "Aún no hay guías. Se generan desde un pedido aprobado."
                : "Sin resultados para tu búsqueda."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Emisión</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((g) => {
                  const cfg = ESTADO_GUIA[g.estado];
                  return (
                    <TableRow
                      key={g.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => window.location.href = `/guias-despacho/${g.id}`}
                    >
                      <TableCell className="font-mono text-xs font-medium">{g.numeroGuia}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{g.clienteNombre}</div>
                        {g.clienteRut && <div className="text-xs text-muted-foreground">{g.clienteRut}</div>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border", cfg.className)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                          {cfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatFechaPref(g.fechaEmision, prefs?.formatoFecha)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm tabular-nums">
                        {formatMoney(Number(g.total), g.moneda, g.decimales)}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
