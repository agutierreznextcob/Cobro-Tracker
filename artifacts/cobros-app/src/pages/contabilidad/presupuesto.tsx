import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, TrendingUp, CheckCircle, ChevronRight, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fmt(n: number | null | undefined) {
  if (!n) return "";
  return Math.abs(n).toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Presupuesto {
  id: number;
  anio: number;
  nombre: string;
  estado: "borrador" | "aprobado" | "cerrado";
  notas: string | null;
  createdAt: string;
}

interface PresupuestoItem {
  id: number;
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  mes: number;
  montoPres: string;
  areaId: number | null;
}

const ESTADO_COLORS: Record<string, string> = {
  borrador: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  aprobado: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cerrado: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

// ═══ DETALLE PRESUPUESTO ═══
function PresupuestoDetalle({ presupuesto, onBack }: { presupuesto: Presupuesto; onBack: () => void }) {
  const qc = useQueryClient();
  const [editCell, setEditCell] = useState<{ itemKey: string; mes: number } | null>(null);
  const [editVal, setEditVal] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["presupuesto-items", presupuesto.id],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/presupuestos/${presupuesto.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      const data = await res.json();
      return data.items as PresupuestoItem[];
    },
  });

  const { data: cuentas = [] } = useQuery({
    queryKey: ["cuentas-hojas"],
    queryFn: async () => {
      const res = await fetch("/api/contabilidad/plan-cuentas/hojas", { credentials: "include" });
      if (!res.ok) return [];
      return res.json() as Promise<any[]>;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { cuentaId: number; mes: number; monto: number }[]) => {
      const res = await fetch(`/api/contabilidad/presupuestos/${presupuesto.id}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ items: data }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["presupuesto-items", presupuesto.id] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const aprobarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/contabilidad/presupuestos/${presupuesto.id}/aprobar`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["presupuestos"] });
      toast({ title: "Presupuesto aprobado" });
      onBack();
    },
  });

  // Build pivot: cuentaId -> mes -> monto
  const pivot: Record<number, Record<number, number>> = {};
  items.forEach((it) => {
    if (!pivot[it.cuentaId]) pivot[it.cuentaId] = {};
    pivot[it.cuentaId][it.mes] = parseFloat(it.montoPres);
  });

  // Unique cuentas in items
  const cuentasEnPres = Array.from(new Set(items.map((i) => i.cuentaId))).map((id) => {
    const item = items.find((i) => i.cuentaId === id)!;
    return { id, codigo: item.cuentaCodigo, nombre: item.cuentaNombre };
  });

  const handleCellEdit = (cuentaId: number, mes: number, currentVal: number | undefined) => {
    if (presupuesto.estado !== "borrador") return;
    setEditCell({ itemKey: `${cuentaId}`, mes });
    setEditVal(currentVal ? String(Math.round(currentVal)) : "");
  };

  const handleCellSave = (cuentaId: number, mes: number) => {
    const monto = parseFloat(editVal.replace(/[^0-9.-]/g, "")) || 0;
    saveMutation.mutate([{ cuentaId, mes, monto }]);
    setEditCell(null);
  };

  const totalPorMes = MESES.map((_, i) => {
    const mes = i + 1;
    return Object.values(pivot).reduce((sum, meses) => sum + (meses[mes] ?? 0), 0);
  });

  const totalGeneral = totalPorMes.reduce((a, b) => a + b, 0);

  const [addCuenta, setAddCuenta] = useState("");
  const handleAddCuenta = () => {
    if (!addCuenta) return;
    const cuenta = cuentas.find((c: any) => String(c.id) === addCuenta);
    if (!cuenta) return;
    // Add with 0 for all months (just save month 1 as 0 to trigger row creation)
    saveMutation.mutate([{ cuentaId: cuenta.id, mes: 1, monto: 0 }]);
    setAddCuenta("");
  };

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
        <div className="flex-1">
          <h2 className="font-semibold text-lg">{presupuesto.nombre}</h2>
          <p className="text-sm text-muted-foreground">Año {presupuesto.anio}</p>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLORS[presupuesto.estado]}`}>
          {presupuesto.estado}
        </span>
        {presupuesto.estado === "borrador" && (
          <Button size="sm" onClick={() => aprobarMutation.mutate()} disabled={aprobarMutation.isPending} className="gap-1.5 bg-green-600 hover:bg-green-700">
            <CheckCircle className="h-4 w-4" />
            Aprobar presupuesto
          </Button>
        )}
      </div>

      {presupuesto.estado === "borrador" && (
        <div className="flex gap-2 items-end">
          <div className="space-y-1 flex-1 max-w-sm">
            <Label className="text-xs">Agregar cuenta al presupuesto</Label>
            <Select value={addCuenta} onValueChange={setAddCuenta}>
              <SelectTrigger><SelectValue placeholder="Selecciona cuenta..." /></SelectTrigger>
              <SelectContent>
                {cuentas.filter((c: any) => !cuentasEnPres.find((cp) => cp.id === c.id)).map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.codigo} — {c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={handleAddCuenta} disabled={!addCuenta}>Agregar</Button>
        </div>
      )}

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground sticky left-0 bg-muted/40 w-48">Cuenta</th>
              {MESES.map((m) => (
                <th key={m} className="text-right py-2.5 px-2 text-xs font-semibold text-muted-foreground w-20">{m}</th>
              ))}
              <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {cuentasEnPres.map((c) => {
              const totalCuenta = Object.values(pivot[c.id] ?? {}).reduce((a, b) => a + b, 0);
              return (
                <tr key={c.id} className="border-b hover:bg-muted/20">
                  <td className="py-1.5 px-3 sticky left-0 bg-background">
                    <div>
                      <span className="font-mono text-xs text-muted-foreground">{c.codigo}</span>
                      <p className="text-xs">{c.nombre}</p>
                    </div>
                  </td>
                  {MESES.map((_, i) => {
                    const mes = i + 1;
                    const val = pivot[c.id]?.[mes];
                    const isEditing = editCell?.itemKey === `${c.id}` && editCell.mes === mes;
                    return (
                      <td key={mes} className="py-1 px-1 text-right" onClick={() => handleCellEdit(c.id, mes, val)}>
                        {isEditing ? (
                          <Input
                            autoFocus
                            className="h-7 text-right text-xs w-20 font-mono"
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onBlur={() => handleCellSave(c.id, mes)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleCellSave(c.id, mes); if (e.key === "Escape") setEditCell(null); }}
                          />
                        ) : (
                          <span className={`inline-block px-1 rounded text-xs font-mono cursor-pointer hover:bg-muted min-w-[60px] text-right ${val ? "text-foreground" : "text-muted-foreground/40"}`}>
                            {val ? fmt(val) : presupuesto.estado === "borrador" ? "—" : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1.5 px-3 text-right font-mono text-xs font-semibold">{fmt(totalCuenta)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 bg-muted/30">
            <tr>
              <td className="py-2 px-3 text-xs font-semibold sticky left-0 bg-muted/30">Total</td>
              {totalPorMes.map((t, i) => (
                <td key={i} className="py-2 px-2 text-right font-mono text-xs font-semibold">{t ? fmt(t) : ""}</td>
              ))}
              <td className="py-2 px-3 text-right font-mono text-xs font-bold text-primary">{fmt(totalGeneral)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {presupuesto.estado === "borrador" && (
        <p className="text-xs text-muted-foreground">Haz clic en cualquier celda para editar el monto presupuestado</p>
      )}
    </div>
  );
}

// ═══ LISTADO PRESUPUESTOS ═══
interface Props { hideHeader?: boolean }

export default function PresupuestoPage({ hideHeader }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Presupuesto | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ anio: new Date().getFullYear(), nombre: "", notas: "" });

  const { data: presupuestos = [], isLoading } = useQuery({
    queryKey: ["presupuestos"],
    queryFn: async () => {
      const res = await fetch("/api/contabilidad/presupuestos", { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<Presupuesto[]>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contabilidad/presupuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al crear");
      }
      return res.json() as Promise<Presupuesto>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["presupuestos"] });
      setModalOpen(false);
      setSelected(data);
      toast({ title: "Presupuesto creado" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  if (selected) {
    const updated = presupuestos.find((p) => p.id === selected.id) ?? selected;
    return (
      <div className="space-y-5">
        {!hideHeader && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
            <h1 className="text-2xl font-bold tracking-tight">Presupuesto</h1>
          </div>
        )}
        <PresupuestoDetalle presupuesto={updated} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Presupuesto</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Planificación financiera por cuenta y mes</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setModalOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo presupuesto
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : presupuestos.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin presupuestos</p>
          <p className="text-sm mt-1">Crea el primer presupuesto para comenzar la planificación financiera</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {presupuestos.map((p) => (
            <div
              key={p.id}
              className="border rounded-lg p-4 hover:bg-muted/30 cursor-pointer transition-colors flex items-center justify-between"
              onClick={() => setSelected(p)}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.nombre}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLORS[p.estado]}`}>
                    {p.estado}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">Año {p.anio}</p>
                {p.notas && <p className="text-xs text-muted-foreground mt-1">{p.notas}</p>}
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo presupuesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Año *</Label>
                <Input type="number" min={2020} max={2099} value={form.anio} onChange={(e) => setForm((f) => ({ ...f, anio: parseInt(e.target.value) }))} />
              </div>
              <div className="col-span-1" />
            </div>
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input placeholder="Ej: Presupuesto 2025" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea rows={2} placeholder="Notas opcionales..." value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.nombre || !form.anio}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
