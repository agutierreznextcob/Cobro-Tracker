import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateProveedor, type ProveedorInput } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProveedorFields, limpiarProveedor, validarProveedor } from "@/components/proveedor-dialog";
import { apiErrorMessage } from "@/lib/inventario";
import { invalidateCompras } from "@/lib/compras";
import { ArrowLeft, Loader2, Save } from "lucide-react";

export default function ProveedorNuevoPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const crear = useCreateProveedor();
  const [v, setV] = useState<ProveedorInput>({ razonSocial: "", rut: "", giro: "", direccion: "", email: "", telefono: "", contactoNombre: "", activo: true });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const e = validarProveedor(v);
    if (e) { setError(e); return; }
    setError(null);
    try {
      const p = await crear.mutateAsync({ data: limpiarProveedor(v) });
      invalidateCompras(qc);
      toast({ title: "Proveedor creado", description: p.razonSocial });
      navigate(`/proveedores/${p.id}`);
    } catch (err) { setError(apiErrorMessage(err, "No se pudo crear el proveedor.")); }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-in fade-in duration-300">
      <Link href="/proveedores" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Volver a proveedores</Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Nuevo proveedor</h1>
      <Card className="shadow-sm"><CardContent className="p-5 space-y-4">
        <ProveedorFields value={v} onChange={setV} />
        {error && <p className="text-sm text-red-600" data-testid="text-proveedor-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button asChild variant="ghost"><Link href="/proveedores">Cancelar</Link></Button>
          <Button onClick={submit} disabled={crear.isPending} data-testid="button-crear-proveedor">{crear.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Crear proveedor</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}
