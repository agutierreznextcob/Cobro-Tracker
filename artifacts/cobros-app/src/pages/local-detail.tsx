import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useGetLocal, getGetLocalQueryKey, useListInventario, getListInventarioQueryKey, useUpdateLocal, useDeleteLocal, getListLocalesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatQty } from "@/lib/inventario";
import { AlertTriangle, ArrowLeft, ChevronRight, Loader2, MapPin, Pencil, Plus, RotateCw, Store, Trash2, Warehouse } from "lucide-react";

export default function LocalDetailPage() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: local, isLoading, isError, refetch } = useGetLocal(id, { query: { enabled: !!id, queryKey: getGetLocalQueryKey(id), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const { data: productos } = useListInventario({ query: { queryKey: getListInventarioQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const updateLocal = useUpdateLocal();
  const deleteLocal = useDeleteLocal();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editNombre, setEditNombre] = useState("");
  const [editDireccion, setEditDireccion] = useState("");

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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setEditNombre(local.nombre); setEditDireccion(local.direccion ?? ""); setEditOpen(true); }}>
            <Pencil className="h-4 w-4 mr-1.5" />Editar
          </Button>
          <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4 mr-1.5" />Eliminar
          </Button>
          <Button asChild><Link href={`/bodegas/nueva?localId=${local.id}`} data-testid="link-agregar-bodega"><Plus className="h-4 w-4 mr-1.5" />Agregar bodega</Link></Button>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Editar local</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={editNombre} onChange={e => setEditNombre(e.target.value)} placeholder="Nombre del local" />
            </div>
            <div className="space-y-1.5">
              <Label>Dirección (opcional)</Label>
              <Input value={editDireccion} onChange={e => setEditDireccion(e.target.value)} placeholder="Dirección" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancelar</Button>
              <Button size="sm" disabled={updateLocal.isPending || !editNombre.trim()} onClick={() => {
                updateLocal.mutate({ id, nombre: editNombre.trim(), direccion: editDireccion.trim() || undefined }, {
                  onSuccess: () => { toast({ title: "Local actualizado" }); qc.invalidateQueries({ queryKey: getListLocalesQueryKey() }); qc.invalidateQueries({ queryKey: getGetLocalQueryKey(id) }); setEditOpen(false); },
                  onError: () => toast({ title: "Error", description: "No se pudo actualizar el local.", variant: "destructive" }),
                });
              }}>
                {updateLocal.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Eliminar local</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">¿Estás seguro que deseas eliminar <strong>{local.nombre}</strong>? Debes eliminar primero todas sus bodegas. Esta acción no se puede deshacer.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="destructive" size="sm" disabled={deleteLocal.isPending} onClick={() => {
              deleteLocal.mutate(id, {
                onSuccess: () => { toast({ title: "Local eliminado" }); setLocation("/locales"); },
                onError: (err: unknown) => {
                  const msg = (err as { data?: { error?: string } })?.data?.error ?? "No se pudo eliminar el local.";
                  toast({ title: "Error", description: msg, variant: "destructive" });
                  setConfirmDelete(false);
                },
              });
            }}>
              {deleteLocal.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
