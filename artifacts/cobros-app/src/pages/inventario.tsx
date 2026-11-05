import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListInventario, useGetInventarioResumen, getListInventarioQueryKey, getGetInventarioResumenQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { estadoVisual, formatPct, formatQty, type EstadoVisual } from "@/lib/inventario";
import { EstadoStockBadge, TipoBadge } from "@/components/inventario-badges";
import { AlertTriangle, ArrowLeftRight, Ban, Boxes, Package, Pencil, Plus, Search, Wrench, RotateCw } from "lucide-react";

type Filtro = "todos" | "producto" | "servicio" | "alerta" | "archivados";

const FILTROS: { value: Filtro; label: string }[] = [
  { value: "todos", label: "Activos" },
  { value: "producto", label: "Productos" },
  { value: "servicio", label: "Servicios" },
  { value: "alerta", label: "Con alerta" },
  { value: "archivados", label: "Archivados" },
];

export default function InventarioPage() {
  const { data: productos, isLoading, isError, refetch } = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const { data: resumen } = useGetInventarioResumen({ query: { queryKey: getGetInventarioResumenQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>(() =>
    new URLSearchParams(window.location.search).get("filtro") === "alerta" ? "alerta" : "todos",
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (productos ?? [])
      .filter((p) => {
        const e: EstadoVisual = estadoVisual(p);
        if (filtro === "archivados") return !p.activo;
        if (!p.activo) return false;
        if (filtro === "producto" || filtro === "servicio") return p.tipo === filtro;
        if (filtro === "alerta") return e === "critico" || e === "agotado";
        return true;
      })
      .filter((p) => !q || `${p.nombre} ${p.descripcion ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [productos, busqueda, filtro]);

  const stats = [
    { label: "Productos", value: resumen?.productos, Icon: Package, cls: "" },
    { label: "Servicios", value: resumen?.servicios, Icon: Wrench, cls: "" },
    { label: "Stock crítico", value: resumen?.criticos, Icon: AlertTriangle, cls: (resumen?.criticos ?? 0) > 0 ? "border-red-300 bg-red-50 text-red-700" : "" },
    { label: "Agotados", value: resumen?.agotados, Icon: Ban, cls: (resumen?.agotados ?? 0) > 0 ? "border-red-200 bg-red-50/60 text-red-700" : "" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Inventario</h1>
          <p className="text-muted-foreground mt-1">Tu catálogo de productos y servicios, con costos y márgenes a la vista para cotizar sin dudar.</p>
        </div>
        <Button asChild>
          <Link href="/inventario/nuevo"><Plus className="h-4 w-4 mr-1.5" />Nuevo ítem</Link>
        </Button>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, Icon, cls }) => (
          <div key={label} className={`rounded-xl border bg-card px-4 py-3 ${cls}`}>
            <div className="flex items-center justify-between text-xs font-medium opacity-80">
              {label}<Icon className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 text-2xl font-bold font-mono">
              {value === undefined ? <span className="inline-block h-6 w-10 rounded bg-muted animate-pulse" /> : value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg overflow-x-auto max-w-full">
          {FILTROS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFiltro(f.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
                filtro === f.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre" className="pl-9" />
        </div>
      </div>

      <Card className="shadow-sm overflow-hidden">
        {isError ? (
          <CardContent className="py-14 text-center space-y-3">
            <p className="font-medium">No pudimos cargar el inventario.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          </CardContent>
        ) : !isLoading && (productos?.length ?? 0) === 0 ? (
          <CardContent className="py-16 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center"><Boxes className="h-6 w-6 text-primary" /></div>
            <p className="font-semibold">Tu catálogo está vacío</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Agrega lo que vendes con su costo y precio. Luego podrás sumarlo a tus cobros y el stock se descuenta solo al pagarse.</p>
            <Button asChild size="sm"><Link href="/inventario/nuevo"><Plus className="h-4 w-4 mr-1.5" />Agregar el primero</Link></Button>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Margen / Utilidad</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? [1, 2, 3, 4].map((i) => (
                      <TableRow key={i} className="animate-pulse">
                        {[40, 16, 16, 16, 20, 10, 20, 16].map((w, j) => (
                          <TableCell key={j}><div className="h-4 bg-muted rounded" style={{ width: `${w * 4}px` }} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : filtrados.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">Nada coincide con este filtro.</TableCell></TableRow>
                    ) : filtrados.map((p) => {
                      const e = estadoVisual(p);
                      const alerta = e === "critico" || e === "agotado";
                      return (
                        <TableRow key={p.id} className={`group ${alerta ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-muted/30"} ${!p.activo ? "opacity-60" : ""}`}>
                          <TableCell className="max-w-[260px]">
                            <Link href={`/inventario/${p.id}/editar`} className="font-medium hover:underline">{p.nombre}</Link>
                            {p.descripcion && <p className="text-xs text-muted-foreground truncate">{p.descripcion}</p>}
                          </TableCell>
                          <TableCell><TipoBadge tipo={p.tipo} /></TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">{formatCurrency(p.costoUnitario)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatCurrency(p.precioUnitario)}</TableCell>
                          <TableCell className="text-right">
                            <div className={`font-mono text-sm font-semibold ${p.utilidad < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPct(p.margenReal)}</div>
                            <div className="text-xs text-muted-foreground font-mono">{formatCurrency(p.utilidad)}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {p.tipo === "servicio" ? <span className="text-muted-foreground/50">—</span> : (
                              <span className={alerta ? "text-red-700 font-bold" : ""}>
                                {formatQty(p.stockActual ?? 0)}
                                <span className="block text-[10px] text-muted-foreground font-sans">{p.unidadMedida || "un"} · mín {formatQty(p.stockCritico)}</span>
                              </span>
                            )}
                          </TableCell>
                          <TableCell><EstadoStockBadge estado={e} /></TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex gap-1">
                              <Button asChild variant="ghost" size="sm" className="h-8 px-2" title="Editar">
                                <Link href={`/inventario/${p.id}/editar`}><Pencil className="h-3.5 w-3.5" /><span className="ml-1 hidden xl:inline">Editar</span></Link>
                              </Button>
                              {p.tipo === "producto" && (
                                <Button asChild variant="ghost" size="sm" className="h-8 px-2" title="Movimiento de stock">
                                  <Link href={`/inventario/${p.id}/movimiento`}><ArrowLeftRight className="h-3.5 w-3.5" /><span className="ml-1 hidden xl:inline">Stock</span></Link>
                                </Button>
                              )}
                            </div>
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
