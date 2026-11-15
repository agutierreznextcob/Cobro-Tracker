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

export function useActualizarOrgRole() {
  return useMutation({
    mutationFn: ({ userId, orgRole }: { userId: string; orgRole: "admin_org" | "supervisor" | "ejecutivo" }) =>
      customFetch<{ ok: boolean; mensaje: string; orgRole: string }>(
        `/api/admin/usuarios/${userId}/org-role`,
        { method: "POST", body: JSON.stringify({ orgRole }), responseType: "json" },
      ),
  });
}
