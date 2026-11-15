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
        <Card className="shadow-sm overflow-hidden">
          {/* Header */}
          <div className="hidden sm:grid grid-cols-[2fr_2fr_1fr_1fr] gap-4 px-4 py-2.5 bg-muted/40 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Local / Sucursal</span>
            <span>Bodegas</span>
            <span className="text-right">Stock total</span>
            <span />
          </div>
          {locales!.map((l, idx) => (
            <div key={l.id} className={idx !== locales!.length - 1 ? "border-b border-border/50" : ""} data-testid={`card-local-${l.id}`}>
              {/* Fila del local */}
              <div className="grid grid-cols-[2fr_2fr_1fr_1fr] items-center gap-4 px-4 py-3 bg-muted/10">
                <div className="min-w-0">
                  <Link href={`/locales/${l.id}`} className="font-semibold text-sm hover:text-primary flex items-center gap-1.5 transition-colors">
                    <Store className="h-4 w-4 text-primary shrink-0" />{l.nombre}
                  </Link>
                  {l.direccion && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 ml-5">
                      <MapPin className="h-3 w-3 shrink-0" />{l.direccion}
                    </p>
                  )}
                </div>
                <div className="hidden sm:block text-xs text-muted-foreground">
                  {l.bodegas.length === 0
                    ? <Link href={`/bodegas/nueva?localId=${l.id}`} className="text-primary hover:underline">+ Agregar bodega</Link>
                    : <span>{l.bodegas.length} bodega{l.bodegas.length !== 1 ? "s" : ""}</span>
                  }
                </div>
                <div className="hidden sm:block text-right font-mono text-sm font-semibold">{formatQty(l.stockTotal)}</div>
                <div className="flex justify-end">
                  <Link href={`/locales/${l.id}`}>
                    <ChevronRight className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
                  </Link>
                </div>
              </div>
              {/* Filas de bodegas */}
              {l.bodegas.map((b) => (
                <Link key={b.id} href={`/bodegas/${b.id}`} data-testid={`link-bodega-${b.id}`}>
                  <div className="grid grid-cols-[2fr_2fr_1fr_1fr] items-center gap-4 px-4 py-2.5 hover:bg-muted/30 transition-colors border-t border-border/30 group">
                    <div className="flex items-center gap-2 ml-5 min-w-0">
                      <Warehouse className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate group-hover:text-primary transition-colors">{b.nombre}</span>
                    </div>
                    <div className="hidden sm:block" />
                    <div className="hidden sm:block text-right font-mono text-xs text-muted-foreground">{formatQty(b.stockTotal)}</div>
                    <div className="flex justify-end">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
