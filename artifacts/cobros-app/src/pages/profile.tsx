import { useState, useEffect } from "react";
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
  getGetSubscriptionStatusQueryKey,
  useCompletarPerfil,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidRut, formatRut } from "@/lib/rut";
import { TeamSection } from "@/components/team-section";
import { Loader2, CheckCircle2, Plug2, Trash2, Eye, EyeOff, User, KeyRound, CreditCard, Sparkles, IdCard, Mail } from "lucide-react";

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
    const result = params.get("suscripcion");
    if (!result) return;
    if (result === "exito") {
      toast({ title: "¡Suscripción activada!", description: "Gracias por suscribirte a Cobro Simple." });
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
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Información de cuenta
          </CardTitle>
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
              <p className="text-lg font-semibold">{displayName}</p>
              {user?.email && <p className="text-sm text-muted-foreground">{user.email}</p>}
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 border-t border-border/50 pt-6">
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
          <CardDescription>Tu plan de Cobro Simple.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          {subLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Verificando suscripción...</span>
            </div>
          ) : subStatus?.status === "activa" ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">Suscripción activa</p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  {subStatus.periodEnd
                    ? `Próximo cobro: ${formatFecha(subStatus.periodEnd)}`
                    : `Plan mensual ${formatCLP(subStatus.precioNeto)} + IVA/mes`}
                </p>
                <p className="text-xs text-green-600/80 dark:text-green-400/80 mt-0.5">
                  Neto {formatCLP(subStatus.precioNeto)} + IVA {formatCLP(subStatus.precioIva)} = Total {formatCLP(subStatus.precioMensual)} (IVA incl.)
                </p>
              </div>
            </div>
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
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <CreditCard className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Suscripción vencida</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Reactiva tu suscripción para seguir usando Cobro Simple.
                  </p>
                </div>
              </div>
              <Button onClick={handleSubscribe} disabled={startSubscription.isPending} className="w-full sm:w-auto">
                {startSubscription.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirigiendo...</>
                ) : (
                  `Suscribirme - ${formatCLP(subStatus?.precioNeto ?? 18990)} + IVA/mes`
                )}
              </Button>
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
    </div>
  );
}
