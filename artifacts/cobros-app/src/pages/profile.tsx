import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  useGetFlowCredentials,
  useSaveFlowCredentials,
  useDeleteFlowCredentials,
  useGetMpCredentials,
  useSaveMpCredentials,
  useDeleteMpCredentials,
  getGetMpCredentialsQueryKey,
  useGetSubscriptionStatus,
  getGetSubscriptionStatusQueryKey,
  useCancelSubscription,
  useGetPaymentMethodUrl,
  useCompletarPerfil,
  exportarDatos,
  useEliminarCuenta,
  useChangePassword,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, type AuthUser } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { isValidRut, formatRut } from "@/lib/rut";
import { TeamSection } from "@/components/team-section";
import { DatosBancariosSection } from "@/components/datos-bancarios-section";
import { OrgRoleBadge } from "@/components/org-role-badge";
import { PlanSelector } from "@/components/plan-selector";
import { PacksUsuarios } from "@/components/packs-usuarios";
import { Loader2, CheckCircle2, Plug2, Trash2, Eye, EyeOff, User, KeyRound, CreditCard, Sparkles, IdCard, Mail, Pencil, Camera, ShieldCheck, Download, Landmark } from "lucide-react";

// Desglose mensual en tiempo real: plan base + usuarios extra = total mensual.
// Los montos vienen del backend (/subscription/status) y se refrescan cuando el
// equipo cambia (team-section invalida la query al agregar/desactivar usuarios).
function DesgloseMensual({ subStatus }: { subStatus: SubStatusDesglose }) {
  const packs = subStatus.packs ?? [];
  const packsTotal = subStatus.packsTotal ?? 0;
  const totalMensual = subStatus.totalMensual ?? subStatus.precioMensual;
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
      <p>
        Plan {subStatus.planNombre ?? "NextCob"}: {formatCLP(subStatus.precioNeto)} + IVA {formatCLP(subStatus.precioIva)} = {formatCLP(subStatus.precioMensual)}
      </p>
      {packs.map((p) => (
        <p key={p.pack}>
          + {p.nombre}
          {p.cantidad > 1 ? ` ×${p.cantidad}` : ""} ({p.usuarios} usuario{p.usuarios !== 1 ? "s" : ""}): {formatCLP(p.total)}
        </p>
      ))}
      {packsTotal > 0 && (
        <p className="font-medium text-foreground">
          Plan {formatCLP(subStatus.precioMensual)} + Packs {formatCLP(packsTotal)} = Total {formatCLP(totalMensual)}/mes
        </p>
      )}
      {packsTotal === 0 && (
        <p className="font-medium text-foreground">Total mensual: {formatCLP(totalMensual)}</p>
      )}
      {subStatus.usuariosIncluidos != null && (
        <p className="font-medium text-foreground">
          Usuarios incluidos en tu plan:{" "}
          {Math.min(subStatus.usuariosActivos ?? 1, subStatus.usuariosIncluidos)} de{" "}
          {subStatus.usuariosIncluidos}
        </p>
      )}
      {subStatus.cupoUsuarios != null && (
        <p>
          Cupo total (plan + packs): {subStatus.usuariosActivos ?? 1} de{" "}
          {subStatus.cupoUsuarios} usuario{subStatus.cupoUsuarios !== 1 ? "s" : ""} en uso
        </p>
      )}
    </div>
  );
}

type SubStatusDesglose = {
  precioNeto: number;
  precioIva: number;
  precioMensual: number;
  planNombre?: string;
  usuariosIncluidos?: number;
  invitacionesPendientes?: number;
  esOwner?: boolean;
  packs?: Array<{ pack: string; nombre: string; cantidad: number; usuarios: number; total: number }>;
  packsTotal?: number;
  cupoUsuarios?: number;
  usuariosActivos?: number;
  totalMensual?: number;
};

// Botón "Ver planes": abre el selector de planes (Starter / NextCob / Pro).
// Desde ahí el usuario contrata su suscripción o cambia de plan.
function SuscribirseButton({ label = "Ver planes y suscribirme" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <Button
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
        data-testid="button-suscribirse"
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Elige tu plan</DialogTitle>
            <DialogDescription>
              Puedes cambiar de plan cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <PlanSelector onPlanCambiado={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Acciones de una suscripción activa: cancelar (con confirmación) y actualizar
// el método de pago (link hospedado por Reveniu).
function SuscripcionActivaAcciones() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const cancelar = useCancelSubscription({
    mutation: {
      onSuccess: (data) => {
        setConfirmOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetSubscriptionStatusQueryKey() });
        toast({
          title: "Suscripción cancelada",
          description: data.accesoHasta
            ? `Mantendrás el acceso hasta el ${formatFecha(data.accesoHasta)}. No se harán más cobros.`
            : "No se harán más cobros.",
        });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "No se pudo cancelar la suscripción.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const metodoPago = useGetPaymentMethodUrl({
    mutation: {
      onSuccess: (data) => {
        window.open(data.url, "_blank", "noopener");
      },
      onError: () => {
        toast({
          title: "Error",
          description: "No se pudo obtener el enlace para actualizar el método de pago.",
          variant: "destructive",
        });
      },
    },
  });

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={metodoPago.isPending}
        onClick={() => metodoPago.mutate()}
        data-testid="button-actualizar-metodo-pago"
      >
        {metodoPago.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Actualizar método de pago
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
          data-testid="button-cancelar-suscripcion"
        >
          Cancelar suscripción
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cancelar tu suscripción?</DialogTitle>
            <DialogDescription>
              No se harán más cobros automáticos. Mantendrás el acceso hasta el final del
              período que ya pagaste; después tu cuenta quedará suspendida.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={cancelar.isPending}
              onClick={() => cancelar.mutate()}
              data-testid="button-confirmar-cancelacion"
            >
              {cancelar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sí, cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Resize a chosen image client-side and return a JPEG data URL. Keeping avatars
// small (max 256px) lets us store them directly in users.profileImageUrl without
// any object-storage infrastructure, and keeps the /auth/user payload light.
async function resizeImageToDataUrl(file: File, max = 256): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Imagen inválida"));
    image.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function formatCLP(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatFecha(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
}

function OnboardingForm({
  email,
  initialFirstName,
  initialLastName,
}: {
  email: string | null | undefined;
  initialFirstName: string | null | undefined;
  initialLastName: string | null | undefined;
}) {
  const { toast } = useToast();
  const completarPerfil = useCompletarPerfil();

  const [firstName, setFirstName] = useState(initialFirstName ?? "");
  const [lastName, setLastName] = useState(initialLastName ?? "");
  const [rut, setRut] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [rutError, setRutError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName.trim() || !lastName.trim() || !rut.trim() || !phone.trim() || !address.trim()) {
      toast({ title: "Campos requeridos", description: "Completa todos los campos obligatorios.", variant: "destructive" });
      return;
    }
    if (!isValidRut(rut)) {
      setRutError("El RUT ingresado no es válido.");
      return;
    }
    setRutError(null);

    completarPerfil.mutate(
      {
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          rut: rut.trim(),
          phone: phone.trim(),
          address: address.trim(),
          companyName: companyName.trim() || null,
        },
      },
      {
        onSuccess: () => {
          // useAuth refetches /auth/user only on mount, so reload to pick up
          // the now-completed profile and unlock the rest of the platform.
          const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
          window.location.href = `${base}/dashboard`;
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo guardar tu perfil.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 animate-in fade-in duration-300">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Completa tu perfil</h1>
        <p className="text-muted-foreground mt-2">
          Necesitamos algunos datos para activar tu cuenta. Esto solo se pide una vez.
        </p>
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <IdCard className="h-4 w-4 text-primary" />
            Datos personales
          </CardTitle>
          <CardDescription>Los campos marcados con * son obligatorios.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                Correo electrónico
              </Label>
              <Input value={email ?? ""} disabled readOnly className="bg-muted/40" />
              <p className="text-xs text-muted-foreground">Obtenido de tu cuenta. No se puede modificar.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Nombre *</Label>
                <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Juan" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Apellido *</Label>
                <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Pérez" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rut">RUT *</Label>
              <Input
                id="rut"
                value={rut}
                onChange={(e) => {
                  setRut(formatRut(e.target.value));
                  setRutError(null);
                }}
                placeholder="12.345.678-5"
                inputMode="text"
              />
              {rutError && <p className="text-xs text-destructive">{rutError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono *</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+56 9 1234 5678" inputMode="tel" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Dirección *</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Av. Siempre Viva 742, Santiago" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="companyName">Nombre de la empresa (opcional)</Label>
              <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Mi Empresa SpA" />
            </div>

            <Button type="submit" className="w-full" disabled={completarPerfil.isPending}>
              {completarPerfil.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</>
              ) : (
                "Guardar y continuar"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();

  if (user && !user.profileCompleted) {
    return (
      <OnboardingForm
        email={user.email}
        initialFirstName={user.firstName}
        initialLastName={user.lastName}
      />
    );
  }

  return <ProfileSettings />;
}

function EditProfileDialog({ user }: { user: AuthUser }) {
  const { toast } = useToast();
  const completarPerfil = useCompletarPerfil();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [address, setAddress] = useState(user.address ?? "");
  const [companyName, setCompanyName] = useState(user.companyName ?? "");
  const [photo, setPhoto] = useState<string | null>(user.profileImageUrl ?? null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Reset fields from the current user each time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setFirstName(user.firstName ?? "");
      setLastName(user.lastName ?? "");
      setPhone(user.phone ?? "");
      setAddress(user.address ?? "");
      setCompanyName(user.companyName ?? "");
      setPhoto(user.profileImageUrl ?? null);
      setPhotoError(null);
    }
    setOpen(next);
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Selecciona un archivo de imagen.");
      return;
    }
    try {
      const resized = await resizeImageToDataUrl(file);
      setPhoto(resized);
      setPhotoError(null);
    } catch {
      setPhotoError("No se pudo procesar la imagen.");
    }
  };

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || user.email || "Usuario";
  const initials =
    [firstName, lastName]
      .filter(Boolean)
      .map((n) => n[0]?.toUpperCase())
      .join("") || "U";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !address.trim()) {
      toast({
        title: "Campos requeridos",
        description: "Completa todos los campos obligatorios.",
        variant: "destructive",
      });
      return;
    }
    completarPerfil.mutate(
      {
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          // RUT is read-only; the server preserves the stored value regardless.
          rut: user.rut ?? "",
          phone: phone.trim(),
          address: address.trim(),
          companyName: companyName.trim() || null,
          profileImageUrl: photo,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Perfil actualizado correctamente" });
          // useAuth only fetches /auth/user on mount, so reload to reflect changes.
          window.location.reload();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo actualizar tu perfil.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" />
          Editar perfil
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar perfil</DialogTitle>
          <DialogDescription>Actualiza tu información personal.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="flex items-center gap-4">
            {photo ? (
              <img
                src={photo}
                alt={displayName}
                className="h-16 w-16 rounded-full object-cover ring-2 ring-border"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold ring-2 ring-border">
                {initials}
              </div>
            )}
            <div className="space-y-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-3.5 w-3.5" />
                  Subir foto
                </Button>
                {photo && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setPhoto(null)}
                  >
                    Quitar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Opcional. JPG o PNG.</p>
            </div>
          </div>
          {photoError && <p className="text-xs text-destructive">{photoError}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="editFirstName">Nombre *</Label>
              <Input
                id="editFirstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editLastName">Apellido *</Label>
              <Input
                id="editLastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="editRut">RUT</Label>
            <Input id="editRut" value={user.rut ?? ""} disabled readOnly className="bg-muted/40" />
            <p className="text-xs text-muted-foreground">El RUT no se puede modificar.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="editPhone">Teléfono *</Label>
            <Input
              id="editPhone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editAddress">Dirección *</Label>
            <Input
              id="editAddress"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editCompany">Nombre de la empresa (opcional)</Label>
            <Input
              id="editCompany"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={completarPerfil.isPending}>
              {completarPerfil.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Guardando...
                </>
              ) : (
                "Guardar cambios"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm() {
  const { toast } = useToast();
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "Campos requeridos", description: "Completa todos los campos.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Las contraseñas no coinciden", variant: "destructive" });
      return;
    }
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) {
      toast({
        title: "Contraseña débil",
        description: "La nueva contraseña debe tener al menos 8 caracteres, una mayúscula y un número.",
        variant: "destructive",
      });
      return;
    }
    changePassword.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast({ title: "Contraseña actualizada correctamente" });
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
        onError: (err: unknown) => {
          const mensaje =
            (err as { mensaje?: string } | null)?.mensaje ||
            ((err as { data?: { mensaje?: string } } | null)?.data?.mensaje) ||
            "No se pudo actualizar la contraseña.";
          toast({ title: "Error", description: mensaje, variant: "destructive" });
        },
      },
    );
  };

  return (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Contraseña actual</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                data-testid="input-current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirmar nueva contraseña</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              data-testid="input-confirm-password"
            />
          </div>
          <Button type="submit" disabled={changePassword.isPending} data-testid="button-actualizar-password">
            {changePassword.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Actualizar contraseña
          </Button>
        </form>
  );
}

function PerfilSeccion({
  value,
  icon: Icon,
  title,
  description,
  iconClassName,
  oculta,
  children,
}: {
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  iconClassName?: string;
  // En modo consultor las secciones sensibles (contraseña, credenciales de
  // pago, datos bancarios, privacidad) se ocultan; el servidor las bloquea
  // igualmente con 403.
  oculta?: boolean;
  children: React.ReactNode;
}) {
  if (oculta) return null;
  return (
    <AccordionItem
      value={value}
      className="border border-border/50 rounded-lg shadow-sm bg-card overflow-hidden"
      data-testid={`seccion-${value}`}
    >
      <AccordionTrigger className="px-4 sm:px-6 py-4 hover:no-underline hover:bg-muted/30 data-[state=open]:bg-muted/20 data-[state=open]:border-b data-[state=open]:border-border/50">
        <span className="flex items-center gap-2 text-base font-semibold">
          <Icon className={cn("h-4 w-4 text-primary", iconClassName)} />
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4 sm:px-6 pt-5 pb-6">
        {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function ProfileSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: credStatus, isLoading: credLoading } = useGetFlowCredentials();
  const saveCredentials = useSaveFlowCredentials();
  const deleteCredentials = useDeleteFlowCredentials();

  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [editing, setEditing] = useState(false);

  // MercadoPago state
  const { data: mpStatus, isLoading: mpLoading } = useGetMpCredentials();
  const saveMp = useSaveMpCredentials();
  const deleteMp = useDeleteMpCredentials();
  const [mpAccessToken, setMpAccessToken] = useState("");
  const [showMpToken, setShowMpToken] = useState(false);
  const [mpEditing, setMpEditing] = useState(false);

  // Subscription state
  const { data: subStatus, isLoading: subLoading } = useGetSubscriptionStatus();
  // Handle the redirect back from Flow's card-registration page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("suscripcion");
    if (!result) return;
    if (result === "exito") {
      toast({ title: "¡Suscripción activada!", description: "Gracias por suscribirte a NextCob." });
      queryClient.invalidateQueries({ queryKey: getGetSubscriptionStatusQueryKey() });
    } else if (result === "error") {
      toast({
        title: "No se pudo completar la suscripción",
        description: "El registro de tu tarjeta no se completó. Inténtalo nuevamente.",
        variant: "destructive",
      });
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [toast, queryClient]);

  const handleSaveMp = () => {
    if (!mpAccessToken.trim()) {
      toast({ title: "Campo requerido", description: "Debes ingresar tu Access Token.", variant: "destructive" });
      return;
    }
    saveMp.mutate(
      { data: { accessToken: mpAccessToken.trim() } },
      {
        onSuccess: () => {
          toast({ title: "Credenciales guardadas", description: "Tu Access Token de MercadoPago fue encriptado y guardado." });
          queryClient.invalidateQueries({ queryKey: getGetMpCredentialsQueryKey() });
          setMpAccessToken("");
          setMpEditing(false);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Error al guardar.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleDeleteMp = () => {
    deleteMp.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Credenciales eliminadas", description: "Tu Access Token de MercadoPago fue eliminado." });
        queryClient.invalidateQueries({ queryKey: getGetMpCredentialsQueryKey() });
        setMpEditing(false);
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" });
      },
    });
  };

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Usuario"
    : "Usuario";

  const initials = user
    ? ([user.firstName, user.lastName].filter(Boolean).map((n) => n![0].toUpperCase()).join("") || "U")
    : "U";

  const handleSave = () => {
    if (!apiKey.trim() || !secretKey.trim()) {
      toast({ title: "Campos requeridos", description: "Debes ingresar ambas claves.", variant: "destructive" });
      return;
    }
    saveCredentials.mutate(
      { data: { apiKey: apiKey.trim(), secretKey: secretKey.trim() } },
      {
        onSuccess: () => {
          toast({ title: "Credenciales guardadas", description: "Tus claves de Flow han sido encriptadas y guardadas." });
          queryClient.invalidateQueries({ queryKey: ["getFlowCredentials"] });
          setApiKey("");
          setSecretKey("");
          setEditing(false);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Error al guardar.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = () => {
    deleteCredentials.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Credenciales eliminadas", description: "Tus claves de Flow han sido eliminadas." });
        queryClient.invalidateQueries({ queryKey: ["getFlowCredentials"] });
        setEditing(false);
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" });
      },
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mi perfil</h1>
        <p className="text-muted-foreground mt-1">Gestiona tu cuenta y conexiones</p>
      </div>

      <Accordion type="single" collapsible defaultValue="info" className="space-y-3">

      <PerfilSeccion value="info" icon={User} title="Información personal">
          <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {user?.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt={displayName}
                className="h-16 w-16 rounded-full object-cover ring-2 ring-border"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold ring-2 ring-border">
                {initials}
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold">{displayName}</p>
                <OrgRoleBadge orgRole={user?.orgRole} />
              </div>
              {user?.email && <p className="text-sm text-muted-foreground">{user.email}</p>}
            </div>
          </div>
          {user && <EditProfileDialog user={user} />}
          </div>

          <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 border-t border-border/50 pt-6">
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">ID de cuenta</dt>
              <dd className="text-base font-bold text-primary font-mono mt-0.5">{user?.accountId || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Correo electrónico</dt>
              <dd className="text-sm mt-0.5">{user?.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">RUT</dt>
              <dd className="text-sm mt-0.5">{user?.rut || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Teléfono</dt>
              <dd className="text-sm mt-0.5">{user?.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Empresa</dt>
              <dd className="text-sm mt-0.5">{user?.companyName || "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dirección</dt>
              <dd className="text-sm mt-0.5">{user?.address || "—"}</dd>
            </div>
          </dl>
      </PerfilSeccion>

      <PerfilSeccion value="password" oculta={!!user?.esConsultor} icon={KeyRound} title="Cambiar contraseña" description="Mínimo 8 caracteres, con al menos una mayúscula y un número.">
        <ChangePasswordForm />
      </PerfilSeccion>

      <PerfilSeccion value="suscripcion" icon={CreditCard} title="Suscripción" description="Tu plan de NextCob.">
        <div className="space-y-4">
          {subLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Verificando suscripción...</span>
            </div>
          ) : subStatus?.status === "activa" ? (
            <>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    Suscripción activa · Plan {subStatus.planNombre ?? "NextCob"}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {subStatus.periodEnd
                      ? `Próximo cobro: ${formatFecha(subStatus.periodEnd)}`
                      : `Plan mensual ${formatCLP(subStatus.precioNeto)} + IVA/mes`}
                  </p>
                </div>
              </div>
              <DesgloseMensual subStatus={subStatus} />
              {subStatus.tieneSuscripcion ? (
                <>
                  <SuscribirseButton label="Ver planes / cambiar de plan" />
                  <SuscripcionActivaAcciones />
                </>
              ) : (
                <SuscribirseButton />
              )}
            </>
          ) : subStatus?.status === "cancelada" ? (
            <>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <CreditCard className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Suscripción cancelada</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {subStatus.periodEnd
                      ? `Mantienes el acceso hasta el ${formatFecha(subStatus.periodEnd)}. No se harán más cobros.`
                      : "No se harán más cobros automáticos."}
                  </p>
                </div>
              </div>
              <DesgloseMensual subStatus={subStatus} />
              <SuscribirseButton />
            </>
          ) : subStatus?.status === "prueba" ? (
            <>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Prueba gratis</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    {subStatus.trialEndsAt
                      ? `Tu prueba termina el ${formatFecha(subStatus.trialEndsAt)}`
                      : "Estás en tu periodo de prueba"}
                  </p>
                </div>
              </div>
              <DesgloseMensual subStatus={subStatus} />
              <SuscribirseButton />
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <CreditCard className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Suscripción vencida</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Reactiva tu suscripción para seguir usando NextCob.
                  </p>
                </div>
              </div>
              {subStatus && <DesgloseMensual subStatus={subStatus} />}
              <SuscribirseButton />
            </>
          )}

          {/* Packs de usuarios adicionales: solo el dueño de la org (backend
              exige owner) y solo en planes que los permiten (NextCob). */}
          {!subLoading &&
            subStatus &&
            subStatus.planEfectivo !== "starter" &&
            user?.orgRole === "admin_org" &&
            (subStatus.esOwner ?? true) &&
            (() => {
              // Los packs sólo se ofrecen cuando los usuarios incluidos en el
              // plan ya están ocupados (o si ya hay packs contratados, para
              // poder administrarlos). Mientras queden cupos gratis, se informa
              // cuántos usuarios más puede invitar sin costo. Las invitaciones
              // pendientes reservan cupo, así que también se descuentan.
              const incluidos = subStatus.usuariosIncluidos ?? 1;
              const activos =
                (subStatus.usuariosActivos ?? 1) + (subStatus.invitacionesPendientes ?? 0);
              const tienePacks = (subStatus.packs ?? []).length > 0;
              const libresIncluidos = Math.max(0, incluidos - activos);
              if (!tienePacks && libresIncluidos > 0) {
                return (
                  <div className="pt-4 border-t border-border/50">
                    <h3 className="text-sm font-semibold">Agregar usuarios</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Tu plan incluye {incluidos} usuario{incluidos !== 1 ? "s" : ""} y estás
                      usando {activos} (incluyendo invitaciones pendientes). Puedes invitar{" "}
                      {libresIncluidos} usuario{libresIncluidos !== 1 ? "s" : ""} más sin costo
                      adicional desde Mi Equipo. Cuando ocupes todos los cupos, aquí podrás
                      agregar packs de usuarios adicionales.
                    </p>
                  </div>
                );
              }
              return (
                <div className="pt-4 border-t border-border/50 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Agregar usuarios</h3>
                    <p className="text-xs text-muted-foreground">
                      Suma packs de usuarios a tu plan. Mientras más grande el pack, menor el
                      precio por usuario.
                    </p>
                  </div>
                  <PacksUsuarios
                    cantidades={Object.fromEntries(
                      (subStatus.packs ?? []).map((p) => [p.pack, p.cantidad]),
                    )}
                  />
                </div>
              );
            })()}
        </div>
      </PerfilSeccion>

      {user?.orgRole === "admin_org" && (
        <PerfilSeccion value="equipo" icon={User} title="Mi Equipo">
          <TeamSection embedded />
        </PerfilSeccion>
      )}

      <PerfilSeccion value="flow" oculta={!!user?.esConsultor} icon={KeyRound} title="Conectar Flow" description="Ingresa tus credenciales de Flow para generar links de pago reales. Se guardan encriptadas con AES-256.">
        <div className="space-y-4">
          {credLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Verificando conexión...</span>
            </div>
          ) : credStatus?.configurado && !editing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">Flow conectado</p>
                  <p className="text-xs text-green-600 dark:text-green-400">Tus credenciales están guardadas y encriptadas de forma segura.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Plug2 className="h-3.5 w-3.5 mr-1.5" />
                  Actualizar credenciales
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 border-destructive/30"
                  onClick={handleDelete}
                  disabled={deleteCredentials.isPending}
                >
                  {deleteCredentials.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Desconectar
                </Button>
              </div>

            </div>
          ) : (
            <div className="space-y-4">
              {credStatus?.configurado && editing && (
                <p className="text-sm text-muted-foreground">
                  Ingresa nuevas credenciales para reemplazar las actuales.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showApiKey ? "text" : "password"}
                    placeholder="Tu API Key de Flow"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pr-10 font-mono text-sm"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="secretKey">Secret Key</Label>
                <div className="relative">
                  <Input
                    id="secretKey"
                    type={showSecretKey ? "text" : "password"}
                    placeholder="Tu Secret Key de Flow"
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    className="pr-10 font-mono text-sm"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={saveCredentials.isPending} className="min-w-28">
                  {saveCredentials.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</>
                  ) : (
                    "Guardar credenciales"
                  )}
                </Button>
                {editing && (
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    Cancelar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Puedes obtener tus credenciales en el panel de Flow en{" "}
                <a href="https://www.flow.cl" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  flow.cl
                </a>
                . Se almacenan encriptadas con AES-256-GCM y nunca salen del servidor.
              </p>
            </div>
          )}
        </div>
      </PerfilSeccion>

      <PerfilSeccion value="mercadopago" oculta={!!user?.esConsultor} icon={KeyRound} iconClassName="text-[#009ee3]" title="Conectar MercadoPago" description="Ingresa tu Access Token de producción de MercadoPago para generar links de pago. Se guarda encriptado con AES-256.">
        <div className="space-y-4">
          {mpLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Verificando conexión...</span>
            </div>
          ) : mpStatus?.configurado && !mpEditing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-[#009ee3]/5 border border-[#009ee3]/30">
                <CheckCircle2 className="h-5 w-5 text-[#009ee3] shrink-0" />
                <div>
                  <p className="text-sm font-medium">MercadoPago conectado</p>
                  <p className="text-xs text-muted-foreground">Tu Access Token está guardado y encriptado de forma segura.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setMpEditing(true)}>
                  <Plug2 className="h-3.5 w-3.5 mr-1.5" />
                  Actualizar token
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 border-destructive/30"
                  onClick={handleDeleteMp}
                  disabled={deleteMp.isPending}
                >
                  {deleteMp.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Desconectar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {mpStatus?.configurado && mpEditing && (
                <p className="text-sm text-muted-foreground">
                  Ingresa un nuevo Access Token para reemplazar el actual.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="mpAccessToken">Access Token de producción</Label>
                <div className="relative">
                  <Input
                    id="mpAccessToken"
                    type={showMpToken ? "text" : "password"}
                    placeholder="APP_USR-..."
                    value={mpAccessToken}
                    onChange={(e) => setMpAccessToken(e.target.value)}
                    className="pr-10 font-mono text-sm"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMpToken(!showMpToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showMpToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSaveMp} disabled={saveMp.isPending} className="min-w-28">
                  {saveMp.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</>
                  ) : (
                    "Guardar token"
                  )}
                </Button>
                {mpEditing && (
                  <Button variant="outline" onClick={() => setMpEditing(false)}>
                    Cancelar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Obtén tu Access Token de producción en{" "}
                <a href="https://www.mercadopago.cl/developers/panel" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  mercadopago.cl/developers
                </a>
                . Usa el token de <strong>producción</strong> (APP_USR-...). Se almacena encriptado y nunca sale del servidor.
              </p>
            </div>
          )}
        </div>
      </PerfilSeccion>

      <PerfilSeccion value="banco" oculta={!!user?.esConsultor} icon={Landmark} title="Datos bancarios para transferencias" description="Cuenta a la que tus clientes transfieren en cobros manuales. Se incluye en emails y WhatsApp cuando el cobro no tiene link de pago.">
        <DatosBancariosSection />
      </PerfilSeccion>

      <PerfilSeccion value="privacidad" oculta={!!user?.esConsultor} icon={ShieldCheck} title="Mis datos y privacidad" description="Descarga una copia de tus datos o elimina tu cuenta de forma permanente, según la Ley N° 21.719.">
        <PrivacySection />
      </PerfilSeccion>

      </Accordion>
    </div>
  );
}

// Ley 21.719: el cliente tiene derecho a saber cuándo soporte NextCob accedió
// a su cuenta. Lista las sesiones de consultor sobre esta cuenta.
function AccesosSoporte() {
  const { data, isLoading } = useQuery({
    queryKey: ["consultor-mis-accesos"],
    queryFn: async () => {
      const res = await fetch("/api/consultor/mis-accesos", { credentials: "include" });
      if (!res.ok) throw new Error("No se pudieron cargar los accesos");
      return (await res.json()) as {
        sesiones: Array<{
          id: number;
          consultorNombre: string;
          inicioEn: string;
          finEn: string | null;
          acciones: number;
        }>;
      };
    },
  });

  return (
    <div className="border-t border-border/60 pt-6">
      <p className="text-sm font-medium text-foreground">Accesos de soporte NextCob</p>
      <p className="text-sm text-muted-foreground mb-3">
        Registro de las veces que un consultor de soporte accedió a tu cuenta.
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : !data || data.sesiones.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ningún consultor ha accedido a tu cuenta.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.sesiones.map((s) => (
            <li
              key={s.id}
              className="text-sm rounded-md border border-border/50 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
            >
              <span className="font-medium">{s.consultorNombre}</span>
              <span className="text-muted-foreground text-xs">
                {new Date(s.inicioEn).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}
                {s.finEn
                  ? ` → ${new Date(s.finEn).toLocaleString("es-CL", { timeStyle: "short" })}`
                  : " (sesión abierta)"}
                {" · "}
                {s.acciones} {s.acciones === 1 ? "acción" : "acciones"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PrivacySection() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const eliminarCuenta = useEliminarCuenta();

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const data = await exportarDatos();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fecha = new Date().toISOString().slice(0, 10);
      a.download = `nextcob-mis-datos-${fecha}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Datos descargados",
        description: "Tu archivo con tus datos se descargó correctamente.",
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se pudieron descargar tus datos.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = () => {
    eliminarCuenta.mutate(
      { data: { confirmacion: "ELIMINAR" } },
      {
        onSuccess: () => {
          // The account and session are gone; send the user to the landing page.
          window.location.href = "/";
        },
        onError: (err: unknown) => {
          const msg =
            err instanceof Error
              ? err.message
              : "No se pudo eliminar la cuenta.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Descargar mis datos
            </p>
            <p className="text-sm text-muted-foreground">
              Obtén un archivo JSON con tu perfil, cobros y clientes.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={downloading}
            className="shrink-0"
          >
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Preparando...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Descargar JSON
              </>
            )}
          </Button>
        </div>

        <AccesosSoporte />

        <div className="border-t border-border/60 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-destructive">
              Eliminar mi cuenta
            </p>
            <p className="text-sm text-muted-foreground">
              Esta acción es permanente y elimina todos tus datos, cobros y
              clientes. No se puede deshacer.
            </p>
          </div>
          <Dialog
            open={deleteOpen}
            onOpenChange={(open) => {
              setDeleteOpen(open);
              if (!open) setConfirmText("");
            }}
          >
            <DialogTrigger asChild>
              <Button variant="destructive" className="shrink-0">
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar cuenta
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>¿Eliminar tu cuenta?</DialogTitle>
                <DialogDescription>
                  Esta acción es permanente e irreversible. Se eliminarán tu
                  cuenta y todos tus datos, cobros y clientes asociados. Para
                  confirmar, escribe <strong>ELIMINAR</strong> en el campo de
                  abajo.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="confirmDelete">Escribe ELIMINAR</Label>
                <Input
                  id="confirmDelete"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="ELIMINAR"
                  autoComplete="off"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteOpen(false)}
                  disabled={eliminarCuenta.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={
                    confirmText !== "ELIMINAR" || eliminarCuenta.isPending
                  }
                >
                  {eliminarCuenta.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Eliminando...
                    </>
                  ) : (
                    "Eliminar definitivamente"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
  );
}
