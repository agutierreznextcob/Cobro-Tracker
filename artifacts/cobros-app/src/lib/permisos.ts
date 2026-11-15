import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ModuloPermiso =
  | "cobros"
  | "clientes"
  | "cotizaciones"
  | "pedidos"
  | "guias_despacho"
  | "inventario"
  | "compras"
  | "proveedores"
  | "informes"
  | "workflows"
  | "tareas"
  | "configuracion";

export type NivelPermiso = "lectura" | "lectura_escritura";

export interface PermisoUsuario {
  userId: string;
  modulo: ModuloPermiso;
  nivel: NivelPermiso;
}

export interface MiembroConPermisos {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  orgRole: "admin_org" | "supervisor" | "ejecutivo" | null;
  activo: boolean;
  permisos: Partial<Record<ModuloPermiso, NivelPermiso>>;
}

export interface MisPermisos {
  orgRole: "admin_org" | "supervisor" | "ejecutivo" | null;
  permisos: Partial<Record<ModuloPermiso, NivelPermiso>>;
}

export const PERMISOS_USUARIOS_KEY = ["permisos", "usuarios"] as const;
export const MIS_PERMISOS_KEY = ["permisos", "mios"] as const;

export const MODULOS_INFO: Array<{ id: ModuloPermiso; label: string; grupo: string }> = [
  { id: "cobros", label: "Cobros", grupo: "Ventas" },
  { id: "clientes", label: "Clientes", grupo: "Ventas" },
  { id: "cotizaciones", label: "Cotizaciones", grupo: "Ventas" },
  { id: "pedidos", label: "Pedidos", grupo: "Logística" },
  { id: "guias_despacho", label: "Guías de despacho", grupo: "Logística" },
  { id: "inventario", label: "Inventario", grupo: "Compras" },
  { id: "compras", label: "Compras", grupo: "Compras" },
  { id: "proveedores", label: "Proveedores", grupo: "Compras" },
  { id: "informes", label: "Informes", grupo: "Gestión" },
  { id: "workflows", label: "Automatizaciones", grupo: "Gestión" },
  { id: "tareas", label: "Tareas", grupo: "Gestión" },
  { id: "configuracion", label: "Configuración", grupo: "Sistema" },
];

// Hook para obtener todos los miembros con sus permisos (admin_org solamente).
export function useListMiembrosConPermisos() {
  return useQuery<MiembroConPermisos[]>({
    queryKey: PERMISOS_USUARIOS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/permisos/usuarios", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });
}

// Hook para obtener los propios permisos del usuario autenticado.
export function useMisPermisos() {
  return useQuery<MisPermisos>({
    queryKey: MIS_PERMISOS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/permisos/mios", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
}

// Hook para actualizar los permisos de un usuario.
export function useActualizarPermisos(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (permisos: Partial<Record<ModuloPermiso, NivelPermiso | null>>) => {
      const r = await fetch(`/api/permisos/usuario/${userId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permisos }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(err.error || "Error al actualizar permisos");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PERMISOS_USUARIOS_KEY });
    },
  });
}

// Verifica si un usuario tiene al menos acceso de lectura a un módulo.
// admin_org siempre tiene acceso total.
export function tieneAcceso(
  misPermisos: MisPermisos | undefined,
  modulo: ModuloPermiso,
): boolean {
  if (!misPermisos) return false;
  if (misPermisos.orgRole === "admin_org") return true;
  return modulo in misPermisos.permisos;
}

// Verifica si un usuario tiene acceso de escritura a un módulo.
// admin_org siempre tiene acceso total.
export function tieneEscritura(
  misPermisos: MisPermisos | undefined,
  modulo: ModuloPermiso,
): boolean {
  if (!misPermisos) return false;
  if (misPermisos.orgRole === "admin_org") return true;
  return misPermisos.permisos[modulo] === "lectura_escritura";
}
