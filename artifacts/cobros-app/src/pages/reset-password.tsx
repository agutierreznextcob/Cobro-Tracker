import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function isStrongPassword(pw: string): boolean {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

export default function ResetPasswordPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const reset = useResetPassword();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!isStrongPassword(password)) {
      setErrorMsg(
        "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.",
      );
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Las contraseñas no coinciden.");
      return;
    }
    try {
      const res = await reset.mutateAsync({
        data: { token, password, confirmPassword },
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      setErrorMsg(res.mensaje ?? "No se pudo actualizar la contraseña.");
    } catch {
      setErrorMsg("El enlace es inválido o expiró.");
    }
  };

  if (!token) {
    return (
      <AuthLayout
        title="Enlace inválido"
        footer={
          <Link
            href="/forgot-password"
            className="text-primary font-medium hover:underline"
          >
            Solicitar un nuevo enlace
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground text-center">
          El enlace de recuperación no es válido. Solicita uno nuevo.
        </p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        title="Contraseña actualizada"
        footer={
          <Link href="/login" className="text-primary font-medium hover:underline">
            Iniciar sesión
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground text-center">
          Tu contraseña fue actualizada correctamente. Ya puedes iniciar sesión.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Nueva contraseña"
      subtitle="Define una nueva contraseña para tu cuenta."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Nueva contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <p className="text-xs text-muted-foreground">
            Mínimo 8 caracteres, una mayúscula y un número.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {errorMsg ? (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {errorMsg}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={reset.isPending}>
          {reset.isPending ? "Guardando..." : "Actualizar contraseña"}
        </Button>
      </form>
    </AuthLayout>
  );
}
