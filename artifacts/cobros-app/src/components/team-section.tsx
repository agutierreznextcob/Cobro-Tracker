import { useState } from "react";
import {
  useGetOrganization,
  useListMiembros,
  useListInvitaciones,
  useInvitarUsuario,
  useUpdateMiembro,
  useDeactivateMiembro,
  useCancelarInvitacion,
  getGetOrganizationQueryKey,
  getListMiembrosQueryKey,
  getListInvitacionesQueryKey,
  getGetSubscriptionStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Users, UserPlus, MailCheck, X, ShieldCheck, Trash2 } from "lucide-react";
import { OrgChart } from "@/components/org-chart";

function formatCLP(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

const ORG_ROLE_LABEL: Record<string, string> = {
  admin_org: "Administrador",
  supervisor: "Supervisor",
  ejecutivo: "Ejecutivo",
};

type OrgRole = "admin_org" | "supervisor" | "ejecutivo";

export function TeamSection({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: org } = useGetOrganization();
  const { data: miembros, isLoading: miembrosLoading } = useListMiembros();
  const { data: invitaciones } = useListInvitaciones();

  const invitar = useInvitarUsuario();
  const updateMiembro = useUpdateMiembro();
  const deactivateMiembro = useDeactivateMiembro();
  const cancelarInvitacion = useCancelarInvitacion();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("ejecutivo");
  const [inviteSupervisorId, setInviteSupervisorId] = useState<string>("ninguno");
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; nombre: string } | null>(
    null,
  );

  const invalidateTeam = () => {
    queryClient.invalidateQueries({ queryKey: getGetOrganizationQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMiembrosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListInvitacionesQueryKey() });
    // Seat changes alter the monthly total shown in the Suscripción card.
    queryClient.invalidateQueries({ queryKey: getGetSubscriptionStatusQueryKey() });
  };

  const handleInvite = () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Correo inválido",
        description: "Ingresa un correo electrónico válido.",
        variant: "destructive",
      });
      return;
    }
    invitar.mutate(
      {
        data: {
          email,
          orgRole: inviteRole,
          supervisorId:
            inviteRole === "ejecutivo" && inviteSupervisorId !== "ninguno"
              ? inviteSupervisorId
              : null,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Invitación enviada",
            description: `Se envió una invitación a ${email}.`,
          });
          invalidateTeam();
          setInviteEmail("");
          setInviteRole("ejecutivo");
          setInviteSupervisorId("ninguno");
          setInviteOpen(false);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo enviar la invitación.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  const handleRoleChange = (id: string, orgRole: OrgRole) => {
    updateMiembro.mutate(
      { id, data: { orgRole } },
      {
        onSuccess: () => {
          toast({ title: "Rol actualizado" });
          invalidateTeam();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo actualizar el rol.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  const handleSupervisorChange = (id: string, supervisorId: string | null) => {
    updateMiembro.mutate(
      { id, data: { supervisorId } },
      {
        onSuccess: () => {
          toast({ title: "Supervisor actualizado" });
          invalidateTeam();
        },
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "No se pudo actualizar el supervisor.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  const handleDeactivate = () => {
    if (!deactivateTarget) return;
    deactivateMiembro.mutate(
      { id: deactivateTarget.id },
      {
        onSuccess: () => {
          toast({ title: "Usuario eliminado correctamente" });
          invalidateTeam();
          setDeactivateTarget(null);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo eliminar el usuario.";
          toast({ title: "Error", description: msg, variant: "destructive" });
          setDeactivateTarget(null);
        },
      },
    );
  };

  const handleCancelInvite = (id: number) => {
    cancelarInvitacion.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Invitación cancelada" });
          invalidateTeam();
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo cancelar.", variant: "destructive" });
        },
      },
    );
  };

  const pendientes = (invitaciones ?? []).filter((i) => i.estado === "pendiente");
  const supervisores = (miembros ?? []).filter(
    (m) => m.orgRole === "supervisor" && m.activo,
  );

  return (
    <div className="space-y-6">
    <Card className={embedded ? "border-0 shadow-none bg-transparent rounded-none" : "shadow-sm border-border/50"}>
      {!embedded && (
        <CardHeader className="bg-muted/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Mi equipo
          </CardTitle>
          <CardDescription>
            Invita ejecutivos y administra los roles de tu organización.
          </CardDescription>
        </CardHeader>
      )}
      {embedded && (
        <p className="text-sm text-muted-foreground mb-4 -mt-1">
          Invita ejecutivos y administra los roles de tu organización.
        </p>
      )}
      <CardContent className={embedded ? "p-0 space-y-6" : "pt-6 space-y-6"}>
        {/* Pricing breakdown */}
        {org && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Plan base (1 usuario)
              </span>
              <span className="font-medium">{formatCLP(org.planBaseNeto)} + IVA</span>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Neto {formatCLP(org.planBaseNeto)} + IVA {formatCLP(org.planBaseIva)} = Total {formatCLP(org.planBase)}
            </p>
            {org.usuariosAdicionales > 0 && (
              <>
                <div className="flex items-center justify-between text-sm pt-1">
                  <span className="text-muted-foreground">
                    Usuarios adicionales ({org.usuariosAdicionales} × {formatCLP(org.costoUsuarioAdicionalNeto)} + IVA)
                  </span>
                  <span className="font-medium">
                    {formatCLP(org.usuariosAdicionales * org.costoUsuarioAdicional)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Cada usuario: Neto {formatCLP(org.costoUsuarioAdicionalNeto)} + IVA {formatCLP(org.costoUsuarioAdicionalIva)} = Total {formatCLP(org.costoUsuarioAdicional)}
                </p>
              </>
            )}
            <div className="flex items-center justify-between border-t border-border/50 pt-2 text-sm">
              <span className="font-semibold">Total mensual estimado</span>
              <span className="font-bold">{formatCLP(org.totalMensual)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1">
              {org.miembrosActivos} usuario{org.miembrosActivos !== 1 ? "s" : ""} activo
              {org.miembrosActivos !== 1 ? "s" : ""} en tu organización. Precios con IVA incluido.
            </p>
          </div>
        )}

        {/* Members list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Miembros</h3>
            <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              Invitar
            </Button>
          </div>

          {miembrosLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Cargando miembros...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Supervisor</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(miembros ?? []).map((m) => (
                    <TableRow key={m.id} className={!m.activo ? "opacity-50" : ""}>
                      <TableCell>
                        <div className="font-medium">{m.nombre ?? m.email ?? "—"}</div>
                        {m.email && m.nombre && (
                          <div className="text-xs text-muted-foreground">{m.email}</div>
                        )}
                        {!m.activo && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            Inactivo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {m.esOwner ? (
                          <span className="inline-flex items-center gap-1 text-sm">
                            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                            {ORG_ROLE_LABEL[m.orgRole ?? "admin_org"]}
                          </span>
                        ) : (
                          <Select
                            value={m.orgRole ?? "ejecutivo"}
                            onValueChange={(v) => handleRoleChange(m.id, v as OrgRole)}
                            disabled={!m.activo || updateMiembro.isPending}
                          >
                            <SelectTrigger className="h-8 w-[150px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ejecutivo" className="text-xs">
                                Ejecutivo
                              </SelectItem>
                              <SelectItem value="supervisor" className="text-xs">
                                Supervisor
                              </SelectItem>
                              <SelectItem value="admin_org" className="text-xs">
                                Administrador
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        {m.orgRole === "ejecutivo" && !m.esOwner ? (
                          <Select
                            value={m.supervisorId ?? "ninguno"}
                            onValueChange={(v) =>
                              handleSupervisorChange(m.id, v === "ninguno" ? null : v)
                            }
                            disabled={!m.activo || updateMiembro.isPending}
                          >
                            <SelectTrigger className="h-8 w-[170px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ninguno" className="text-xs">
                                Sin supervisor
                              </SelectItem>
                              {supervisores.map((s) => (
                                <SelectItem key={s.id} value={s.id} className="text-xs">
                                  {s.nombre ?? s.email ?? "—"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!m.esOwner && m.activo && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 gap-1.5"
                            onClick={() =>
                              setDeactivateTarget({
                                id: m.id,
                                nombre: m.nombre ?? m.email ?? "este usuario",
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Eliminar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Pending invitations */}
        {pendientes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <MailCheck className="h-3.5 w-3.5 text-muted-foreground" />
              Invitaciones pendientes
            </h3>
            <div className="space-y-2">
              {pendientes.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {ORG_ROLE_LABEL[inv.orgRole] ?? inv.orgRole}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleCancelInvite(inv.id)}
                    disabled={cancelarInvitacion.isPending}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitar a un miembro</DialogTitle>
            <DialogDescription>
              Se enviará un correo con un enlace para unirse a tu organización.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="inviteEmail">Correo electrónico</Label>
              <Input
                id="inviteEmail"
                type="email"
                placeholder="ejecutivo@empresa.cl"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as OrgRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ejecutivo">Ejecutivo</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="admin_org">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteRole === "ejecutivo" && supervisores.length > 0 && (
              <div className="space-y-2">
                <Label>Supervisor</Label>
                <Select value={inviteSupervisorId} onValueChange={setInviteSupervisorId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguno">Sin supervisor (reporta al administrador)</SelectItem>
                    {supervisores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nombre ?? s.email ?? "—"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {org && (
              <p className="text-xs text-muted-foreground rounded-md bg-muted/40 p-3">
                Agregar un usuario suma {formatCLP(org.costoUsuarioAdicional)}/mes a tu plan (IVA incluido).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleInvite} disabled={invitar.isPending}>
              {invitar.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Enviando...
                </>
              ) : (
                "Enviar invitación"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation */}
      <AlertDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar usuario</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro que deseas eliminar a {deactivateTarget?.nombre} de tu equipo? Esta
              acción no se puede deshacer.
              {org && (
                <>
                  {" "}
                  Se liberará su licencia y se descontarán {formatCLP(org.costoUsuarioAdicional)} de
                  tu próximo cobro.
                </>
              )}{" "}
              El usuario perderá acceso a la plataforma de inmediato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>

    {/* Organigrama: solo visible para el Administrador (TeamSection ya está gateado a admin_org). */}
    <OrgChart miembros={miembros ?? []} />
    </div>
  );
}
