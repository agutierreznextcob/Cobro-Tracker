import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
// Note: Input/Label/Select still used inside EditarUsuarioSheet and InvitarDialog
import { useToast } from "@/hooks/use-toast";
import {
  useListMiembrosConPermisos,
  useActualizarPermisos,
  MODULOS_INFO,
  type MiembroConPermisos,
  type ModuloPermiso,
  type NivelPermiso,
} from "@/lib/permisos";
import {
  useGetOrganization,
  useInvitarUsuario,
  useUpdateMiembro,
  getGetOrganizationQueryKey,
  useListAreas,
} from "@workspace/api-client-react";
import { useResetMemberPassword } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  FolderKanban,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  RotateCw,
  Shield,
  User,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OrgRoleBadge, orgRoleLabel } from "@/components/org-role-badge";
import { PERMISOS_USUARIOS_KEY } from "@/lib/permisos";

type OrgRole = "admin_org" | "gerente" | "subgerente" | "supervisor" | "ejecutivo";

const GRUPOS = ["Ventas", "Logística", "Compras", "Gestión", "Sistema"] as const;

function modulosPorGrupo(grupo: string) {
  return MODULOS_INFO.filter((m) => m.grupo === grupo);
}

function nombreCompleto(m: MiembroConPermisos): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || m.id;
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

// ── Edit User Sheet ──────────────────────────────────────────────────────────
function EditarUsuarioSheet({
  miembro,
  esAdmin,
  onClose,
}: {
  miembro: MiembroConPermisos;
  esAdmin: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmReset, setConfirmReset] = useState(false);

  // Org data for dropdowns
  const { data: miembros } = useListMiembrosConPermisos();
  const { data: areas } = useListAreas();

  // Editable fields
  const [cargo, setCargo] = useState(miembro.cargo ?? "");
  const [orgRole, setOrgRole] = useState<OrgRole>((miembro.orgRole as OrgRole) ?? "ejecutivo");
  const [areaId, setAreaId] = useState<string>(miembro.areaId ? String(miembro.areaId) : "none");
  const [supervisorId, setSupervisorId] = useState<string>(miembro.supervisorId ?? "none");

  // Permisos
  const [local, setLocal] = useState<LocalPermisos>(() => {
    const p: LocalPermisos = {};
    for (const mod of MODULOS_INFO) {
      p[mod.id] = miembro.permisos[mod.id] ?? null;
    }
    return p;
  });
  const [permisosModificados, setPermisosModificados] = useState(false);

  const actualizarPermisos = useActualizarPermisos(miembro.id);
  const resetPassword = useResetMemberPassword();
  const updateMiembro = useUpdateMiembro();

  const esMiembroAdmin = miembro.orgRole === "admin_org";

  const setNivel = (modulo: ModuloPermiso, nivel: NivelPermiso | null) => {
    setLocal((prev) => ({ ...prev, [modulo]: nivel }));
    setPermisosModificados(true);
  };

  // Potential supervisors: anyone with supervisor/subgerente/gerente role, excluding this user
  const supervisoresPosibles = (miembros ?? []).filter(
    (m) => m.id !== miembro.id && (m.orgRole === "supervisor" || m.orgRole === "subgerente" || m.orgRole === "gerente"),
  );

  const handleGuardar = async () => {
    try {
      // Update org info (cargo, role, area, supervisor)
      const updateData: Record<string, unknown> = { cargo: cargo.trim() || null, orgRole };
      if (areaId !== "none") updateData.areaId = Number(areaId);
      else updateData.areaId = null;
      if (supervisorId !== "none" && orgRole !== "admin_org" && orgRole !== "gerente" && orgRole !== "subgerente") {
        updateData.supervisorId = supervisorId;
      } else if (orgRole === "admin_org" || orgRole === "gerente" || orgRole === "subgerente") {
        updateData.supervisorId = null;
      } else {
        updateData.supervisorId = supervisorId !== "none" ? supervisorId : null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateMiembro.mutateAsync({ id: miembro.id, data: updateData as any });

      // Update permisos if changed
      if (permisosModificados && !esMiembroAdmin) {
        await actualizarPermisos.mutateAsync(local);
      }

      qc.invalidateQueries({ queryKey: PERMISOS_USUARIOS_KEY });
      qc.invalidateQueries({ queryKey: getGetOrganizationQueryKey() });
      toast({ title: "Usuario actualizado", description: `Los datos de ${nombreCompleto(miembro)} fueron guardados.` });
      onClose();
    } catch (err) {
      toast({
        title: "Error al guardar",
        description: err instanceof Error ? err.message : "Intenta nuevamente.",
        variant: "destructive",
      });
    }
  };

  const handleResetPassword = () => {
    resetPassword.mutate(miembro.id, {
      onSuccess: () => {
        toast({ title: "Contraseña reseteada", description: `Se envió una contraseña provisoria al correo de ${nombreCompleto(miembro)}.` });
        setConfirmReset(false);
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "No se pudo resetear la contraseña.";
        toast({ title: "Error", description: msg, variant: "destructive" });
        setConfirmReset(false);
      },
    });
  };

  const isSaving = updateMiembro.isPending || actualizarPermisos.isPending;

  return (
    <>
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                {esMiembroAdmin ? <Shield className="h-5 w-5 text-primary" /> : <User className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <SheetTitle className="text-base">{nombreCompleto(miembro)}</SheetTitle>
                <p className="text-xs text-muted-foreground">{miembro.email}</p>
              </div>
            </div>
          </SheetHeader>

          <div className="py-5 space-y-5">
            {/* Cargo / descripción */}
            <div className="space-y-1.5">
              <Label className="text-sm">Descripción de cargo</Label>
              <Input
                placeholder="Ej: Ejecutivo Comercial, Jefe de Ventas…"
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
              />
            </div>

            {/* Rol */}
            {esAdmin && (
              <div className="space-y-1.5">
                <Label className="text-sm">Rol en la organización</Label>
                <Select value={orgRole} onValueChange={(v) => setOrgRole(v as OrgRole)} disabled={!esAdmin}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ejecutivo">Usuario — acceso según permisos</SelectItem>
                    <SelectItem value="supervisor">Supervisor — supervisa usuarios</SelectItem>
                    <SelectItem value="subgerente">Subgerente — supervisa supervisores</SelectItem>
                    <SelectItem value="gerente">Gerente — gestiona área completa</SelectItem>
                    <SelectItem value="admin_org">Administrador — acceso total</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Área */}
            <div className="space-y-1.5">
              <Label className="text-sm">Área / Departamento</Label>
              <Select value={areaId} onValueChange={setAreaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin área asignada" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin área asignada</SelectItem>
                  {(areas ?? []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.nombre} <span className="text-muted-foreground text-xs ml-1">({a.tipo})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Superior directo — solo para supervisor/ejecutivo */}
            {(orgRole === "supervisor" || orgRole === "ejecutivo") && (
              <div className="space-y-1.5">
                <Label className="text-sm">Superior directo</Label>
                <Select value={supervisorId} onValueChange={setSupervisorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sin superior asignado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin superior asignado</SelectItem>
                    {supervisoresPosibles.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {nombreCompleto(s)} <span className="text-muted-foreground text-xs ml-1">({orgRoleLabel(s.orgRole)})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Permisos de módulos */}
            {!esMiembroAdmin && (
              <div className="space-y-3 pt-2 border-t border-border/50">
                <p className="text-sm font-medium">Permisos de módulos</p>
                {GRUPOS.map((grupo) => {
                  const mods = modulosPorGrupo(grupo);
                  return (
                    <div key={grupo}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{grupo}</p>
                      <div className="space-y-1.5">
                        {mods.map((mod) => (
                          <div key={mod.id} className="flex items-center justify-between gap-2 py-1">
                            <span className="text-sm">{mod.label}</span>
                            <div className="flex items-center gap-1">
                              <NivelBtn actual={local[mod.id]} nivel={null} onClick={() => setNivel(mod.id, null)} disabled={isSaving} />
                              <NivelBtn actual={local[mod.id]} nivel="lectura" onClick={() => setNivel(mod.id, "lectura")} disabled={isSaving} />
                              <NivelBtn actual={local[mod.id]} nivel="lectura_escritura" onClick={() => setNivel(mod.id, "lectura_escritura")} disabled={isSaving} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {esMiembroAdmin && (
              <p className="text-xs text-muted-foreground">Los administradores de organización tienen acceso total a todos los módulos.</p>
            )}
          </div>

          <div className="sticky bottom-0 bg-background border-t border-border/50 pt-4 pb-4 flex flex-col gap-2">
            <div className="flex justify-between gap-2">
              {esAdmin && !esMiembroAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground gap-1.5"
                  onClick={() => setConfirmReset(true)}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Resetear contraseña
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
                <Button size="sm" onClick={handleGuardar} disabled={isSaving} className="gap-1.5">
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar cambios
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reset password confirm dialog */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Resetear contraseña</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se generará una contraseña provisoria y se enviará al correo de <strong>{nombreCompleto(miembro)}</strong> ({miembro.email}).
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>Cancelar</Button>
            <Button size="sm" disabled={resetPassword.isPending} onClick={handleResetPassword}>
              {resetPassword.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
              Resetear y enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── User Card ────────────────────────────────────────────────────────────────
function UsuarioCard({
  miembro,
  esAdmin,
}: {
  miembro: MiembroConPermisos;
  esAdmin: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const estadoActivo = miembro.activo !== false;

  return (
    <>
      <Card
        className="shadow-sm border-border/50 overflow-hidden cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setEditOpen(true)}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              {miembro.orgRole === "admin_org" ? (
                <Shield className="h-4 w-4 text-primary" />
              ) : (
                <User className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
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
              <p className="text-xs text-muted-foreground truncate">
                {miembro.cargo ? miembro.cargo : miembro.email}
                {miembro.area ? ` · ${miembro.area}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <OrgRoleBadge orgRole={miembro.orgRole} short />
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </Card>

      {editOpen && (
        <EditarUsuarioSheet
          miembro={miembro}
          esAdmin={esAdmin}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

// ── Areas Link Card ───────────────────────────────────────────────────────────
function AreasLinkCard() {
  const { data: areas } = useListAreas();
  const count = (areas ?? []).length;
  return (
    <Link href="/configuracion/areas">
      <Card className="border-border/50 shadow-sm overflow-hidden cursor-pointer hover:bg-muted/30 transition-colors">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <FolderKanban className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-medium text-sm">Áreas, Departamentos y Centros de Costo</p>
              <p className="text-xs text-muted-foreground">
                {count > 0 ? `${count} registrado${count !== 1 ? "s" : ""}` : "Sin áreas — haz clic para crear"}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>
    </Link>
  );
}

// ── Invite Dialog ────────────────────────────────────────────────────────────
function InvitarDialog({ onClose, cupoLibre }: { onClose: () => void; cupoLibre: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const invitar = useInvitarUsuario();
  const [email, setEmail] = useState("");
  const [orgRole, setOrgRole] = useState<OrgRole>("ejecutivo");

  const handleInvitar = () => {
    if (!email.trim()) return;
    invitar.mutate({ data: { email: email.trim(), orgRole } }, {
      onSuccess: () => {
        toast({ title: "Invitación enviada", description: `Se envió una invitación a ${email.trim()}.` });
        qc.invalidateQueries({ queryKey: getGetOrganizationQueryKey() });
        onClose();
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "No se pudo enviar la invitación.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Invitar usuario</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-1">
          {cupoLibre <= 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-300">
              Has alcanzado el cupo de usuarios de tu plan. Agrega un pack de usuarios adicionales para invitar más personas.
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Correo electrónico *</Label>
            <Input
              type="email"
              placeholder="correo@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInvitar()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Rol inicial</Label>
            <Select value={orgRole} onValueChange={(v) => setOrgRole(v as OrgRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ejecutivo">Usuario — acceso según permisos</SelectItem>
                <SelectItem value="supervisor">Supervisor — supervisa usuarios</SelectItem>
                <SelectItem value="subgerente">Subgerente — supervisa supervisores</SelectItem>
                <SelectItem value="gerente">Gerente — gestiona área completa</SelectItem>
                <SelectItem value="admin_org">Administrador — acceso total</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Se enviará un correo de invitación. El rol y los permisos se pueden ajustar después haciendo clic en el usuario.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={invitar.isPending || !email.trim() || cupoLibre <= 0} onClick={handleInvitar}>
              {invitar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
              Enviar invitación
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ConfiguracionUsuariosPage() {
  const { data: miembros, isLoading, isError, refetch, isFetching } = useListMiembrosConPermisos();
  const { data: orgInfo } = useGetOrganization();
  const [invitarOpen, setInvitarOpen] = useState(false);

  const esAdmin = orgInfo?.esAdmin ?? false;
  const esOwner = orgInfo?.esOwner ?? false;
  const puedeInvitar = esAdmin || esOwner;

  const totalCupo = orgInfo?.cupoUsuarios ?? 0;
  const miembrosActivos = orgInfo?.miembrosActivos ?? 0;
  const invitacionesPendientes = orgInfo?.invitacionesPendientes ?? 0;
  const ocupados = miembrosActivos + invitacionesPendientes;
  const cupoLibre = Math.max(0, totalCupo - ocupados);
  const planNombre = orgInfo?.nombre ?? "Mi organización";

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Usuarios y permisos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestiona los miembros de tu organización y sus accesos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RotateCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
            Actualizar
          </Button>
          {puedeInvitar && (
            <Button size="sm" onClick={() => setInvitarOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Invitar usuario
            </Button>
          )}
        </div>
      </div>

      {/* Plan & cupo banner */}
      {orgInfo && (
        <div className="rounded-xl border bg-muted/30 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{planNombre}</p>
              <p className="text-xs text-muted-foreground">
                {miembrosActivos} usuario{miembrosActivos !== 1 ? "s" : ""} activo{miembrosActivos !== 1 ? "s" : ""}
                {invitacionesPendientes > 0 && ` · ${invitacionesPendientes} invitación${invitacionesPendientes !== 1 ? "es" : ""} pendiente${invitacionesPendientes !== 1 ? "s" : ""}`}
                {totalCupo > 0 && ` · ${totalCupo} cupo${totalCupo !== 1 ? "s" : ""} en total`}
              </p>
            </div>
          </div>
          {totalCupo > 0 && (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex gap-1">
                {Array.from({ length: Math.min(totalCupo, 20) }).map((_, i) => (
                  <div
                    key={i}
                    className={cn("h-5 w-2.5 rounded-sm", i < ocupados ? "bg-primary" : "bg-muted-foreground/20")}
                  />
                ))}
                {totalCupo > 20 && <span className="text-xs text-muted-foreground self-center">+{totalCupo - 20}</span>}
              </div>
              <span className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                cupoLibre > 0
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
              )}>
                {cupoLibre > 0 ? `${cupoLibre} libre${cupoLibre !== 1 ? "s" : ""}` : "Sin cupo"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Areas section — only for admins */}
      {esAdmin && <AreasLinkCard />}

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
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Haz clic en un usuario para editar su cargo, rol, área y permisos de módulos.
          </p>
          {miembros.map((m) => (
            <UsuarioCard key={m.id} miembro={m} esAdmin={esAdmin} />
          ))}
        </div>
      )}

      {invitarOpen && (
        <InvitarDialog onClose={() => setInvitarOpen(false)} cupoLibre={cupoLibre} />
      )}
    </div>
  );
}
