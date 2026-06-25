import { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const forgot = useForgotPassword();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await forgot.mutateAsync({ data: { email: email.trim() } });
    } catch {
      // The endpoint always succeeds to avoid leaking which emails exist.
    }
    setDone(true);
  };

  return (
    <AuthLayout
      title="Recuperar contraseña"
      subtitle={
        done
          ? undefined
          : "Te enviaremos un enlace para restablecer tu contraseña."
      }
      footer={
        <Link href="/login" className="text-primary font-medium hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      {done ? (
        <p className="text-sm text-muted-foreground text-center">
          Si existe una cuenta con ese correo, te enviamos un enlace para
          restablecer tu contraseña. El enlace expira en 1 hora.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@empresa.cl"
            />
          </div>
          <Button type="submit" className="w-full" disabled={forgot.isPending}>
            {forgot.isPending ? "Enviando..." : "Enviar enlace"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
