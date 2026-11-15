import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useListMiembrosConPermisos,
  useActualizarPermisos,
  MODULOS_INFO,
  type MiembroConPermisos,
  type ModuloPermiso,
  type NivelPermiso,
} from "@/lib/permisos";
import { Briefcase, Building2, Check, ChevronDown, ChevronUp, Loader2, Mail, Phone, RotateCw, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";

const GRUPOS = ["Ventas", "Logística", "Compras", "Gestión", "Sistema"] as const;

function modulosPorGrupo(grupo: string) {
  return MODULOS_INFO.filter((m) => m.grupo === grupo);
}

function nombreCompleto(m: MiembroConPermisos): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || m.id;
}

function orgRoleLabel(role: string | null) {
  if (role === "admin_org") return { label: "Admin", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" };
  if (role === "supervisor") return { label: "Supervisor", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" };
  return { label: "Ejecutivo", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" };
}

type LocalPermisos = Partial<Record<ModuloPermiso, NivelPermiso | null>>;

function NivelBtn({
  actual,
  nivel,
  onClick,
  disabled,
}: {
  actual: NivelPermiso | null | undefined;
  nivel: NivelPermiso | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  const isActive = actual === nivel;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-2.5 py-1 text-xs rounded-md border transition-colors",
        isActive
          ? nivel === "lectura_escritura"
            ? "bg-green-600 text-white border-green-600"
            : nivel === "lectura"
            ? "bg-amber-500 text-white border-amber-500"
            : "bg-muted text-muted-foreground border-border"
          : "bg-background text-muted-foreground border-border hover:border-foreground/40",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {nivel === null ? "Sin acceso" : nivel === "lectura" ? "Solo lectura" : "Lectura y escritura"}
    </button>
  );
}

function UsuarioCard({ miembro }: { miembro: MiembroConPermisos }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [local, setLocal] = useState<LocalPermisos>(() => {
    const p: LocalPermisos = {};
    for (const mod of MODULOS_INFO) {
      p[mod.id] = miembro.permisos[mod.id] ?? null;
    }
    return p;
  });
  const [dirty, setDirty] = useState(false);
  const actualizar = useActualizarPermisos(miembro.id);
  const esAdmin = miembro.orgRole === "admin_org";

  const setNivel = (modulo: ModuloPermiso, nivel: NivelPermiso | null) => {
    setLocal((prev) => ({ ...prev, [modulo]: nivel }));
    setDirty(true);
  };

  const guardar = () => {
    actualizar.mutate(local, {
      onSuccess: () => {
        toast({ title: "Permisos guardados", description: `Permisos de ${nombreCompleto(miembro)} actualizados.` });
        setDirty(false);
      },
      onError: (err) => {
        toast({ title: "Error al guardar", description: err instanceof Error ? err.message : "Intenta nuevamente.", variant: "destructive" });
      },
    });
  };

  const rolInfo = orgRoleLabel(miembro.orgRole);
  const accesosActivos = Object.values(local).filter((v) => v !== null).length;
  const estadoActivo = miembro.activo !== false;

  return (
    <Card className="shadow-sm border-border/50 overflow-hidden">
      <div
        className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => !esAdmin && setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            {esAdmin ? (
              <Shield className="h-4 w-4 text-primary" />
            ) : (
              <User className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm truncate">{nombreCompleto(miembro)}</p>
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full font-medium",
                estadoActivo
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
              )}>
                {estadoActivo ? "Activo" : "Inactivo"}
              </span>
            </div>
            {miembro.cargo && (
              <p className="text-xs text-muted-foreground truncate">{miembro.cargo}{miembro.area ? ` · ${miembro.area}` : ""}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge className={cn("text-xs font-medium", rolInfo.className)}>
            {rolInfo.label}
          </Badge>
          {!esAdmin && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {accesosActivos} módulo{accesosActivos !== 1 ? "s" : ""}
            </span>
          )}
          {!esAdmin && (
            expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Información de perfil */}
      <div className="px-5 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-muted-foreground border-t border-border/30 pt-3">
        {miembro.rut && (
          <div className="flex items-center gap-1.5">
            <User className="h-3 w-3 shrink-0" />
            <span>RUT: {miembro.rut}</span>
          </div>
        )}
        {miembro.email && (
          <div className="flex items-center gap-1.5">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{miembro.email}</span>
          </div>
        )}
        {miembro.phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="h-3 w-3 shrink-0" />
            <span>{miembro.phone}</span>
          </div>
        )}
        {miembro.cargo && (
          <div className="flex items-center gap-1.5">
            <Briefcase className="h-3 w-3 shrink-0" />
            <span>{miembro.cargo}</span>
          </div>
        )}
        {miembro.area && (
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3 w-3 shrink-0" />
            <span>{miembro.area}</span>
          </div>
        )}
      </div>

      {esAdmin && (
        <div className="px-5 pb-4 text-xs text-muted-foreground">
          Los administradores de organización tienen acceso total a todos los módulos.
        </div>
      )}

      {expanded && !esAdmin && (
        <div className="border-t border-border/50">
          <div className="p-5 space-y-5">
            {GRUPOS.map((grupo) => {
              const mods = modulosPorGrupo(grupo);
              return (
                <div key={grupo}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{grupo}</p>
                  <div className="space-y-2">
                    {mods.map((mod) => (
                      <div key={mod.id} className="flex items-center justify-between gap-4 py-1.5">
                        <span className="text-sm">{mod.label}</span>
                        <div className="flex items-center gap-1.5">
                          <NivelBtn
                            actual={local[mod.id]}
                            nivel={null}
                            onClick={() => setNivel(mod.id, null)}
                            disabled={actualizar.isPending}
                          />
                          <NivelBtn
                            actual={local[mod.id]}
                            nivel="lectura"
                            onClick={() => setNivel(mod.id, "lectura")}
                            disabled={actualizar.isPending}
                          />
                          <NivelBtn
                            actual={local[mod.id]}
                            nivel="lectura_escritura"
                            onClick={() => setNivel(mod.id, "lectura_escritura")}
                            disabled={actualizar.isPending}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 pb-4 flex justify-end gap-2 border-t border-border/50 pt-4">
            <Button
              size="sm"
              onClick={guardar}
              disabled={!dirty || actualizar.isPending}
              className="gap-1.5"
            >
              {actualizar.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Guardar permisos
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ConfiguracionUsuariosPage() {
  const { data: miembros, isLoading, isError, refetch, isFetching } = useListMiembrosConPermisos();

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Usuarios y permisos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configura qué módulos puede ver y modificar cada miembro de tu organización.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RotateCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">Cargando usuarios…</div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">
          No se pudieron cargar los usuarios. Intenta actualizar la página.
        </div>
      )}

      {!isError && miembros && miembros.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No hay usuarios registrados todavía.
        </div>
      )}

      {miembros && miembros.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-lg px-4 py-3 space-y-1">
            <p className="font-medium text-foreground">Cómo funcionan los permisos</p>
            <p>Haz clic en un usuario para expandir sus permisos. Los cambios aplican de inmediato al guardar.</p>
            <p><span className="font-medium text-amber-600 dark:text-amber-400">Solo lectura</span>: puede ver el módulo pero no crear ni modificar.</p>
            <p><span className="font-medium text-green-600 dark:text-green-400">Lectura y escritura</span>: acceso completo al módulo.</p>
            <p><span className="font-medium">Sin acceso</span>: el módulo no aparece en el menú lateral.</p>
          </div>

          <div className="space-y-3">
            {miembros.map((m) => (
              <UsuarioCard key={m.id} miembro={m} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
