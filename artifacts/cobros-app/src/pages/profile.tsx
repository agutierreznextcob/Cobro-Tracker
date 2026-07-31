import { useState, useEffect, useRef } from "react";
import {
  useGetFlowCredentials,
  useSaveFlowCredentials,
  useDeleteFlowCredentials,
  useGetMpCredentials,
  useSaveMpCredentials,
  useDeleteMpCredentials,
  getGetMpCredentialsQueryKey,
  useGetSubscriptionStatus,
  useStartSubscription,
  useStartPrepago,
  getGetSubscriptionStatusQueryKey,
  useCompletarPerfil,
  exportarDatos,
  useEliminarCuenta,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, type AuthUser } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { OrgRoleBadge } from "@/components/org-role-badge";
import { Loader2, CheckCircle2, Plug2, Trash2, Eye, EyeOff, User, KeyRound, CreditCard, Sparkles, IdCard, Mail, Pencil, Camera, ShieldCheck, Download } from "lucide-react";

// Prepago: pay 1/3/6/12 months upfront via a one-off Flow payment. Shows the
// full Neto + IVA = Total breakdown (base plan + extra seats) before paying.
type SubStatusLike = {
  totalNetoMensual?: number;
  totalIvaMensual?: number;
  totalMensual?: number;
  precioNeto: number;
  precioIva: number;
  precioMensual: number;
  usuariosAdicionales?: number;
};

const PREPAGO_OPCIONES: { meses: 1 | 3 | 6 | 12; label: string }[] = [
  { meses: 1, label: "1 mes" },
  { meses: 3, label: "3 meses" },
  { meses: 6, label: "6 meses" },
  { meses: 12, label: "12 meses" },
];

function PrepagoSection({
  subStatus,
  meses,
  setMeses,
  onPagar,
  pending,
}: {
  subStatus: SubStatusLike;
  meses: 1 | 3 | 6 | 12;
  setMeses: (m: 1 | 3 | 6 | 12) => void;
  onPagar: () => void;
  pending: boolean;
}) {
  const netoMensual = subStatus.totalNetoMensual ?? subStatus.precioNeto;
  const ivaMensual = subStatus.totalIvaMensual ?? subStatus.precioIva;
  const totalMensual = subStatus.totalMensual ?? subStatus.precioMensual;
  const neto = netoMensual * meses;
  const iva = ivaMensual * meses;
  const total = neto + iva;

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Pagar por adelantado</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Paga 1, 3, 6 o 12 meses de una vez y extiende la vigencia de tu suscripción.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PREPAGO_OPCIONES.map((op) => (
          <button
            key={op.meses}
            type="button"
            onClick={() => setMeses(op.meses)}
            className={`rounded-md border px-2 py-1.5 text-sm font-medium transition-colors ${
              meses === op.meses
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {op.label}
          </button>
        ))}
      </div>
      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
        <p>
          Mensual: Neto {formatCLP(netoMensual)} + IVA {formatCLP(ivaMensual)} = {formatCLP(totalMensual)}
          {(subStatus.usuariosAdicionales ?? 0) > 0 &&
            ` (incluye ${subStatus.usuariosAdicionales} usuario${subStatus.usuariosAdicionales !== 1 ? "s" : ""} extra)`}
        </p>
        <p className="font-medium text-foreground">
          Total {meses} {meses === 1 ? "mes" : "meses"}: Neto {formatCLP(neto)} + IVA {formatCLP(iva)} = {formatCLP(total)} (IVA incl.)
        </p>
      </div>
      <Button onClick={onPagar} disabled={pending} className="w-full sm:w-auto">
        {pending ? (
          <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirigiendo a Flow...</>
        ) : (
          `Pagar ${formatCLP(total)} con Flow`
        )}
      </Button>
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
  const startSubscription = useStartSubscription();
  const startPrepago = useStartPrepago();
  const [prepagoMeses, setPrepagoMeses] = useState<1 | 3 | 6 | 12>(1);

  const handlePrepago = () => {
    startPrepago.mutate(
      { data: { meses: prepagoMeses } },
      {
        onSuccess: (data) => {
          window.location.href = data.url;
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo iniciar el pago anticipado.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  const handleSubscribe = () => {
    startSubscription.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "No se pudo iniciar la suscripción.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    });
  };

  // Handle the redirect back from Flow's card-registration page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prepagoRet = params.get("prepago");
    if (prepagoRet === "retorno") {
      toast({
        title: "Pago en proceso",
        description:
          "Si el pago fue exitoso, tu suscripción se extenderá en unos segundos. Actualiza la página para ver la nueva fecha de vencimiento.",
      });
      queryClient.invalidateQueries({ queryKey: getGetSubscriptionStatusQueryKey() });
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
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

      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Información de cuenta
            </CardTitle>
            {user && <EditProfileDialog user={user} />}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
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
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            Suscripción
          </CardTitle>
          <CardDescription>Tu plan de NextCob.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
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
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">Suscripción activa</p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {subStatus.periodEnd
                      ? `Vigente hasta: ${formatFecha(subStatus.periodEnd)}`
                      : `Plan mensual ${formatCLP(subStatus.precioNeto)} + IVA/mes`}
                  </p>
                  <p className="text-xs text-green-600/80 dark:text-green-400/80 mt-0.5">
                    {(subStatus.usuariosAdicionales ?? 0) > 0
                      ? `Plan base ${formatCLP(subStatus.precioMensual)} + ${subStatus.usuariosAdicionales} usuario${subStatus.usuariosAdicionales !== 1 ? "s" : ""} extra × ${formatCLP(subStatus.costoUsuarioAdicional ?? 0)} = ${formatCLP(subStatus.totalMensual ?? subStatus.precioMensual)}/mes (IVA incl.)`
                      : `Neto ${formatCLP(subStatus.precioNeto)} + IVA ${formatCLP(subStatus.precioIva)} = Total ${formatCLP(subStatus.precioMensual)}/mes (IVA incl.)`}
                  </p>
                </div>
              </div>
              <PrepagoSection
                subStatus={subStatus}
                meses={prepagoMeses}
                setMeses={setPrepagoMeses}
                onPagar={handlePrepago}
                pending={startPrepago.isPending}
              />
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
                  <p className="text-xs text-blue-600/80 dark:text-blue-400/80 mt-0.5">
                    Luego: Neto {formatCLP(subStatus.precioNeto)} + IVA {formatCLP(subStatus.precioIva)} = Total {formatCLP(subStatus.precioMensual)}/mes (IVA incl.)
                  </p>
                </div>
              </div>
              <Button onClick={handleSubscribe} disabled={startSubscription.isPending} className="w-full sm:w-auto">
                {startSubscription.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirigiendo...</>
                ) : (
                  `Suscribirme - ${formatCLP(subStatus.precioNeto)} + IVA/mes`
                )}
              </Button>
              <PrepagoSection
                subStatus={subStatus}
                meses={prepagoMeses}
                setMeses={setPrepagoMeses}
                onPagar={handlePrepago}
                pending={startPrepago.isPending}
              />
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
              <Button onClick={handleSubscribe} disabled={startSubscription.isPending} className="w-full sm:w-auto">
                {startSubscription.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirigiendo...</>
                ) : (
                  `Suscribirme - ${formatCLP(subStatus?.precioNeto ?? 24990)} + IVA/mes`
                )}
              </Button>
              {subStatus && (
                <PrepagoSection
                  subStatus={subStatus}
                  meses={prepagoMeses}
                  setMeses={setPrepagoMeses}
                  onPagar={handlePrepago}
                  pending={startPrepago.isPending}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {user?.orgRole === "admin_org" && <TeamSection />}

      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Conectar Flow
          </CardTitle>
          <CardDescription>
            Ingresa tus credenciales de Flow para generar links de pago reales. Se guardan encriptadas con AES-256.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
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
        </CardContent>
      </Card>

      {/* MercadoPago credentials card */}
      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#009ee3]" />
            Conectar MercadoPago
          </CardTitle>
          <CardDescription>
            Ingresa tu Access Token de producción de MercadoPago para generar links de pago. Se guarda encriptado con AES-256.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
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
        </CardContent>
      </Card>

      <PrivacySection />
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
    <Card className="shadow-sm border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Mis datos y privacidad
        </CardTitle>
        <CardDescription>
          Descarga una copia de tus datos o elimina tu cuenta de forma
          permanente, según la Ley N° 21.719.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
      </CardContent>
    </Card>
  );
}
