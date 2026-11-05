import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateProveedor, useUpdateProveedor, type Proveedor, type ProveedorInput } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/inventario";
import { invalidateCompras } from "@/lib/compras";
import { Loader2 } from "lucide-react";

export const proveedorAInput = (p: Proveedor, activo = p.activo): ProveedorInput => ({
  razonSocial: p.razonSocial, rut: p.rut, giro: p.giro ?? "", direccion: p.direccion ?? "", email: p.email ?? "",
  telefono: p.telefono ?? "", contactoNombre: p.contactoNombre ?? "", activo,
});

const VACIO: ProveedorInput = { razonSocial: "", rut: "", giro: "", direccion: "", email: "", telefono: "", contactoNombre: "", activo: true };

export function ProveedorFields({ value, onChange }: { value: ProveedorInput; onChange: (v: ProveedorInput) => void }) {
  const f = (k: keyof ProveedorInput, label: string, extra?: { type?: string; placeholder?: string; full?: boolean; mono?: boolean }) => (
    <div className={`space-y-1.5 ${extra?.full ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={`prov-${k}`}>{label}</Label>
      <Input id={`prov-${k}`} type={extra?.type ?? "text"} placeholder={extra?.placeholder} className={extra?.mono ? "font-mono" : ""}
        value={(value[k] as string) ?? ""} onChange={(e) => onChange({ ...value, [k]: e.target.value })} data-testid={`input-proveedor-${k}`} />
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {f("razonSocial", "Razón social *", { full: true, placeholder: "Distribuidora Los Andes SpA" })}
      {f("rut", "RUT *", { placeholder: "76.123.456-7", mono: true })}
      {f("giro", "Giro")}
      {f("direccion", "Dirección", { full: true })}
      {f("email", "Email", { type: "email" })}
      {f("telefono", "Teléfono")}
      {f("contactoNombre", "Persona de contacto", { full: true })}
    </div>
  );
}

export function validarProveedor(v: ProveedorInput): string | null {
  if (!v.razonSocial.trim()) return "Ingresa la razón social.";
  if (!v.rut.trim()) return "Ingresa el RUT del proveedor.";
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email.trim())) return "El email no es válido.";
  return null;
}

export const limpiarProveedor = (v: ProveedorInput): ProveedorInput => ({
  ...v, razonSocial: v.razonSocial.trim(), rut: v.rut.trim(), giro: v.giro?.trim(), direccion: v.direccion?.trim(),
  email: v.email?.trim(), telefono: v.telefono?.trim(), contactoNombre: v.contactoNombre?.trim(),
});

/** Create (no proveedor) or edit (proveedor given) a supplier. */
export function ProveedorDialog({ open, onOpenChange, proveedor, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; proveedor?: Proveedor; onSaved?: (p: Proveedor) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const crear = useCreateProveedor();
  const actualizar = useUpdateProveedor();
  const [v, setV] = useState<ProveedorInput>(VACIO);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setV(proveedor ? proveedorAInput(proveedor) : VACIO); setError(null); } }, [open, proveedor]);

  const pending = crear.isPending || actualizar.isPending;
  const submit = async () => {
    const e = validarProveedor(v);
    if (e) { setError(e); return; }
    setError(null);
    try {
      const data = limpiarProveedor(v);
      const res = proveedor ? await actualizar.mutateAsync({ id: proveedor.id, data }) : await crear.mutateAsync({ data });
      invalidateCompras(qc);
      toast({ title: proveedor ? "Proveedor actualizado" : "Proveedor creado", description: res.razonSocial });
      onSaved?.(res);
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo guardar el proveedor."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{proveedor ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          <DialogDescription>Los datos tributarios quedan asociados a cada factura de compra.</DialogDescription>
        </DialogHeader>
        <ProveedorFields value={v} onChange={setV} />
        {error && <p className="text-sm text-red-600" data-testid="text-proveedor-error">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={pending} data-testid="button-guardar-proveedor">
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{proveedor ? "Guardar cambios" : "Crear proveedor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
