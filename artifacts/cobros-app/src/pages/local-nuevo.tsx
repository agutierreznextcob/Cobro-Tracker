import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateLocal } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiErrorMessage, invalidateInventario } from "@/lib/inventario";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function LocalNuevoPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const crear = useCreateLocal({
    mutation: {
      onSuccess: (l) => { invalidateInventario(qc); toast({ title: "Local creado", description: "Ahora agrega su primera bodega." }); setLocation(`/locales/${l.id}`); },
      onError: (err) => toast({ title: "No se pudo crear", description: apiErrorMessage(err, "Intenta nuevamente."), variant: "destructive" }),
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return; }
    crear.mutate({ data: { nombre: nombre.trim(), direccion: direccion.trim() || undefined } });
  };

  return (
    <div className="max-w-xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/locales" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Volver a locales</Link>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Nuevo local</CardTitle>
          <CardDescription>Una tienda, sucursal o centro de distribución. Las bodegas se crean dentro de un local.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5"><Label>Nombre</Label><Input value={nombre} maxLength={200} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Sucursal Providencia" data-testid="input-local-nombre" /></div>
            <div className="space-y-1.5"><Label>Dirección (opcional)</Label><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Av. Providencia 1234, Santiago" data-testid="input-local-direccion" /></div>
            <Button type="submit" className="w-full" disabled={crear.isPending} data-testid="button-crear-local">
              {crear.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creando...</> : "Crear local"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
