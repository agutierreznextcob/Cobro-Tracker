import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateBodega, useListLocales, getListLocalesQueryKey, useListBodegas, getListBodegasQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiErrorMessage, invalidateInventario } from "@/lib/inventario";
import { ArrowLeft, Info, Loader2 } from "lucide-react";

export default function BodegaNuevaPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const locales = useListLocales({ query: { queryKey: getListLocalesQueryKey(), staleTime: 0, refetchOnMount: "always" } });
  const bodegas = useListBodegas({ query: { queryKey: getListBodegasQueryKey(), staleTime: 0, refetchOnMount: "always" } });
  const [localId, setLocalId] = useState(() => new URLSearchParams(window.location.search).get("localId") ?? "");
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const crear = useCreateBodega();
  const esPrimera = bodegas.isSuccess && (bodegas.data ?? []).length === 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localId) { toast({ title: "Elige un local", variant: "destructive" }); return; }
    if (!nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return; }
    crear.mutate({ data: { nombre: nombre.trim(), localId: Number(localId), descripcion: descripcion.trim() || undefined } }, {
      onSuccess: (b) => { invalidateInventario(qc); toast({ title: "Bodega creada" }); setLocation(`/bodegas/${b.id}`); },
      onError: (err) => toast({ title: "No se pudo crear", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }),
    });
  };

  return (
    <div className="max-w-xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/locales" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Volver a locales</Link>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Nueva bodega</CardTitle>
          <CardDescription>Cada bodega lleva su propio stock y umbral crítico por producto.</CardDescription>
        </CardHeader>
        <CardContent>
          {esPrimera && (
            <div className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="text-primera-bodega">
              <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p>Esta será tu primera bodega. Todo el stock general que tienes hoy se asignará a ella automáticamente, con sus mismos umbrales críticos. No se borra ningún dato ni movimiento; después podrás repartirlo con "Movimiento entre bodegas".</p>
            </div>
          )}
          {locales.isLoading ? (
            <div className="space-y-3 animate-pulse"><div className="h-10 bg-muted rounded" /><div className="h-10 bg-muted rounded" /></div>
          ) : locales.isError ? (
            <div className="text-center py-6 space-y-2"><p className="text-sm">No se pudieron cargar los locales.</p><Button size="sm" variant="outline" onClick={() => locales.refetch()}>Reintentar</Button></div>
          ) : (locales.data ?? []).length === 0 ? (
            <div className="text-center py-6 space-y-2">
              <p className="text-sm text-muted-foreground">Primero necesitas un local para ubicar la bodega.</p>
              <Button asChild size="sm"><Link href="/locales/nuevo">Crear local</Link></Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Local</Label>
                <Select value={localId} onValueChange={setLocalId}>
                  <SelectTrigger data-testid="select-bodega-local"><SelectValue placeholder="Selecciona un local" /></SelectTrigger>
                  <SelectContent>{locales.data!.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Nombre</Label><Input value={nombre} maxLength={200} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Bodega trasera" data-testid="input-bodega-nombre" /></div>
              <div className="space-y-1.5"><Label>Descripción (opcional)</Label><Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="resize-none h-20" data-testid="input-bodega-descripcion" /></div>
              <Button type="submit" className="w-full" disabled={crear.isPending} data-testid="button-crear-bodega">
                {crear.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creando...</> : "Crear bodega"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
