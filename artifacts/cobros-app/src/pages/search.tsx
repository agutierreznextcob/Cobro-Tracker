import { useState, useMemo, useRef } from "react";
import { useListCobros } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "wouter";
import { Search, X, User, SlidersHorizontal } from "lucide-react";

export default function SearchPage() {
  const { data: cobros, isLoading } = useListCobros();

  const [texto, setTexto] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroResponsable, setFiltroResponsable] = useState("todos");
  const inputRef = useRef<HTMLInputElement>(null);

  const responsablesUnicos = useMemo(() => {
    if (!cobros) return [];
    const seen = new Map<string, string>();
    for (const c of cobros) {
      if (c.responsableId && c.responsableNombre && !seen.has(c.responsableId)) {
        seen.set(c.responsableId, c.responsableNombre);
      }
    }
    return Array.from(seen.entries()).map(([id, nombre]) => ({ id, nombre }));
  }, [cobros]);

  const resultados = useMemo(() => {
    if (!cobros) return [];
    const q = texto.trim().toLowerCase();
    return cobros.filter((c) => {
      const matchTexto =
        !q ||
        c.descripcion.toLowerCase().includes(q) ||
        (c.referencia ?? "").toLowerCase().includes(q) ||
        String(c.id).includes(q);
      const matchEstado = filtroEstado === "todos" || c.estado === filtroEstado;
      const matchResponsable =
        filtroResponsable === "todos" ||
        (filtroResponsable === "sin_asignar" ? !c.responsableId : c.responsableId === filtroResponsable);
      return matchTexto && matchEstado && matchResponsable;
    });
  }, [cobros, texto, filtroEstado, filtroResponsable]);

  const hayFiltros = texto.trim() !== "" || filtroEstado !== "todos" || filtroResponsable !== "todos";

  function limpiar() {
    setTexto("");
    setFiltroEstado("todos");
    setFiltroResponsable("todos");
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Buscar cobros</h1>
        <p className="text-muted-foreground mt-1">
          Busca por descripción, referencia o ID — combina con los filtros para afinar resultados.
        </p>
      </div>

      {/* Search + filters bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Descripción, referencia o #ID…"
            className="pl-9 pr-9 h-9"
            autoFocus
          />
          {texto && (
            <button
              onClick={() => setTexto("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />

          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="h-9 text-sm w-[145px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="pagado">Pagado</SelectItem>
              <SelectItem value="fallido">Fallido</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filtroResponsable} onValueChange={setFiltroResponsable}>
            <SelectTrigger className="h-9 text-sm w-[170px] gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Responsable" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los responsables</SelectItem>
              {responsablesUnicos.map(({ id, nombre }) => (
                <SelectItem key={id} value={id}>{nombre}</SelectItem>
              ))}
              {cobros?.some(c => !c.responsableId) && (
                <SelectItem value="sin_asignar">Sin asignar</SelectItem>
              )}
            </SelectContent>
          </Select>

          {hayFiltros && (
            <button
              onClick={limpiar}
              className="h-9 px-3 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      {!isLoading && (
        <p className="text-sm text-muted-foreground -mt-2">
          {hayFiltros
            ? `${resultados.length} resultado${resultados.length !== 1 ? "s" : ""} encontrado${resultados.length !== 1 ? "s" : ""}`
            : `${cobros?.length ?? 0} cobros en total`}
        </p>
      )}

      {/* Results table */}
      <Card className="shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12">#</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead>Responsable</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Monto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5].map(i => (
                <TableRow key={i} className="animate-pulse">
                  {[1, 2, 3, 4, 5, 6, 7].map(j => (
                    <TableCell key={j}><div className="h-4 bg-muted rounded w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : resultados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Search className="h-8 w-8 opacity-30" />
                    <p className="text-sm font-medium">
                      {hayFiltros
                        ? "Ningún cobro coincide con la búsqueda."
                        : "Sin cobros registrados aún."}
                    </p>
                    {hayFiltros && (
                      <button onClick={limpiar} className="text-xs text-primary hover:underline mt-1">
                        Limpiar búsqueda
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              resultados.map((cobro) => {
                const q = texto.trim().toLowerCase();
                const highlight = (str: string) => {
                  if (!q || !str.toLowerCase().includes(q)) return <>{str}</>;
                  const idx = str.toLowerCase().indexOf(q);
                  return (
                    <>
                      {str.slice(0, idx)}
                      <mark className="bg-yellow-100 dark:bg-yellow-900/40 text-inherit rounded-sm px-0.5">
                        {str.slice(idx, idx + q.length)}
                      </mark>
                      {str.slice(idx + q.length)}
                    </>
                  );
                };

                return (
                  <TableRow key={cobro.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground text-sm font-mono">
                      {cobro.id}
                    </TableCell>
                    <TableCell>
                      <Link href={`/cobros/${cobro.id}`} className="font-medium hover:underline text-foreground">
                        {highlight(cobro.descripcion)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {cobro.referencia ? highlight(cobro.referencia) : <span className="opacity-40">—</span>}
                    </TableCell>
                    <TableCell>
                      {cobro.responsableNombre ? (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-semibold shrink-0">
                            {cobro.responsableNombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <span className="truncate max-w-[100px]">{cobro.responsableNombre}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={cobro.estado} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatShortDate(cobro.creadoEn)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatCurrency(cobro.monto)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {resultados.length > 0 && (
          <div className="px-4 py-2 border-t text-xs text-muted-foreground text-right">
            {resultados.length} resultado{resultados.length !== 1 ? "s" : ""}
          </div>
        )}
      </Card>
    </div>
  );
}
