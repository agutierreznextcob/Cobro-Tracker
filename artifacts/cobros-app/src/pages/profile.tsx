import { useState } from "react";
import { useGetFlowCredentials, useSaveFlowCredentials, useDeleteFlowCredentials } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Plug2, Trash2, Eye, EyeOff, User, KeyRound } from "lucide-react";

export default function ProfilePage() {
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
        </CardContent>
      </Card>

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
    </div>
  );
}
