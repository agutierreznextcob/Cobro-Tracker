import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { useGetLocal, getGetLocalQueryKey, useListInventario, getListInventarioQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/inventario";
import { AlertTriangle, ArrowLeft, ChevronRight, MapPin, Plus, RotateCw, Store, Warehouse } from "lucide-react";

export default function LocalDetailPage() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const { data: local, isLoading, isError, refetch } = useGetLocal(id, { query: { enabled: !!id, queryKey: getGetLocalQueryKey(id), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const { data: productos } = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });

  const unidades = useMemo(() => {
    const set = new Set<string>();
    (productos ?? []).forEach((p) => {
      if ((p.ubicaciones ?? []).some((u) => u.localId === id && u.stockActual !== 0)) set.add(p.unidadMedida || "unidad");
    });
    return [...set];
  }, [productos, id]);

  if (isLoading) return <div className="max-w-4xl mx-auto space-y-4 animate-pulse"><div className="h-8 w-60 bg-muted rounded" /><div className="h-64 bg-muted/60 rounded-xl" /></div>;
  if (isError || !local) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos este local.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/locales">Volver</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/locales" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Volver a locales</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><Store className="h-6 w-6 text-primary" />{local.nombre}</h1>
          {local.direccion && <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm"><MapPin className="h-3.5 w-3.5" />{local.direccion}</p>}
        </div>
        <Button asChild><Link href={`/bodegas/nueva?localId=${local.id}`} data-testid="link-agregar-bodega"><Plus className="h-4 w-4 mr-1.5" />Agregar bodega</Link></Button>
      </div>

      <div className="rounded-xl border bg-card px-5 py-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Stock total del local</p>
        <p className="font-mono text-3xl font-bold tabular-nums" data-testid="text-local-stock-total">{formatQty(local.stockTotal)}</p>
        {unidades.length > 1 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5" data-testid="text-local-unidades-mixtas">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
            Este total suma unidades distintas ({unidades.join(", ")}). Úsalo como referencia; revisa cada bodega para cantidades comparables.
          </p>
        )}
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base">Bodegas</CardTitle></CardHeader>
        <CardContent className="p-0">
          {local.bodegas.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Warehouse className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Este local todavía no tiene bodegas.</p>
              <Button asChild size="sm" variant="outline"><Link href={`/bodegas/nueva?localId=${local.id}`}>Crear bodega</Link></Button>
            </div>
          ) : (
            <ul className="divide-y">
              {local.bodegas.map((b) => (
                <li key={b.id}>
                  <Link href={`/bodegas/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40" data-testid={`link-bodega-${b.id}`}>
                    <div className="min-w-0">
                      <p className="font-medium flex items-center gap-2"><Warehouse className="h-4 w-4 text-muted-foreground" />{b.nombre}</p>
                      {b.descripcion && <p className="text-xs text-muted-foreground truncate">{b.descripcion}</p>}
                    </div>
                    <span className="flex items-center gap-1 font-mono text-sm">{formatQty(b.stockTotal)}<ChevronRight className="h-4 w-4 text-muted-foreground" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
