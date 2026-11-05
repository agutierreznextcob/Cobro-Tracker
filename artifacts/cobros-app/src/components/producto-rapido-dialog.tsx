import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateProducto, type Producto } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage, invalidateInventario, unidadesPara, capitalizar, CODIGO_RE } from "@/lib/inventario";
import type { Moneda } from "@/lib/format";
import { Loader2 } from "lucide-react";

/** Quick product creation from a scanned unknown code. Stock is never set here: it enters only when the purchase is received. */
export function ProductoRapidoDialog({ open, onOpenChange, codigo, moneda, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; codigo: string; moneda: Moneda; onCreated: (p: Producto) => void;
}) {
  const qc = useQueryClient();
  const crear = useCreateProducto();
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"producto" | "servicio">("producto");
  const [codigoBarras, setCodigoBarras] = useState("");
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState("");
  const [unidad, setUnidad] = useState("unidad");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setNombre(""); setTipo("producto"); setCodigoBarras(codigo); setCosto(""); setPrecio(""); setUnidad("unidad"); setError(null); }
  }, [open, codigo]);

  const submit = async () => {
    if (!nombre.trim()) { setError("Ingresa el nombre."); return; }
    if (!CODIGO_RE.test(codigoBarras)) { setError("El código solo admite letras, números y guiones."); return; }
    const c = Number(costo), p = Number(precio || 0);
    if (costo.trim() === "" || !(c >= 0)) { setError("Ingresa un costo válido."); return; }
    if (!(p >= 0)) { setError("Precio de venta inválido."); return; }
    setError(null);
    try {
      const prod = await crear.mutateAsync({ data: { nombre: nombre.trim(), tipo, moneda, codigoBarras: codigoBarras.trim() || undefined, costoUnitario: c, precioUnitario: p, unidadMedida: unidad, activo: true, stockActual: tipo === "producto" ? 0 : null } });
      invalidateInventario(qc);
      onCreated(prod);
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo crear el producto."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Producto no encontrado</DialogTitle>
          <DialogDescription>Créalo ahora con sus datos básicos. Se crea con stock 0; el stock entra solo al confirmar la recepción.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} data-testid="input-rapido-nombre" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => { const t = v as "producto" | "servicio"; setTipo(t); setUnidad(unidadesPara(t)[0]); }}>
                <SelectTrigger data-testid="select-rapido-tipo"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="producto">Producto físico</SelectItem><SelectItem value="servicio">Servicio</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Unidad</Label>
              <Select value={unidad} onValueChange={setUnidad}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{unidadesPara(tipo).map((u) => <SelectItem key={u} value={u}>{capitalizar(u)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Código de barras</Label><Input value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value)} className="font-mono" data-testid="input-rapido-codigo" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Costo ({moneda}) *</Label><Input type="number" min="0" step="any" value={costo} onChange={(e) => setCosto(e.target.value)} className="font-mono" data-testid="input-rapido-costo" /></div>
            <div className="space-y-1.5"><Label>Precio venta ({moneda})</Label><Input type="number" min="0" step="any" value={precio} onChange={(e) => setPrecio(e.target.value)} className="font-mono" data-testid="input-rapido-precio" /></div>
          </div>
          {tipo === "servicio" && <p className="text-xs text-amber-700">Los servicios no suman stock al recibir la compra.</p>}
          {error && <p className="text-sm text-red-600" data-testid="text-rapido-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={crear.isPending} data-testid="button-crear-rapido">{crear.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Crear y agregar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
