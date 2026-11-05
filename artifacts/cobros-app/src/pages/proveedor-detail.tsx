import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetProveedor, getGetProveedorQueryKey, useUpdateProveedor } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProveedorDialog, proveedorAInput } from "@/components/proveedor-dialog";
import { EstadoCompraBadge } from "@/components/estado-compra-badge";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { apiErrorMessage, formatQty } from "@/lib/inventario";
import { invalidateCompras } from "@/lib/compras";
import { Archive, ArchiveRestore, ArrowLeft, Mail, MapPin, Pencil, Phone, Plus, RotateCw, User } from "lucide-react";

export default function ProveedorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useGetProveedor(id, { query: { enabled: !!id, queryKey: getGetProveedorQueryKey(id), staleTime: 0, refetchOnMount: "always" } });
  const actualizar = useUpdateProveedor();
  const [editar, setEditar] = useState(false);
  const [archivar, setArchivar] = useState(false);

  if (q.isLoading) return <div className="max-w-5xl mx-auto space-y-4 animate-pulse"><div className="h-8 w-64 bg-muted rounded" /><div className="grid gap-4 sm:grid-cols-2"><div className="h-28 bg-muted/60 rounded-xl" /><div className="h-28 bg-muted/60 rounded-xl" /></div><div className="h-64 bg-muted/60 rounded-xl" /></div>;
  if (q.isError || !q.data) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <p className="font-medium">No encontramos este proveedor.</p>
        <p className="text-sm text-muted-foreground">{apiErrorMessage(q.error, "")}</p>
        <div className="flex justify-center gap-2"><Button variant="outline" size="sm" onClick={() => q.refetch()}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button><Button asChild size="sm"><Link href="/proveedores">Volver</Link></Button></div>
      </div>
    );
  }
  const p = q.data;

  const toggleActivo = async () => {
    try {
      const res = await actualizar.mutateAsync({ id: p.id, data: proveedorAInput(p, !p.activo) });
      invalidateCompras(qc);
      toast({ title: res.activo ? "Proveedor reactivado" : "Proveedor archivado" });
    } catch (err) { toast({ title: "No se pudo actualizar", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/proveedores" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Volver a proveedores</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary font-mono">{p.rut}{!p.activo && " · Archivado"}</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-proveedor-nombre">{p.razonSocial}</h1>
          {p.giro && <p className="text-sm text-muted-foreground">{p.giro}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setArchivar(true)} disabled={actualizar.isPending} data-testid="button-archivar-proveedor">{p.activo ? <><Archive className="h-4 w-4 mr-1.5" />Archivar</> : <><ArchiveRestore className="h-4 w-4 mr-1.5" />Reactivar</>}</Button>
          <Button variant="outline" size="sm" onClick={() => setEditar(true)} data-testid="button-editar-proveedor"><Pencil className="h-4 w-4 mr-1.5" />Editar</Button>
          {p.activo && <Button asChild size="sm"><Link href="/compras/nueva"><Plus className="h-4 w-4 mr-1.5" />Nueva compra</Link></Button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        {p.contactoNombre && <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{p.contactoNombre}</span>}
        {p.email && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{p.email}</span>}
        {p.telefono && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{p.telefono}</span>}
        {p.direccion && <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{p.direccion}</span>}
      </div>

      {p.totales.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Sin compras recibidas todavía.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {p.totales.map((t) => (
            <div key={t.moneda} className="rounded-xl border bg-card p-4" data-testid={`card-totales-${t.moneda}`}>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Comprado en {t.moneda}</p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Mes actual</p><p className="font-mono text-lg font-semibold">{formatMoney(t.mesActual, t.moneda, t.decimales)}</p></div>
                <div><p className="text-xs text-muted-foreground">Acumulado</p><p className="font-mono text-lg font-semibold text-primary">{formatMoney(t.acumulado, t.moneda, t.decimales)}</p></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Historial de compras</CardTitle></CardHeader>
          <CardContent className="p-0">
            {p.compras.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">Sin facturas registradas.</p> : p.compras.map((c) => (
              <button key={c.id} type="button" onClick={() => navigate(`/compras/${c.id}`)} className="w-full grid grid-cols-[1fr_auto] gap-2 px-5 py-3 border-t text-left text-sm hover:bg-muted/40" data-testid={`row-proveedor-compra-${c.id}`}>
                <span className="flex flex-wrap items-center gap-2"><span className="font-mono font-medium">{c.numeroFactura}</span><span className="text-muted-foreground">{formatDateOnly(c.fechaEmision)}</span><EstadoCompraBadge estado={c.estado} /></span>
                <span className="font-mono font-semibold">{formatMoney(c.total, c.moneda, c.decimales)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Más comprados</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {p.productosMasComprados.length === 0 ? <p className="text-sm text-muted-foreground">Aún sin productos del catálogo.</p> : p.productosMasComprados.map((m, i) => (
              <Link key={m.productoId} href={`/inventario/${m.productoId}/editar`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted" data-testid={`link-mas-comprado-${m.productoId}`}>
                <span className="flex items-center gap-2 min-w-0"><span className="text-xs font-mono text-muted-foreground w-4">{i + 1}</span><span className="truncate">{m.descripcion}</span></span>
                <span className="font-mono text-xs">{formatQty(m.cantidad)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <ProveedorDialog open={editar} onOpenChange={setEditar} proveedor={p} />
      <AlertDialog open={archivar} onOpenChange={setArchivar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{p.activo ? "Archivar proveedor" : "Reactivar proveedor"}</AlertDialogTitle>
            <AlertDialogDescription>{p.activo ? "No aparecerá al ingresar nuevas compras. Su historial se conserva." : "Volverá a estar disponible en nuevas compras."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={toggleActivo} data-testid="button-confirmar-archivar">{p.activo ? "Archivar" : "Reactivar"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
