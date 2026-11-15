import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetBodega, getGetBodegaQueryKey, useUpdateStockCriticoBodega, useUpdateBodega, useDeleteBodega, getListBodegasQueryKey, getListLocalesQueryKey, type Producto } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorMessage, formatQty, invalidateInventario } from "@/lib/inventario";
import { ArrowLeft, ArrowLeftRight, Check, Loader2, Pencil, RotateCw, Store, Trash2, Warehouse } from "lucide-react";

function stockEnBodega(p: Producto, bodegaId: number) {
  const u = (p.ubicaciones ?? []).find((x) => x.bodegaId === bodegaId);
  return { stock: u?.stockActual ?? p.stockActual ?? 0, critico: u?.stockCritico ?? p.stockCritico ?? 0 };
}

function CriticoEditor({ bodegaId, producto, actual }: { bodegaId: number; producto: Producto; actual: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [valor, setValor] = useState(String(actual));
  const upd = useUpdateStockCriticoBodega();
  const n = valor.trim() === "" ? NaN : Number(valor);
  const cambiado = !Number.isNaN(n) && n !== actual;
  const save = () => {
    if (Number.isNaN(n) || n < 0) { toast({ title: "Valor inválido", variant: "destructive" }); return; }
    upd.mutate({ id: bodegaId, productoId: producto.id, data: { stockCritico: n } }, {
      onSuccess: () => { invalidateInventario(qc, producto.id); toast({ title: "Stock crítico actualizado", description: producto.nombre }); },
      onError: (err) => toast({ title: "No se pudo guardar", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }),
    });
  };
  return (
    <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Input type="number" min="0" step="any" value={valor} onChange={(e) => setValor(e.target.value)} className="h-8 w-24 font-mono text-right" data-testid={`input-critico-${producto.id}`} />
      <Button type="submit" size="icon" variant={cambiado ? "default" : "ghost"} className="h-8 w-8" disabled={!cambiado || upd.isPending} aria-label="Guardar" data-testid={`button-guardar-critico-${producto.id}`}>
        {upd.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </Button>
    </form>
  );
}

export default function BodegaDetailPage() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: bodega, isLoading, isError, refetch } = useGetBodega(id, { query: { enabled: !!id, queryKey: getGetBodegaQueryKey(id), staleTime: 0, refetchOnMount: "always", refetchInterval: 30000 } });
  const updateBodega = useUpdateBodega();
  const deleteBodega = useDeleteBodega();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editNombre, setEditNombre] = useState("");
  const [editDescripcion, setEditDescripcion] = useState("");

  if (isLoading) return <div className="max-w-7xl mx-auto space-y-4 animate-pulse"><div className="h-8 w-60 bg-muted rounded" /><div className="h-64 bg-muted/60 rounded-xl" /></div>;
  if (isError || !bodega) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos esta bodega.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
          <Button asChild size="sm"><Link href="/locales">Volver</Link></Button>
        </div>
      </div>
    );
  }

  const productos = bodega.productos.filter((p) => p.tipo === "producto").sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const criticos = productos.filter((p) => { const s = stockEnBodega(p, id); return s.stock <= s.critico; }).length;

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href={`/locales/${bodega.localId}`} className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Volver a {bodega.localNombre}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground flex items-center gap-1"><Store className="h-3.5 w-3.5" />{bodega.localNombre}</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><Warehouse className="h-6 w-6 text-primary" />{bodega.nombre}</h1>
          {bodega.descripcion && <p className="text-muted-foreground mt-1 text-sm">{bodega.descripcion}</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => { setEditNombre(bodega.nombre); setEditDescripcion(bodega.descripcion ?? ""); setEditOpen(true); }}>
            <Pencil className="h-4 w-4 mr-1.5" />Editar
          </Button>
          <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4 mr-1.5" />Eliminar
          </Button>
          <div className="rounded-xl border bg-card px-4 py-2"><p className="text-[11px] uppercase tracking-wider text-muted-foreground">Productos</p><p className="font-mono text-xl font-bold">{productos.length}</p></div>
          <div className={`rounded-xl border px-4 py-2 ${criticos > 0 ? "border-red-300 bg-red-50 text-red-700" : "bg-card"}`}><p className="text-[11px] uppercase tracking-wider opacity-80">En crítico</p><p className="font-mono text-xl font-bold">{criticos}</p></div>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Editar bodega</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={editNombre} onChange={e => setEditNombre(e.target.value)} placeholder="Nombre de la bodega" />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción (opcional)</Label>
              <Input value={editDescripcion} onChange={e => setEditDescripcion(e.target.value)} placeholder="Descripción" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancelar</Button>
              <Button size="sm" disabled={updateBodega.isPending || !editNombre.trim()} onClick={() => {
                updateBodega.mutate({ id, nombre: editNombre.trim(), descripcion: editDescripcion.trim() || undefined }, {
                  onSuccess: () => {
                    toast({ title: "Bodega actualizada" });
                    qc.invalidateQueries({ queryKey: getGetBodegaQueryKey(id) });
                    qc.invalidateQueries({ queryKey: getListBodegasQueryKey() });
                    qc.invalidateQueries({ queryKey: getListLocalesQueryKey() });
                    setEditOpen(false);
                  },
                  onError: () => toast({ title: "Error", description: "No se pudo actualizar la bodega.", variant: "destructive" }),
                });
              }}>
                {updateBodega.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Eliminar bodega</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">¿Estás seguro que deseas eliminar <strong>{bodega.nombre}</strong>? La bodega debe tener stock en cero para poder eliminarse. Esta acción no se puede deshacer.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="destructive" size="sm" disabled={deleteBodega.isPending} onClick={() => {
              deleteBodega.mutate(id, {
                onSuccess: () => { toast({ title: "Bodega eliminada" }); setLocation(`/locales/${bodega.localId}`); },
                onError: (err: unknown) => {
                  const msg = (err as { data?: { error?: string } })?.data?.error ?? "No se pudo eliminar la bodega.";
                  toast({ title: "Error", description: msg, variant: "destructive" });
                  setConfirmDelete(false);
                },
              });
            }}>
              {deleteBodega.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="shadow-sm overflow-hidden">
        {productos.length === 0 ? (
          <div className="py-14 text-center space-y-2">
            <Warehouse className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Esta bodega aún no tiene stock. Registra una entrada desde el inventario.</p>
            <Button asChild size="sm" variant="outline"><Link href="/inventario">Ir al inventario</Link></Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Producto</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Stock en esta bodega</TableHead>
                  <TableHead className="text-right">Stock crítico (bodega)</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productos.map((p) => {
                  const s = stockEnBodega(p, id);
                  const alerta = s.stock <= s.critico;
                  return (
                    <TableRow key={p.id} className={alerta ? "bg-red-50/50" : ""} data-testid={`row-bodega-producto-${p.id}`}>
                      <TableCell><Link href={`/inventario/${p.id}/editar`} className="font-medium hover:underline">{p.nombre}</Link></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.codigoInterno || "—"}</TableCell>
                      <TableCell className={`text-right font-mono ${alerta ? "text-red-700 font-bold" : ""}`}>
                        {formatQty(s.stock)} <span className="text-[10px] text-muted-foreground font-sans">{p.unidadMedida || "unidad"}</span>
                        {alerta && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-sans font-semibold text-red-700">{s.stock <= 0 ? "Agotado" : "Crítico"}</span>}
                      </TableCell>
                      <TableCell className="text-right"><CriticoEditor key={`${p.id}-${s.critico}`} bodegaId={id} producto={p} actual={s.critico} /></TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="h-8 px-2"><Link href={`/inventario/${p.id}/movimiento`}><ArrowLeftRight className="h-3.5 w-3.5 mr-1" />Mover</Link></Button>
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
