export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

// ── Custom mutation hooks not yet in generated client ────────────────────────
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import { getListClientesQueryKey, getListInventarioQueryKey, getListLocalesQueryKey, getListBodegasQueryKey } from "./generated/api";

export function useDeleteCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<void>(`/api/clientes/${id}`, { method: "DELETE", responseType: "auto" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientesQueryKey() }); },
  });
}

export function useDeleteProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<void>(`/api/inventario/${id}`, { method: "DELETE", responseType: "auto" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListInventarioQueryKey() }); },
  });
}

export function useUpdateLocal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, nombre, direccion }: { id: number; nombre: string; direccion?: string }) =>
      customFetch<unknown>(`/api/locales/${id}`, { method: "PATCH", body: JSON.stringify({ nombre, direccion }), headers: { "Content-Type": "application/json" } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListLocalesQueryKey() }); },
  });
}

export function useDeleteLocal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<void>(`/api/locales/${id}`, { method: "DELETE", responseType: "auto" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListLocalesQueryKey() }); },
  });
}

export function useUpdateBodega() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, nombre, descripcion }: { id: number; nombre: string; descripcion?: string }) =>
      customFetch<unknown>(`/api/bodegas/${id}`, { method: "PATCH", body: JSON.stringify({ nombre, descripcion }), headers: { "Content-Type": "application/json" } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListBodegasQueryKey() }); qc.invalidateQueries({ queryKey: getListLocalesQueryKey() }); },
  });
}

export function useDeleteBodega() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<void>(`/api/bodegas/${id}`, { method: "DELETE", responseType: "auto" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListBodegasQueryKey() }); qc.invalidateQueries({ queryKey: getListLocalesQueryKey() }); },
  });
}

export function useResetMemberPassword() {
  return useMutation({
    mutationFn: (userId: string) =>
      customFetch<{ ok: boolean; mensaje: string }>(`/api/organization/usuarios/${userId}/reset-password`, {
        method: "POST",
        responseType: "json",
      }),
  });
}

export function useActualizarPacksUsuarios() {
  return useMutation({
    mutationFn: ({ userId, usuariosExtra }: { userId: string; usuariosExtra: number }) =>
      customFetch<{ ok: boolean; mensaje: string; usuariosExtra: number }>(
        `/api/admin/usuarios/${userId}/packs-usuarios`,
        { method: "POST", body: JSON.stringify({ usuariosExtra }), responseType: "json" },
      ),
  });
}

export function useEliminarCuentaAdmin() {
  return useMutation({
    mutationFn: (userId: string) =>
      customFetch<{ ok: boolean; mensaje: string }>(
        `/api/admin/usuarios/${userId}`,
        { method: "DELETE", responseType: "json" },
      ),
  });
}

export function useCrearOrgAdmin() {
  return useMutation({
    mutationFn: (userId: string) =>
      customFetch<{ ok: boolean; mensaje: string; organizationId?: number }>(
        `/api/admin/usuarios/${userId}/crear-org`,
        { method: "POST", responseType: "json" },
      ),
  });
}

export function useActualizarOrgRole() {
  return useMutation({
    mutationFn: ({ userId, orgRole }: { userId: string; orgRole: "admin_org" | "supervisor" | "ejecutivo" }) =>
      customFetch<{ ok: boolean; mensaje: string; orgRole: string }>(
        `/api/admin/usuarios/${userId}/org-role`,
        { method: "POST", body: JSON.stringify({ orgRole }), responseType: "json" },
      ),
  });
}

// ── Áreas / Departamentos / Centros de Costo ─────────────────────────────────
import { useQuery } from "@tanstack/react-query";

export interface AreaOrg {
  id: number;
  organizationId: number;
  nombre: string;
  tipo: "area" | "departamento" | "centro_costo";
  parentAreaId: number | null;
  responsableId: string | null;
  descripcion: string | null;
  activa: string;
  miembros?: number;
}

export function getListAreasQueryKey() {
  return ["areas"] as const;
}

export function useListAreas() {
  return useQuery({
    queryKey: getListAreasQueryKey(),
    queryFn: () => customFetch<AreaOrg[]>("/api/areas", { responseType: "json" }),
  });
}

export function useCrearArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { nombre: string; tipo?: "area" | "departamento" | "centro_costo"; descripcion?: string; parentAreaId?: number; responsableId?: string }) =>
      customFetch<AreaOrg>("/api/areas", { method: "POST", body: JSON.stringify(data), responseType: "json" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListAreasQueryKey() }); },
  });
}

export function useActualizarArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; nombre?: string; tipo?: "area" | "departamento" | "centro_costo"; descripcion?: string | null; parentAreaId?: number | null; responsableId?: string | null }) =>
      customFetch<AreaOrg>(`/api/areas/${id}`, { method: "PATCH", body: JSON.stringify(data), responseType: "json" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListAreasQueryKey() }); },
  });
}

export function useEliminarArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<{ ok: boolean; mensaje: string }>(`/api/areas/${id}`, { method: "DELETE", responseType: "json" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListAreasQueryKey() }); },
  });
}

export function useUpdateMiembroArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { areaId: number | null } }) =>
      customFetch<unknown>(`/api/organization/usuarios/${id}`, { method: "PATCH", body: JSON.stringify({ areaId: data.areaId }), responseType: "json" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/organization/usuarios"] }); },
  });
}
