import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetInvitacionPublica,
  getGetInvitacionPublicaQueryKey,
  useAceptarInvitacion,
  useLogoutUser,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Loader2, MailX, Users, LogIn, UserPlus } from "lucide-react";

const ORG_ROLE_LABEL: Record<string, string> = {
  admin_org: "Administrador",
  supervisor: "Supervisor",
  ejecutivo: "Ejecutivo",
};

// Página pública de aceptación de invitaciones (/invitacion/:token).
// - Sin sesión: dirige a iniciar sesión (si el correo ya tiene cuenta) o a
//   crear cuenta (el registro auto-acepta la invitación por email).
// - Con sesión y correo coincidente: botón "Unirme" que llama al endpoint de
//   aceptación y redirige al dashboard.
// - Con sesión de otro correo: pide cerrar sesión.
export default function InvitacionPage() {
  const { token } = useParams<{ token: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const { data, isLoading, error } = useGetInvitacionPublica(token, {
    query: { queryKey: getGetInvitacionPublicaQueryKey(token) },
  });
  const aceptar = useAceptarInvitacion();
  const logout = useLogoutUser();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
  const invitacionPath = `/invitacion/${token}`;

  if (isLoading || authLoading) {
    return (
      <AuthLayout title="Invitación" subtitle="Verificando invitación...">
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    );
  }

  if (error || !data?.valida) {
    return (
      <AuthLayout
        title="Invitación no válida"
        subtitle="Este enlace de invitación no es válido o ya expiró."
        footer={
          <Link href="/" className="text-primary font-medium hover:underline">
            Ir al inicio
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <MailX className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Pide a quien te invitó que te envíe una nueva invitación desde su
            sección "Mi equipo".
          </p>
        </div>
      </AuthLayout>
    );
  }

  const rolLabel = ORG_ROLE_LABEL[data.orgRole] ?? data.orgRole;
  const sesionCoincide =
    user?.email != null &&
    user.email.trim().toLowerCase() === data.email.trim().toLowerCase();

  const handleAceptar = () => {
    setErrorMsg(null);
    aceptar.mutate(
      { token },
      {
        onSuccess: () => {
          // Full reload: refresca sesión, organización y suscripción heredada.
          window.location.href = `${base}/dashboard`;
        },
        onError: (err: unknown) => {
          const msg =
            err && typeof err === "object" && "error" in err
              ? String((err as { error?: string }).error)
              : "No se pudo aceptar la invitación. Intenta nuevamente.";
          setErrorMsg(msg);
        },
      },
    );
  };

  const handleCambiarCuenta = async () => {
    try {
      await logout.mutateAsync();
    } finally {
      window.location.href = `${base}${invitacionPath}`;
    }
  };

  return (
    <AuthLayout
      title={`Te invitaron a ${data.organizacionNombre}`}
      subtitle={`Rol: ${rolLabel} · Invitación para ${data.email}`}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/30 p-4">
          <Users className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Al aceptar, tu cuenta pasará a formar parte de{" "}
            <span className="font-medium text-foreground">
              {data.organizacionNombre}
            </span>{" "}
            como <span className="font-medium text-foreground">{rolLabel}</span>.
          </p>
        </div>

        {errorMsg && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
            {errorMsg}
          </p>
        )}

        {user == null ? (
          data.emailRegistrado ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ya existe una cuenta con el correo {data.email}. Inicia sesión
                para aceptar la invitación.
              </p>
              <Button asChild className="w-full gap-2">
                <Link
                  href={`/login?returnTo=${encodeURIComponent(invitacionPath)}`}
                >
                  <LogIn className="h-4 w-4" />
                  Iniciar sesión para aceptar
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Crea tu cuenta con el correo {data.email} para unirte. Al
                confirmar tu correo quedarás dentro de la organización.
              </p>
              <Button asChild className="w-full gap-2">
                <Link
                  href={`/register?invitacion=${encodeURIComponent(token)}&email=${encodeURIComponent(data.email)}`}
                >
                  <UserPlus className="h-4 w-4" />
                  Crear cuenta y unirme
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                ¿Ya tienes cuenta?{" "}
                <Link
                  href={`/login?returnTo=${encodeURIComponent(invitacionPath)}`}
                  className="text-primary font-medium hover:underline"
                >
                  Iniciar sesión
                </Link>
              </p>
            </div>
          )
        ) : sesionCoincide ? (
          <Button
            className="w-full gap-2"
            onClick={handleAceptar}
            disabled={aceptar.isPending}
          >
            {aceptar.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uniéndote...
              </>
            ) : (
              <>
                <Users className="h-4 w-4" />
                Unirme a {data.organizacionNombre}
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Esta invitación es para <strong>{data.email}</strong>, pero tu
              sesión actual es <strong>{user.email ?? "otra cuenta"}</strong>.
              Cierra sesión e ingresa con la cuenta invitada.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleCambiarCuenta}
              disabled={logout.isPending}
            >
              Cambiar de cuenta
            </Button>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
