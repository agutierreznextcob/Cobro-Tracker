import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useListAreas,
  useCrearArea,
  useActualizarArea,
  useEliminarArea,
  type AreaOrg,
} from "@workspace/api-client-react";
import {
  Building2,
  Check,
  FolderKanban,
  Layers3,
  Pencil,
  Plus,
  RotateCw,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TIPO_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  area:          { label: "Área",             icon: Layers3,      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  departamento:  { label: "Departamento",     icon: Building2,    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  centro_costo:  { label: "Centro de costo",  icon: Tag,          color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
};

type TipoArea = "area" | "departamento" | "centro_costo";

function TipoBadge({ tipo }: { tipo: string }) {
  const meta = TIPO_META[tipo] ?? TIPO_META.area;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", meta.color)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export default function ConfiguracionAreasPage() {
  const { toast } = useToast();
  const { data: areas, isLoading, refetch, isFetching } = useListAreas();
  const crearArea = useCrearArea();
  const actualizarArea = useActualizarArea();
  const eliminarArea = useEliminarArea();

  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoArea>("area");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editTipo, setEditTipo] = useState<TipoArea>("area");
  const [filtro, setFiltro] = useState<"todas" | TipoArea>("todas");

  const handleCrear = () => {
    const n = nombre.trim();
    if (!n) return;
    crearArea.mutate({ nombre: n, tipo }, {
      onSuccess: () => {
        toast({ title: "Creado", description: `"${n}" agregado como ${TIPO_META[tipo].label.toLowerCase()}.` });
        setNombre("");
      },
      onError: (err) => {
        toast({ title: "Error al crear", description: err instanceof Error ? err.message : "Intenta nuevamente.", variant: "destructive" });
      },
    });
  };

  const iniciarEdicion = (area: AreaOrg) => {
    setEditandoId(area.id);
    setEditNombre(area.nombre);
    setEditTipo(area.tipo as TipoArea);
  };

  const guardarEdicion = () => {
    if (!editandoId || !editNombre.trim()) return;
    actualizarArea.mutate({ id: editandoId, nombre: editNombre.trim(), tipo: editTipo }, {
      onSuccess: () => {
        toast({ title: "Actualizado" });
        setEditandoId(null);
      },
      onError: (err) => {
        toast({ title: "Error al actualizar", description: err instanceof Error ? err.message : "Intenta nuevamente.", variant: "destructive" });
      },
    });
  };

  const handleEliminar = (area: AreaOrg) => {
    eliminarArea.mutate(area.id, {
      onSuccess: () => toast({ title: "Eliminado", description: `"${area.nombre}" fue eliminado.` }),
      onError: (err) => {
        toast({ title: "Error al eliminar", description: err instanceof Error ? err.message : "Intenta nuevamente.", variant: "destructive" });
      },
    });
  };

  const areasFiltradas = (areas ?? []).filter(a => filtro === "todas" || a.tipo === filtro);

  const conteos = {
    area: (areas ?? []).filter(a => a.tipo === "area").length,
    departamento: (areas ?? []).filter(a => a.tipo === "departamento").length,
    centro_costo: (areas ?? []).filter(a => a.tipo === "centro_costo").length,
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-primary" />
            Áreas, Departamentos y Centros de Costo
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Organiza tu empresa y mide indicadores por sector. Las áreas son seleccionables en cobros, cotizaciones y pedidos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RotateCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Resumen de conteos */}
      {(areas ?? []).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {(["area", "departamento", "centro_costo"] as TipoArea[]).map((t) => {
            const meta = TIPO_META[t];
            const Icon = meta.icon;
            return (
              <Card
                key={t}
                className={cn(
                  "px-4 py-3 cursor-pointer border-2 transition-colors",
                  filtro === t ? "border-primary bg-primary/5" : "border-transparent hover:border-border",
                )}
                onClick={() => setFiltro(filtro === t ? "todas" : t)}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{meta.label}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{conteos[t]}</p>
              </Card>
            );
          })}
        </div>
      )}

      {/* Formulario de creación */}
      <Card className="p-5 border-dashed border-2 border-primary/30 bg-primary/5">
        <p className="text-sm font-medium mb-3">Agregar nuevo</p>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px] space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input
              placeholder="Ej: Gerencia Comercial, Logística, Proyecto Sur…"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCrear()}
              className="h-9"
            />
          </div>
          <div className="w-[180px] space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoArea)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="area">Área</SelectItem>
                <SelectItem value="departamento">Departamento</SelectItem>
                <SelectItem value="centro_costo">Centro de costo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="h-9 gap-1.5"
            onClick={handleCrear}
            disabled={crearArea.isPending || !nombre.trim()}
          >
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Puedes crear áreas para proyectos, faenas, turnos, sucursales o cualquier sector que quieras medir por separado.
        </p>
      </Card>

      {/* Lista */}
      {isLoading && (
        <div className="text-center py-10 text-muted-foreground text-sm">Cargando…</div>
      )}

      {!isLoading && (areas ?? []).length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <FolderKanban className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Aún no hay áreas registradas</p>
          <p className="text-sm mt-1">Crea la primera usando el formulario de arriba.</p>
        </div>
      )}

      {areasFiltradas.length > 0 && (
        <div className="space-y-2">
          {filtro !== "todas" && (
            <div className="flex items-center gap-2 pb-1">
              <span className="text-xs text-muted-foreground">Filtrando por:</span>
              <TipoBadge tipo={filtro} />
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => setFiltro("todas")}
              >
                Ver todas
              </button>
            </div>
          )}
          {areasFiltradas.map((area) => (
            <Card key={area.id} className="border-border/50 shadow-sm overflow-hidden">
              {editandoId === area.id ? (
                <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
                  <Input
                    className="h-8 text-sm flex-1 min-w-[150px]"
                    value={editNombre}
                    onChange={(e) => setEditNombre(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && guardarEdicion()}
                    autoFocus
                  />
                  <Select value={editTipo} onValueChange={(v) => setEditTipo(v as TipoArea)}>
                    <SelectTrigger className="h-8 text-sm w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="area">Área</SelectItem>
                      <SelectItem value="departamento">Departamento</SelectItem>
                      <SelectItem value="centro_costo">Centro de costo</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" className="h-8 px-3 gap-1" onClick={guardarEdicion} disabled={actualizarArea.isPending}>
                      <Check className="h-3.5 w-3.5" /> Guardar
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditandoId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 group">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{area.nombre}</p>
                    {area.descripcion && (
                      <p className="text-xs text-muted-foreground truncate">{area.descripcion}</p>
                    )}
                  </div>
                  <TipoBadge tipo={area.tipo} />
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => iniciarEdicion(area)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => handleEliminar(area)}
                      disabled={eliminarArea.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {!isLoading && (areas ?? []).length > 0 && areasFiltradas.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No hay registros de tipo "{TIPO_META[filtro]?.label ?? filtro}".
        </div>
      )}
    </div>
  );
}
