import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateProducto, type Bodega, type Producto } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage, invalidateInventario, UNIDADES_PRODUCTO, capitalizar, CODIGO_RE } from "@/lib/inventario";
import type { Moneda } from "@/lib/format";
import { Loader2 } from "lucide-react";

/** Physical products only (services need tariff data; pick existing services from the catalog). Quick product creation from a scanned unknown code. Stock is never set here: it enters only when the purchase is received. */
export function ProductoRapidoDialog({ open, onOpenChange, codigo, moneda, onCreated, bodegas, bodegaSugerida }: {
  open: boolean; onOpenChange: (o: boolean) => void; codigo: string; moneda: Moneda; onCreated: (p: Producto) => void;
  bodegas: Bodega[]; bodegaSugerida?: string;
}) {
  const qc = useQueryClient();
  const crear = useCreateProducto();
  const [nombre, setNombre] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [codigoBarras, setCodigoBarras] = useState("");
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState("");
  const [unidad, setUnidad] = useState("unidad");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setNombre(""); setBodegaId(bodegaSugerida && bodegas.some((b) => String(b.id) === bodegaSugerida) ? bodegaSugerida : bodegas.length === 1 ? String(bodegas[0].id) : ""); setCodigoBarras(codigo); setCosto(""); setPrecio(""); setUnidad("unidad"); setError(null); }
  }, [open, codigo]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!nombre.trim()) { setError("Ingresa el nombre."); return; }
    if (!CODIGO_RE.test(codigoBarras)) { setError("El código solo admite letras, números y guiones."); return; }
    const c = Number(costo), p = Number(precio || 0);
    if (costo.trim() === "" || !(c >= 0)) { setError("Ingresa un costo válido."); return; }
    if (!(p >= 0)) { setError("Precio de venta inválido."); return; }
    if (bodegas.length > 0 && !bodegas.some((b) => String(b.id) === bodegaId)) { setError("Elige la bodega del producto."); return; }
    setError(null);
    try {
      const prod = await crear.mutateAsync({ data: { nombre: nombre.trim(), tipo: "producto", moneda, bodegaId: bodegaId ? Number(bodegaId) : null, codigoBarras: codigoBarras.trim() || undefined, costoUnitario: c, precioUnitario: p, unidadMedida: unidad, activo: true, stockActual: 0 } });
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
            <div className="space-y-1.5"><Label>Bodega *</Label>
              <Select value={bodegaId} onValueChange={setBodegaId} disabled={bodegas.length === 0}>
                <SelectTrigger data-testid="select-rapido-bodega"><SelectValue placeholder={bodegas.length === 0 ? "Sin bodegas activas" : "Elegir bodega"} /></SelectTrigger>
                <SelectContent>{bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.localNombre} → {b.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Unidad</Label>
              <Select value={unidad} onValueChange={setUnidad}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNIDADES_PRODUCTO.map((u) => <SelectItem key={u} value={u}>{capitalizar(u)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Código de barras</Label><Input value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value)} className="font-mono" data-testid="input-rapido-codigo" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Costo ({moneda}) *</Label><Input type="number" min="0" step="any" value={costo} onChange={(e) => setCosto(e.target.value)} className="font-mono" data-testid="input-rapido-costo" /></div>
            <div className="space-y-1.5"><Label>Precio venta ({moneda})</Label><Input type="number" min="0" step="any" value={precio} onChange={(e) => setPrecio(e.target.value)} className="font-mono" data-testid="input-rapido-precio" /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">Se crea como producto físico con stock 0 en la bodega elegida. Para servicios, créalos desde Inventario.</p>
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
