import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListCotizaciones, getListCotizacionesQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstadoCotizacionBadge } from "@/components/estado-cotizacion-badge";
import { ESTADO_COTIZACION, type EstadoCotizacion } from "@/lib/cotizaciones";
import { formatMoney, formatFechaPref, totalesPorMoneda } from "@/lib/format";
import { usePreferencias } from "@/hooks/use-preferencias";
import { ArrowRight, FileSignature, Plus, RotateCw, Search } from "lucide-react";

const FILTROS: Array<EstadoCotizacion | "todas"> = ["todas", "borrador", "enviada", "aceptada", "rechazada", "vencida"];

export default function CotizacionesPage() {
  const [, navigate] = useLocation();
  const { prefs } = usePreferencias();
  const { data, isLoading, isError, refetch, isFetching } = useListCotizaciones({
    query: { queryKey: getListCotizacionesQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 },
  });
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<EstadoCotizacion | "todas">("todas");

  const conteo = useMemo(() => {
    const m: Record<string, number> = { todas: data?.length ?? 0 };
    for (const c of data ?? []) m[c.estado] = (m[c.estado] ?? 0) + 1;
    return m;
  }, [data]);

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => filtro === "todas" || c.estado === filtro)
      .filter((c) => !s || `${c.numeroCotizacion} ${c.clienteNombre} ${c.clienteRut ?? ""}`.toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data, q, filtro]);

  // Totals are grouped by document currency; never summed across currencies.
  const totales = useMemo(() => totalesPorMoneda(lista, (c) => c.total), [lista]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Ventas</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Cotizaciones</h1>
          <p className="text-muted-foreground mt-1">Propuestas a clientes, desde el borrador hasta el cobro.</p>
        </div>
        <Button asChild data-testid="button-nueva-cotizacion">
          <Link href="/cotizaciones/nueva"><Plus className="h-4 w-4 mr-1.5" />Nueva cotización</Link>
        </Button>
      </div>

      <Card className="p-3 sm:p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const sel = filtro === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFiltro(f)}
                data-testid={`filter-cotizacion-${f}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${sel ? "border-primary bg-primary text-primary-foreground" : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-secondary/60"}`}
              >
                {f === "todas" ? "Todas" : ESTADO_COTIZACION[f].label}
                <span className={`ml-1.5 tabular-nums ${sel ? "opacity-80" : "opacity-60"}`}>{conteo[f] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, cliente o RUT" className="pl-9" data-testid="input-buscar-cotizacion" />
        </div>
      </Card>

      {isLoading ? (
        <Card className="p-4 space-y-3 shadow-sm">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-md bg-muted/60 animate-pulse" />)}
        </Card>
      ) : isError ? (
        <Card className="p-10 text-center space-y-3 shadow-sm">
          <p className="font-medium">No pudimos cargar las cotizaciones.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
        </Card>
      ) : (data ?? []).length === 0 ? (
        <Card className="p-10 sm:p-14 shadow-sm">
          <div className="max-w-sm mx-auto text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <FileSignature className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-lg">Aún no hay cotizaciones</p>
              <p className="text-sm text-muted-foreground mt-1">Arma una propuesta con ítems de tu catálogo o texto libre. Cuando el cliente la acepte, la conviertes en cobro con un clic.</p>
            </div>
            <Button asChild><Link href="/cotizaciones/nueva"><Plus className="h-4 w-4 mr-1.5" />Crear la primera</Link></Button>
          </div>
        </Card>
      ) : (
        <Card className="shadow-sm overflow-hidden">
          <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-32">Número</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="w-36">Estado</TableHead>
                  <TableHead className="w-32">Emisión</TableHead>
                  <TableHead className="w-32">Vencimiento</TableHead>
                  <TableHead className="w-24 hidden lg:table-cell">Moneda</TableHead>
                  <TableHead className="text-right w-36">Total</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">Sin resultados para este filtro.</TableCell></TableRow>
                ) : lista.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/cotizaciones/${c.id}`)} data-testid={`row-cotizacion-${c.id}`}>
                    <TableCell className="font-mono text-sm font-semibold">{c.numeroCotizacion}</TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{c.clienteNombre}</p>
                      {c.clienteRut && <p className="font-mono text-[11px] text-muted-foreground">{c.clienteRut}</p>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <EstadoCotizacionBadge estado={c.estado} />
                        {c.cobroId && <span className="text-[10px] font-medium text-primary">cobro creado</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">{formatFechaPref(c.fechaEmision, prefs.formatoFecha)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatFechaPref(c.fechaVencimiento, prefs.formatoFecha)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground hidden lg:table-cell">{c.moneda}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-sm whitespace-nowrap">{formatMoney(c.total, c.moneda, c.decimales)}</TableCell>
                    <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground/40" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          {totales.length > 0 && lista.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t bg-muted/20 px-4 py-3 text-sm" data-testid="text-totales-cotizaciones">
              <span className="text-muted-foreground">{lista.length} cotización{lista.length === 1 ? "" : "es"}</span>
              {totales.map((t) => (
                <span key={t.moneda} className="font-mono font-semibold">
                  <span className="mr-1.5 text-[10px] font-sans font-medium text-muted-foreground">{t.moneda}</span>
                  {formatMoney(t.total, t.moneda, t.decimales)}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
