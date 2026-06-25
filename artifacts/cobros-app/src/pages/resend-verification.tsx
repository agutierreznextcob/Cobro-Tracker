import { useState } from "react";
import { Link } from "wouter";
import { useResendVerification } from "@workspace/api-client-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResendVerificationPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const resend = useResendVerification();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await resend.mutateAsync({ data: { email: email.trim() } });
    } catch {
      // Always succeeds to avoid leaking which emails exist.
    }
    setDone(true);
  };

  return (
    <AuthLayout
      title="Reenviar confirmación"
      subtitle={
        done
          ? undefined
          : "Te enviaremos un nuevo enlace para confirmar tu cuenta."
      }
      footer={
        <Link href="/login" className="text-primary font-medium hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      {done ? (
        <p className="text-sm text-muted-foreground text-center">
          Si existe una cuenta sin confirmar con ese correo, te enviamos un nuevo
          enlace de confirmación. Revisa tu bandeja de entrada.
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
          <Button type="submit" className="w-full" disabled={resend.isPending}>
            {resend.isPending ? "Enviando..." : "Reenviar confirmación"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
