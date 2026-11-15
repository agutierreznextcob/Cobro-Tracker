import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatFechaPref } from "@/lib/format";
import { usePreferencias } from "@/hooks/use-preferencias";
import { useListPedidos, ESTADO_PEDIDO, type EstadoPedido } from "@/lib/pedidos";
import { Package, Search, RotateCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const FILTROS: Array<EstadoPedido | "todos"> = ["todos", "pendiente", "aprobado", "despachado", "entregado", "cancelado"];

export default function PedidosPage() {
  const { prefs } = usePreferencias();
  const { data, isLoading, isError, refetch, isFetching } = useListPedidos();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<EstadoPedido | "todos">("todos");

  const conteo = useMemo(() => {
    const m: Record<string, number> = { todos: data?.length ?? 0 };
    for (const p of data ?? []) m[p.estado] = (m[p.estado] ?? 0) + 1;
    return m;
  }, [data]);

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? [])
      .filter((p) => filtro === "todos" || p.estado === filtro)
      .filter((p) => !s || `${p.numeroPedido} ${p.clienteNombre} ${p.clienteRut ?? ""}`.toLowerCase().includes(s))
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }, [data, q, filtro]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Logística</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground mt-1">Gestión de pedidos para despacho.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RotateCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      <Card className="p-3 sm:p-4 shadow-sm space-y-3">
        {/* Filtros de estado */}
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const sel = filtro === f;
            const cfg = f !== "todos" ? ESTADO_PEDIDO[f] : null;
            return (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                  sel
                    ? cfg
                      ? cfg.className
                      : "bg-foreground text-background border-foreground"
                    : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted",
                )}
              >
                {cfg && <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />}
                {f === "todos" ? "Todos" : ESTADO_PEDIDO[f].label}
                <span className="opacity-60">({conteo[f] ?? 0})</span>
              </button>
            );
          })}
        </div>

        {/* Buscador */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por número, cliente o RUT…"
            className="pl-9"
          />
        </div>

        {/* Tabla */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Cargando pedidos…</div>
        ) : isError ? (
          <div className="text-center py-12 text-destructive">Error al cargar pedidos.</div>
        ) : lista.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <Package className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">
              {data?.length === 0
                ? "Aún no hay pedidos. Los pedidos se crean desde una cotización aceptada."
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
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => {
                  const cfg = ESTADO_PEDIDO[p.estado];
                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => window.location.href = `/pedidos/${p.id}`}
                    >
                      <TableCell className="font-mono text-xs font-medium">{p.numeroPedido}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{p.clienteNombre}</div>
                        {p.clienteRut && <div className="text-xs text-muted-foreground">{p.clienteRut}</div>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border", cfg.className)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                          {cfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatFechaPref(p.creadoEn, prefs?.formatoFecha)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm tabular-nums">
                        {formatMoney(Number(p.total), p.moneda, p.decimales)}
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
