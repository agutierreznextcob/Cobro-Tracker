import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import * as XLSX from "xlsx";
import { useListInventario, useGetInventarioResumen, useCreateProducto, getListInventarioQueryKey, getGetInventarioResumenQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { usePreferencias, decimalesPref } from "@/hooks/use-preferencias";

// Product prices render in each product's own currency (legacy = CLP) with the
// global monetary precision preference. Saved rows are never rewritten.
let decInventario = 0;
const pm = (n: number, moneda?: string | null) => formatMoney(n, moneda, decInventario);
import { estadoVisual, etiquetaUbicacion, formatPct, formatQty, ubicacionCritica, type EstadoVisual } from "@/lib/inventario";
import { ScanLookup } from "@/components/barcode-scanner";
import { EstadoStockBadge, TipoBadge } from "@/components/inventario-badges";
import { AlertTriangle, ArrowLeftRight, Ban, Boxes, CheckCircle2, Download, Loader2, Package, Pencil, Plus, Search, Upload, Wrench, RotateCw, Warehouse, X } from "lucide-react";

type Filtro = "todos" | "producto" | "servicio" | "alerta" | "archivados";

const FILTROS: { value: Filtro; label: string }[] = [
  { value: "todos", label: "Activos" },
  { value: "producto", label: "Productos" },
  { value: "servicio", label: "Servicios" },
  { value: "alerta", label: "Con alerta" },
  { value: "archivados", label: "Archivados" },
];

// ── Importación masiva de productos ─────────────────────────────────────────
const PLANTILLA_HEADERS_PRODUCTOS = [
  "Nombre*", "Tipo (producto/servicio)", "Código interno", "SKU", "Código de barras",
  "Descripción", "Costo unitario*", "Precio unitario*", "Moneda (CLP/USD/UF)",
  "Unidad de medida", "Margen %", "Stock crítico",
];

function descargarPlantillaProductos() {
  const ws = XLSX.utils.aoa_to_sheet([
    PLANTILLA_HEADERS_PRODUCTOS,
    ["Polera manga corta", "producto", "POL-001", "SKU-001", "7891234567890", "Polera 100% algodón talla M", "5000", "9990", "CLP", "unidad", "30", "5"],
    ["Consultoría hora", "servicio", "CONS-001", "", "", "Consultoría técnica por hora", "0", "50000", "CLP", "hora", "", ""],
  ]);
  ws["!cols"] = [
    { wch: 24 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
    { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    { wch: 16 }, { wch: 10 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Productos");
  XLSX.writeFile(wb, "plantilla-productos.xlsx");
}

function ImportarProductosButton({ onImported }: { onImported: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const crear = useCreateProducto();
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{ importados: number; omitidos: string[] } | null>(null);

  const handleFile = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(ws, { header: 1 });
      const filas = rows.slice(1).filter((r) => r && r.some((c) => String(c ?? "").trim() !== ""));

      if (filas.length === 0) {
        toast({ title: "Archivo vacío", description: "El Excel no contiene filas de productos.", variant: "destructive" });
        return;
      }
      if (filas.length > 200) {
        toast({ title: "Demasiadas filas", description: "Máximo 200 productos por importación.", variant: "destructive" });
        return;
      }

      setImportando(true);
      let importados = 0;
      const omitidos: string[] = [];

      for (const r of filas) {
        const nombre = String(r[0] ?? "").trim();
        if (!nombre) { omitidos.push("(sin nombre)"); continue; }
        const tipo = String(r[1] ?? "producto").trim().toLowerCase();
        const costoUnitario = parseFloat(String(r[6] ?? "0").replace(",", ".")) || 0;
        const precioUnitario = parseFloat(String(r[7] ?? "0").replace(",", ".")) || 0;
        if (precioUnitario <= 0) { omitidos.push(nombre + " (precio inválido)"); continue; }
        try {
          await new Promise<void>((resolve, reject) => {
            crear.mutate(
              {
                data: {
                  nombre,
                  tipo: tipo === "servicio" ? "servicio" : "producto",
                  codigoInterno: String(r[2] ?? "").trim() || undefined,
                  sku: String(r[3] ?? "").trim(),
                  codigoBarras: String(r[4] ?? "").trim(),
                  descripcion: String(r[5] ?? "").trim() || undefined,
                  costoUnitario,
                  precioUnitario,
                  moneda: (["CLP", "USD", "UF"].includes(String(r[8] ?? "").trim().toUpperCase()) ? String(r[8]).trim().toUpperCase() : "CLP") as "CLP" | "USD" | "UF",
                  unidadMedida: String(r[9] ?? "").trim() || undefined,
                  margenPorcentaje: parseFloat(String(r[10] ?? "").replace(",", ".")) || undefined,
                  stockCritico: parseInt(String(r[11] ?? "0")) || 0,
                  activo: true,
                },
              },
              { onSuccess: () => resolve(), onError: () => reject() }
            );
          });
          importados++;
        } catch {
          omitidos.push(nombre + " (error al crear)");
        }
      }

      setImportando(false);
      setResultado({ importados, omitidos });
      onImported();
    } catch {
      setImportando(false);
      toast({ title: "Archivo inválido", description: "No se pudo leer el Excel. Usa la plantilla.", variant: "destructive" });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" className="gap-1.5" onClick={descargarPlantillaProductos}>
        <Download className="h-4 w-4" />
        Descargar plantilla Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={importando}
        onClick={() => inputRef.current?.click()}
      >
        {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Importar productos
      </Button>

      <Dialog open={resultado != null} onOpenChange={(o) => !o && setResultado(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resultado de la importación</DialogTitle>
          </DialogHeader>
          {resultado && (
            <div className="space-y-3 pt-1">
              <p className="text-sm">
                <CheckCircle2 className="inline h-4 w-4 text-emerald-500 mr-1.5 -mt-0.5" />
                <strong>{resultado.importados}</strong> producto{resultado.importados !== 1 ? "s" : ""} importado{resultado.importados !== 1 ? "s" : ""} correctamente
                {resultado.omitidos.length > 0 && (
                  <>, <strong>{resultado.omitidos.length}</strong> omitido{resultado.omitidos.length !== 1 ? "s" : ""} por error</>
                )}.
              </p>
              {resultado.omitidos.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border">
                  <ul className="divide-y text-xs">
                    {resultado.omitidos.map((m, i) => (
                      <li key={i} className="px-3 py-1.5 text-muted-foreground">{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function InventarioPage() {
  const { prefs } = usePreferencias();
  decInventario = decimalesPref(prefs);
  const { data: productos, isLoading, isError, refetch } = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const { data: resumen } = useGetInventarioResumen({ query: { queryKey: getGetInventarioResumenQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>(() =>
    new URLSearchParams(window.location.search).get("filtro") === "alerta" ? "alerta" : "todos",
  );

  const [sel, setSel] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const seleccionado = (productos ?? []).find((p) => p.id === sel) ?? null;
  useEffect(() => {
    if (sel == null) return;
    const t = setTimeout(() => rowRefs.current.get(sel)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    return () => clearTimeout(t);
  }, [sel]);

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
      .filter((p) => !q || `${p.nombre} ${p.descripcion ?? ""} ${p.codigoInterno ?? ""} ${p.sku ?? ""} ${p.codigoBarras ?? ""}`.toLowerCase().includes(q))
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
        <div className="flex flex-wrap gap-2">
          <ImportarProductosButton onImported={() => void refetch()} />
          <Button asChild>
            <Link href="/inventario/nuevo"><Plus className="h-4 w-4 mr-1.5" />Nuevo ítem</Link>
          </Button>
        </div>
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

      <div className="grid gap-3 lg:grid-cols-[minmax(0,420px)_1fr] items-start">
        <ScanLookup productos={productos} testId="scanner-inventario"
          onSelect={(p) => { setBusqueda(""); setFiltro(p.activo ? "todos" : "archivados"); setSel(p.id); }} />
        {seleccionado && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 animate-in fade-in slide-in-from-top-1 duration-200" data-testid="panel-producto-escaneado">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold truncate">{seleccionado.nombre}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{[seleccionado.codigoInterno, seleccionado.sku && `SKU ${seleccionado.sku}`, seleccionado.codigoBarras].filter(Boolean).join(" · ")}</p>
              </div>
              <button type="button" onClick={() => setSel(null)} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar detalle"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span><span className="text-muted-foreground">Precio </span><span className="font-mono font-semibold">{pm(seleccionado.precioUnitario, seleccionado.moneda)}</span></span>
              {seleccionado.tipo === "producto" && <span><span className="text-muted-foreground">Stock total </span><span className="font-mono font-semibold">{formatQty(seleccionado.stockActual ?? 0)} {seleccionado.unidadMedida || "unidad"}</span></span>}
              <EstadoStockBadge estado={estadoVisual(seleccionado)} />
            </div>
            {(seleccionado.ubicaciones ?? []).length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {seleccionado.ubicaciones!.map((u) => (
                  <li key={u.bodegaId} className={`flex justify-between gap-2 ${ubicacionCritica(u) ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
                    <span>{etiquetaUbicacion(u)}</span><span className="font-mono">{formatQty(u.stockActual)} · mín {formatQty(u.stockCritico)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <Button asChild size="sm" variant="outline" className="h-8 bg-background"><Link href={`/inventario/${seleccionado.id}/editar`}><Pencil className="h-3.5 w-3.5 mr-1" />Editar</Link></Button>
              {seleccionado.tipo === "producto" && <Button asChild size="sm" className="h-8"><Link href={`/inventario/${seleccionado.id}/movimiento`}><ArrowLeftRight className="h-3.5 w-3.5 mr-1" />Movimiento</Link></Button>}
            </div>
          </div>
        )}
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
          <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o código" className="pl-9" />
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
                  <TableHead>Códigos</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Margen / Utilidad</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? [1, 2, 3, 4].map((i) => (
                      <TableRow key={i} className="animate-pulse">
                        {[40, 20, 16, 16, 16, 20, 10, 24, 20, 16].map((w, j) => (
                          <TableCell key={j}><div className="h-4 bg-muted rounded" style={{ width: `${w * 4}px` }} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : filtrados.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="h-28 text-center text-muted-foreground">Nada coincide con este filtro.</TableCell></TableRow>
                    ) : filtrados.map((p) => {
                      const e = estadoVisual(p);
                      const alerta = e === "critico" || e === "agotado";
                      return (
                        <TableRow key={p.id} ref={(el) => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id); }} data-testid={`row-producto-${p.id}`}
                          onClick={() => setSel(p.id)}
                          className={`group cursor-pointer ${sel === p.id ? "ring-2 ring-inset ring-primary bg-primary/5" : ""} ${alerta ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-muted/30"} ${!p.activo ? "opacity-60" : ""}`}>
                          <TableCell className="max-w-[260px]">
                            <Link href={`/inventario/${p.id}/editar`} className="font-medium hover:underline">{p.nombre}</Link>
                            {p.descripcion && <p className="text-xs text-muted-foreground truncate">{p.descripcion}</p>}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] leading-tight whitespace-nowrap">
                            <div className="font-semibold">{p.codigoInterno || "—"}</div>
                            {p.sku && <div className="text-muted-foreground">SKU {p.sku}</div>}
                            {p.codigoBarras && <div className="text-muted-foreground">{p.codigoBarras}</div>}
                          </TableCell>
                          <TableCell><TipoBadge tipo={p.tipo} /></TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">{pm(p.costoUnitario, p.moneda)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{pm(p.precioUnitario, p.moneda)}</TableCell>
                          <TableCell className="text-right">
                            <div className={`font-mono text-sm font-semibold ${p.utilidad < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPct(p.margenReal)}</div>
                            <div className="text-xs text-muted-foreground font-mono">{pm(p.utilidad, p.moneda)}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {p.tipo === "servicio" ? <span className="text-muted-foreground/50">—</span> : (
                              <span className={alerta ? "text-red-700 font-bold" : ""}>
                                {formatQty(p.stockActual ?? 0)}
                                <span className="block text-[10px] text-muted-foreground font-sans">{p.unidadMedida || "un"} · {(p.ubicaciones?.length ?? 0) > 0 ? "mín. por bodega" : `mín ${formatQty(p.stockCritico)}`}</span>
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs min-w-[160px]">
                            {p.tipo === "servicio" || (p.ubicaciones ?? []).length === 0 ? <span className="text-muted-foreground/60">{p.tipo === "servicio" ? "—" : "Stock general"}</span> : (
                              <ul className="space-y-0.5">
                                {p.ubicaciones!.map((u) => (
                                  <li key={u.bodegaId} className="flex items-center gap-1.5">
                                    <Warehouse className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="truncate max-w-[150px]">{etiquetaUbicacion(u)}</span>
                                    <span className="font-mono text-muted-foreground">{formatQty(u.stockActual)}</span>
                                    {ubicacionCritica(u) && <span className="rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700" data-testid={`badge-critico-${p.id}-${u.bodegaId}`}>{u.stockActual <= 0 ? "Agotado" : "Crítico"}</span>}
                                  </li>
                                ))}
                              </ul>
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
