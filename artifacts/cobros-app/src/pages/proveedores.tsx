import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListProveedores, getListProveedoresQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/inventario";
import { Building2, Mail, Phone, Plus, RotateCw, Search } from "lucide-react";

export default function ProveedoresPage() {
  const [, navigate] = useLocation();
  const [busqueda, setBusqueda] = useState("");
  const [archivados, setArchivados] = useState(false);
  const q = useListProveedores({ query: { queryKey: getListProveedoresQueryKey(), staleTime: 0, refetchOnMount: "always" } });

  const lista = useMemo(() => {
    const s = busqueda.trim().toLowerCase();
    return (q.data ?? []).filter((p) => p.activo !== archivados)
      .filter((p) => !s || `${p.razonSocial} ${p.rut} ${p.contactoNombre ?? ""} ${p.giro ?? ""}`.toLowerCase().includes(s));
  }, [q.data, busqueda, archivados]);

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Proveedores</h1>
          <p className="text-sm text-muted-foreground">Quienes te venden: RUT, contacto e historial de facturas.</p>
        </div>
        <Button asChild data-testid="button-nuevo-proveedor"><Link href="/proveedores/nuevo"><Plus className="h-4 w-4 mr-1.5" />Nuevo proveedor</Link></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por razón social, RUT o contacto" className="pl-9" data-testid="input-buscar-proveedor" /></div>
        <div className="inline-flex rounded-md border p-0.5 text-sm">
          {[false, true].map((a) => <button key={String(a)} type="button" onClick={() => setArchivados(a)} className={`px-3 py-1.5 rounded ${archivados === a ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} data-testid={`tab-proveedores-${a ? "archivados" : "activos"}`}>{a ? "Archivados" : "Activos"}</button>)}
        </div>
      </div>
      {q.isLoading ? <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted/60 animate-pulse" />)}</div>
        : q.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-2">
            <p className="text-sm text-red-800">{apiErrorMessage(q.error, "No se pudieron cargar los proveedores.")}</p>
            <Button size="sm" variant="outline" onClick={() => q.refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          </div>
        ) : lista.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 grid place-items-center"><Building2 className="h-6 w-6 text-primary" /></div>
            <p className="font-medium">{busqueda ? "Sin coincidencias." : archivados ? "No hay proveedores archivados." : "Aún no tienes proveedores."}</p>
            {!busqueda && !archivados && <Button asChild size="sm"><Link href="/proveedores/nuevo"><Plus className="h-4 w-4 mr-1.5" />Agregar el primero</Link></Button>}
          </div>
        ) : (
          <div className="rounded-xl border bg-card divide-y">
            {lista.map((p) => (
              <button key={p.id} type="button" onClick={() => navigate(`/proveedores/${p.id}`)} className="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors" data-testid={`row-proveedor-${p.id}`}>
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.razonSocial}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-mono">{p.rut}</span>{p.giro ? ` · ${p.giro}` : ""}</p>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                  {p.contactoNombre && <span>{p.contactoNombre}</span>}
                  {p.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{p.email}</span>}
                  {p.telefono && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{p.telefono}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
