import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Loader2, BookOpen, Trash2, CheckCircle, XCircle, Eye } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Cuenta {
  id: number; codigo: string; nombre: string; tipo: string; naturaleza: string;
}

interface AsientoLinea {
  id?: number;
  cuentaId: number; cuentaCodigo: string; cuentaNombre: string;
  debe: string; haber: string; descripcion: string; orden: number;
}

interface Asiento {
  id: number; numero: string; fecha: string; periodo: string;
  descripcion: string; estado: "borrador" | "contabilizado" | "anulado";
  origen: string; moneda: string; notas: string | null;
  lineas?: AsientoLinea[];
}

const ESTADO_COLORS: Record<string, string> = {
  borrador: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  contabilizado: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  anulado: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const ESTADO_LABELS: Record<string, string> = {
  borrador: "Borrador", contabilizado: "Contabilizado", anulado: "Anulado",
};

const currentYear = new Date().getFullYear();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");

function periodoToStr(periodo: string) {
  if (!periodo || periodo.length !== 6) return periodo;
  return `${periodo.substring(4, 6)}/${periodo.substring(0, 4)}`;
}

async function fetchAsientos(params: Record<string, string>): Promise<Asiento[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/contabilidad/asientos?${qs}`, { credentials: "include" });
  if (!res.ok) throw new Error("Error al cargar asientos");
  return res.json();
}

async function fetchCuentasHojas(): Promise<Cuenta[]> {
  const res = await fetch("/api/contabilidad/plan-cuentas/hojas", { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

interface Props { hideHeader?: boolean }

export default function AsientosContablesPage({ hideHeader }: Props) {
  const qc = useQueryClient();
  const [filtros, setFiltros] = useState({ periodo: `${currentYear}${currentMonth}`, estado: "" });
  const [modalOpen, setModalOpen] = useState(false);
  const [detailAsiento, setDetailAsiento] = useState<Asiento | null>(null);

  const [form, setForm] = useState({
    fecha: new Date().toISOString().split("T")[0],
    periodo: `${currentYear}${currentMonth}`,
    descripcion: "",
    origen: "manual" as const,
    moneda: "CLP",
    notas: "",
  });

  const [lineas, setLineas] = useState<Omit<AsientoLinea, "id">[]>([
    { cuentaId: 0, cuentaCodigo: "", cuentaNombre: "", debe: "0", haber: "0", descripcion: "", orden: 0 },
    { cuentaId: 0, cuentaCodigo: "", cuentaNombre: "", debe: "0", haber: "0", descripcion: "", orden: 1 },
  ]);

  const params = { periodo: filtros.periodo, ...(filtros.estado ? { estado: filtros.estado } : {}) };
  const { data: asientos = [], isLoading } = useQuery({
    queryKey: ["asientos", params],
    queryFn: () => fetchAsientos(params),
  });
  const { data: cuentasHojas = [] } = useQuery({ queryKey: ["cuentas-hojas"], queryFn: fetchCuentasHojas });

  const totalDebe = lineas.reduce((s, l) => s + parseFloat(l.debe || "0"), 0);
  const totalHaber = lineas.reduce((s, l) => s + parseFloat(l.haber || "0"), 0);
  const cuadra = Math.abs(totalDebe - totalHaber) < 0.01;

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/contabilidad/asientos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(data),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Error al crear asiento"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asientos"] });
      setModalOpen(false);
      toast({ title: "Asiento creado correctamente" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const contabilizarMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/contabilidad/asientos/${id}/contabilizar`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Error"); }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asientos"] }); toast({ title: "Asiento contabilizado" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const anularMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/contabilidad/asientos/${id}/anular`, { method: "POST", credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Error"); }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asientos"] }); toast({ title: "Asiento anulado" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const addLinea = () => setLineas((prev) => [...prev, { cuentaId: 0, cuentaCodigo: "", cuentaNombre: "", debe: "0", haber: "0", descripcion: "", orden: prev.length }]);
  const removeLinea = (i: number) => setLineas((prev) => prev.filter((_, idx) => idx !== i));

  const updateLinea = (i: number, field: string, value: string) => {
    setLineas((prev) => {
      const updated = [...prev];
      updated[i] = { ...updated[i], [field]: value };
      return updated;
    });
  };

  const updateCuentaLinea = (i: number, cuentaId: string) => {
    const c = cuentasHojas.find((c) => c.id === parseInt(cuentaId));
    if (!c) return;
    setLineas((prev) => {
      const updated = [...prev];
      updated[i] = { ...updated[i], cuentaId: c.id, cuentaCodigo: c.codigo, cuentaNombre: c.nombre };
      return updated;
    });
  };

  const handleSubmit = () => {
    if (!form.descripcion) return toast({ title: "La descripción es requerida", variant: "destructive" });
    if (!cuadra) return toast({ title: `El asiento no cuadra: Debe ${totalDebe.toFixed(2)} ≠ Haber ${totalHaber.toFixed(2)}`, variant: "destructive" });
    if (lineas.some((l) => !l.cuentaId)) return toast({ title: "Todas las líneas deben tener cuenta", variant: "destructive" });
    createMutation.mutate({ ...form, lineas });
  };

  const fmt = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Asientos Contables</h1>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Período (AAAAMM)</Label>
            <Input className="w-32" value={filtros.periodo} onChange={(e) => setFiltros((f) => ({ ...f, periodo: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estado</Label>
            <Select value={filtros.estado || "todos"} onValueChange={(v) => setFiltros((f) => ({ ...f, estado: v === "todos" ? "" : v }))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="borrador">Borrador</SelectItem>
                <SelectItem value="contabilizado">Contabilizado</SelectItem>
                <SelectItem value="anulado">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo asiento
        </Button>
      </div>

      {/* Tabla */}
      <div className="border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">N°</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Fecha</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Descripción</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24">Estado</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {asientos.map((a) => (
                <tr key={a.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-sm font-medium">{a.numero}</td>
                  <td className="py-2.5 px-3 text-sm text-muted-foreground">
                    {format(new Date(a.fecha + "T12:00:00"), "dd/MM/yyyy")}
                  </td>
                  <td className="py-2.5 px-3 text-sm">{a.descripcion}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLORS[a.estado]}`}>
                      {ESTADO_LABELS[a.estado]}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setDetailAsiento(a)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Ver detalle"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {a.estado === "borrador" && (
                        <button
                          onClick={() => contabilizarMutation.mutate(a.id)}
                          className="p-1.5 rounded hover:bg-green-100 text-green-600 hover:text-green-700"
                          title="Contabilizar"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {a.estado !== "anulado" && (
                        <button
                          onClick={() => anularMutation.mutate(a.id)}
                          className="p-1.5 rounded hover:bg-red-100 text-red-500 hover:text-red-600"
                          title="Anular"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isLoading && asientos.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Sin asientos en el período</p>
          </div>
        )}
      </div>

      {/* Modal nuevo asiento */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo asiento contable</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Fecha *</Label>
                <Input type="date" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Período (AAAAMM) *</Label>
                <Input value={form.periodo} onChange={(e) => setForm((f) => ({ ...f, periodo: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Moneda</Label>
                <Select value={form.moneda} onValueChange={(v) => setForm((f) => ({ ...f, moneda: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CLP">CLP — Peso chileno</SelectItem>
                    <SelectItem value="USD">USD — Dólar</SelectItem>
                    <SelectItem value="EUR">EUR — Euro</SelectItem>
                    <SelectItem value="UF">UF — Unidad de Fomento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Descripción / Glosa *</Label>
              <Input placeholder="Descripción del asiento..." value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <Label>Notas adicionales</Label>
              <Textarea rows={2} value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} />
            </div>

            <Separator />

            {/* Líneas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Líneas del asiento</Label>
                <div className={`text-sm font-medium ${cuadra ? "text-green-600" : "text-red-500"}`}>
                  Debe: {fmt(totalDebe)} | Haber: {fmt(totalHaber)}
                  {!cuadra && <span className="ml-2">⚠ No cuadra</span>}
                  {cuadra && totalDebe > 0 && <span className="ml-2">✓ Cuadra</span>}
                </div>
              </div>

              <div className="border rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left py-2 px-2 text-xs text-muted-foreground">Cuenta</th>
                      <th className="text-right py-2 px-2 text-xs text-muted-foreground w-28">Debe</th>
                      <th className="text-right py-2 px-2 text-xs text-muted-foreground w-28">Haber</th>
                      <th className="text-left py-2 px-2 text-xs text-muted-foreground w-32">Descripción</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1 px-2">
                          <Select value={l.cuentaId ? String(l.cuentaId) : ""} onValueChange={(v) => updateCuentaLinea(i, v)}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Selecciona cuenta..." />
                            </SelectTrigger>
                            <SelectContent>
                              {cuentasHojas.map((c) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.codigo} — {c.nombre}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1 px-2">
                          <Input className="h-7 text-xs text-right" value={l.debe} onChange={(e) => updateLinea(i, "debe", e.target.value)} />
                        </td>
                        <td className="py-1 px-2">
                          <Input className="h-7 text-xs text-right" value={l.haber} onChange={(e) => updateLinea(i, "haber", e.target.value)} />
                        </td>
                        <td className="py-1 px-2">
                          <Input className="h-7 text-xs" value={l.descripcion} onChange={(e) => updateLinea(i, "descripcion", e.target.value)} />
                        </td>
                        <td className="py-1 px-1">
                          {lineas.length > 2 && (
                            <button onClick={() => removeLinea(i)} className="p-1 text-muted-foreground hover:text-red-500 rounded">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button variant="outline" size="sm" onClick={addLinea} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Agregar línea
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || !cuadra || !form.descripcion}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Guardar asiento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle asiento */}
      {detailAsiento && (
        <Dialog open={!!detailAsiento} onOpenChange={() => setDetailAsiento(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Asiento {detailAsiento.numero}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-muted-foreground">Fecha:</span> {format(new Date(detailAsiento.fecha + "T12:00:00"), "dd/MM/yyyy")}</div>
                <div><span className="text-muted-foreground">Período:</span> {periodoToStr(detailAsiento.periodo)}</div>
                <div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COLORS[detailAsiento.estado]}`}>
                    {ESTADO_LABELS[detailAsiento.estado]}
                  </span>
                </div>
              </div>
              <p className="text-sm"><span className="text-muted-foreground">Descripción:</span> {detailAsiento.descripcion}</p>
              {detailAsiento.lineas && (
                <table className="w-full text-sm border rounded">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left py-2 px-3 text-xs text-muted-foreground">Cuenta</th>
                      <th className="text-right py-2 px-3 text-xs text-muted-foreground">Debe</th>
                      <th className="text-right py-2 px-3 text-xs text-muted-foreground">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailAsiento.lineas.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-2 px-3">{l.cuentaCodigo} — {l.cuentaNombre}</td>
                        <td className="py-2 px-3 text-right font-mono">{parseFloat(l.debe) > 0 ? fmt(parseFloat(l.debe)) : "—"}</td>
                        <td className="py-2 px-3 text-right font-mono">{parseFloat(l.haber) > 0 ? fmt(parseFloat(l.haber)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
