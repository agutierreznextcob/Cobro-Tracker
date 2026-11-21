import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, ChevronRight, ChevronDown, BookOpen, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  tipo: "activo" | "pasivo" | "patrimonio" | "ingreso" | "egreso" | "orden";
  naturaleza: "deudora" | "acreedora";
  nivel: number;
  padreId: number | null;
  esHoja: boolean;
  activa: boolean;
  esEstandar: boolean;
  codigoSii: string | null;
}

const TIPO_LABELS: Record<string, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio: "Patrimonio",
  ingreso: "Ingreso",
  egreso: "Egreso",
  orden: "Orden",
};

const TIPO_COLORS: Record<string, string> = {
  activo: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  pasivo: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  patrimonio: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  ingreso: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  egreso: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  orden: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};

async function fetchCuentas(): Promise<Cuenta[]> {
  const res = await fetch("/api/contabilidad/plan-cuentas", { credentials: "include" });
  if (!res.ok) throw new Error("Error al cargar plan de cuentas");
  return res.json();
}

async function createCuenta(data: Partial<Cuenta>): Promise<Cuenta> {
  const res = await fetch("/api/contabilidad/plan-cuentas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Error al crear cuenta");
  }
  return res.json();
}

function CuentaRow({ cuenta, depth = 0 }: { cuenta: Cuenta & { children?: Cuenta[] }; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = cuenta.children && cuenta.children.length > 0;

  return (
    <>
      <tr className="border-b hover:bg-muted/30 transition-colors">
        <td className="py-2 px-3">
          <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="w-5" />
            )}
            <span className="font-mono text-sm font-medium text-muted-foreground">{cuenta.codigo}</span>
          </div>
        </td>
        <td className="py-2 px-3">
          <span className={`text-sm ${!cuenta.activa ? "text-muted-foreground line-through" : ""}`}>
            {cuenta.nombre}
          </span>
          {cuenta.esEstandar && (
            <span className="ml-2 text-xs text-muted-foreground/70">(estándar)</span>
          )}
        </td>
        <td className="py-2 px-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TIPO_COLORS[cuenta.tipo]}`}>
            {TIPO_LABELS[cuenta.tipo]}
          </span>
        </td>
        <td className="py-2 px-3 text-sm text-muted-foreground capitalize">{cuenta.naturaleza}</td>
        <td className="py-2 px-3 text-center">
          {cuenta.esHoja ? (
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Cuenta de movimiento" />
          ) : (
            <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" title="Cuenta de agrupación" />
          )}
        </td>
        <td className="py-2 px-3 text-sm text-muted-foreground font-mono text-xs">{cuenta.codigoSii ?? "—"}</td>
      </tr>
      {expanded && hasChildren && cuenta.children?.map((child) => (
        <CuentaRow key={child.id} cuenta={child as any} depth={depth + 1} />
      ))}
    </>
  );
}

function buildTree(cuentas: Cuenta[]): (Cuenta & { children?: Cuenta[] })[] {
  const map: Record<number, Cuenta & { children?: Cuenta[] }> = {};
  cuentas.forEach((c) => { map[c.id] = { ...c, children: [] }; });
  const roots: (Cuenta & { children?: Cuenta[] })[] = [];
  cuentas.forEach((c) => {
    if (c.padreId && map[c.padreId]) {
      map[c.padreId].children!.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });
  return roots;
}

interface Props { hideHeader?: boolean }

export default function PlanCuentasPage({ hideHeader }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    codigo: "", nombre: "", descripcion: "",
    tipo: "activo" as Cuenta["tipo"],
    naturaleza: "deudora" as Cuenta["naturaleza"],
    nivel: 1, padreId: "", esHoja: true, codigoSii: "",
  });

  const { data: cuentas = [], isLoading } = useQuery({ queryKey: ["plan-cuentas"], queryFn: fetchCuentas });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contabilidad/plan-cuentas/seed-estandar", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al cargar plan estándar");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["plan-cuentas"] });
      if (data.seeded) {
        toast({ title: `Plan de cuentas cargado (${data.count} cuentas)` });
      }
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // Auto-seed cuando no hay cuentas y ya terminó de cargar
  const hasAutoSeeded = useRef(false);
  useEffect(() => {
    if (!isLoading && cuentas.length === 0 && !hasAutoSeeded.current) {
      hasAutoSeeded.current = true;
      seedMutation.mutate();
    }
  }, [isLoading, cuentas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: createCuenta,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-cuentas"] });
      setModalOpen(false);
      toast({ title: "Cuenta creada correctamente" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const filtered = cuentas.filter((c) =>
    !search || c.codigo.toLowerCase().includes(search.toLowerCase()) || c.nombre.toLowerCase().includes(search.toLowerCase())
  );

  const tree = search ? [] : buildTree(cuentas);
  const displayList = search ? filtered : [];

  const handleSubmit = () => {
    mutation.mutate({
      ...form,
      nivel: parseInt(String(form.nivel)),
      padreId: form.padreId ? parseInt(form.padreId) : undefined,
    } as any);
  };

  return (
    <div className="space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Plan de Cuentas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Plan de cuentas IFRS/PCGCh chileno</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código o nombre..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nueva cuenta
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-36">Código</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nombre</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Tipo</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24">Naturaleza</th>
                <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-16">Hoja</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24">Cód. SII</th>
              </tr>
            </thead>
            <tbody>
              {search
                ? displayList.map((c) => <CuentaRow key={c.id} cuenta={c} depth={0} />)
                : tree.map((c) => <CuentaRow key={c.id} cuenta={c as any} depth={0} />)
              }
            </tbody>
          </table>
        )}
        {!isLoading && cuentas.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            {seedMutation.isPending ? (
              <>
                <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin opacity-50" />
                <p className="font-medium">Cargando plan de cuentas estándar...</p>
                <p className="text-sm mt-1">Esto puede tomar unos segundos.</p>
              </>
            ) : (
              <>
                <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No hay cuentas cargadas</p>
                <p className="text-sm mt-1">El plan de cuentas estándar se carga automáticamente.</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal nueva cuenta */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva cuenta contable</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Código *</Label>
              <Input placeholder="Ej: 1.1.01.001" value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Nivel</Label>
              <Input type="number" min={1} max={5} value={form.nivel} onChange={(e) => setForm((f) => ({ ...f, nivel: parseInt(e.target.value) }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Nombre *</Label>
              <Input placeholder="Ej: Caja y efectivo" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Naturaleza</Label>
              <Select value={form.naturaleza} onValueChange={(v) => setForm((f) => ({ ...f, naturaleza: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deudora">Deudora</SelectItem>
                  <SelectItem value="acreedora">Acreedora</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>ID Cuenta Padre</Label>
              <Input type="number" placeholder="ID numérico" value={form.padreId} onChange={(e) => setForm((f) => ({ ...f, padreId: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Código SII</Label>
              <Input placeholder="Ej: 01" value={form.codigoSii} onChange={(e) => setForm((f) => ({ ...f, codigoSii: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Descripción</Label>
              <Textarea rows={2} placeholder="Descripción opcional..." value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch checked={form.esHoja} onCheckedChange={(v) => setForm((f) => ({ ...f, esHoja: v }))} />
              <Label>Es cuenta de movimiento (hoja)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={mutation.isPending || !form.codigo || !form.nombre}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Crear cuenta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
