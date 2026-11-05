import { Link } from "wouter";
import { useListLocales, getListLocalesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/inventario";
import { ChevronRight, MapPin, Plus, RotateCw, Store, Warehouse } from "lucide-react";

export default function LocalesPage() {
  const { data: locales, isLoading, isError, refetch } = useListLocales({ query: { queryKey: getListLocalesQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Locales y bodegas</h1>
          <p className="text-muted-foreground mt-1">Dónde está físicamente tu stock. Cada bodega lleva su propio conteo y su propio stock crítico.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/bodegas/nueva" data-testid="link-nueva-bodega"><Warehouse className="h-4 w-4 mr-1.5" />Nueva bodega</Link></Button>
          <Button asChild><Link href="/locales/nuevo" data-testid="link-nuevo-local"><Plus className="h-4 w-4 mr-1.5" />Nuevo local</Link></Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2].map((i) => <div key={i} className="h-44 rounded-xl bg-muted/60 animate-pulse" />)}</div>
      ) : isError ? (
        <Card><CardContent className="py-14 text-center space-y-3">
          <p className="font-medium">No pudimos cargar los locales.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
        </CardContent></Card>
      ) : (locales ?? []).length === 0 ? (
        <Card><CardContent className="py-16 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center"><Store className="h-6 w-6 text-primary" /></div>
          <p className="font-semibold">Aún no tienes locales</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">Crea un local (tienda, sucursal o centro de distribución) y luego sus bodegas. Hasta entonces, tu inventario sigue funcionando con un stock general único.</p>
          <Button asChild size="sm"><Link href="/locales/nuevo"><Plus className="h-4 w-4 mr-1.5" />Crear el primer local</Link></Button>
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {locales!.map((l) => (
            <Card key={l.id} className="shadow-sm overflow-hidden" data-testid={`card-local-${l.id}`}>
              <div className="flex items-start justify-between gap-3 border-b bg-muted/30 px-5 py-4">
                <div className="min-w-0">
                  <Link href={`/locales/${l.id}`} className="font-semibold hover:underline flex items-center gap-1.5"><Store className="h-4 w-4 text-primary" />{l.nombre}</Link>
                  {l.direccion && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin className="h-3 w-3" />{l.direccion}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Stock total</p>
                  <p className="font-mono font-bold">{formatQty(l.stockTotal)}</p>
                </div>
              </div>
              <CardContent className="p-0">
                {l.bodegas.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-muted-foreground flex items-center justify-between">
                    Sin bodegas
                    <Link href={`/bodegas/nueva?localId=${l.id}`} className="text-primary text-xs hover:underline">Agregar bodega</Link>
                  </div>
                ) : (
                  <ul className="divide-y">
                    {l.bodegas.map((b) => (
                      <li key={b.id}>
                        <Link href={`/bodegas/${b.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/40" data-testid={`link-bodega-${b.id}`}>
                          <span className="flex items-center gap-2 min-w-0"><Warehouse className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="truncate">{b.nombre}</span></span>
                          <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">{formatQty(b.stockTotal)}<ChevronRight className="h-3.5 w-3.5" /></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
