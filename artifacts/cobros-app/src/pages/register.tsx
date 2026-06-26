import { useState } from "react";
import { Link } from "wouter";
import { useRegisterUser } from "@workspace/api-client-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { isValidRut, formatRut } from "@/lib/rut";

function isStrongPassword(pw: string): boolean {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

export default function RegisterPage() {
  const [nombre, setNombre] = useState("");
  const [rut, setRut] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [aceptaPolitica, setAceptaPolitica] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const register = useRegisterUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!nombre.trim()) {
      setErrorMsg("Ingresa tu nombre.");
      return;
    }
    if (!isValidRut(rut)) {
      setErrorMsg("El RUT no es válido.");
      return;
    }
    if (!email.trim()) {
      setErrorMsg("Ingresa tu correo electrónico.");
      return;
    }
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
    if (!aceptaPolitica) {
      setErrorMsg(
        "Debes aceptar la Política de Privacidad y los Términos de Uso.",
      );
      return;
    }

    try {
      const res = await register.mutateAsync({
        data: {
          nombre: nombre.trim(),
          rut: formatRut(rut),
          email: email.trim(),
          password,
          confirmPassword,
          aceptaPolitica,
        },
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      setErrorMsg(res.mensaje ?? "No se pudo crear la cuenta.");
    } catch {
      setErrorMsg("No se pudo crear la cuenta. Intenta nuevamente.");
    }
  };

  if (done) {
    return (
      <AuthLayout
        title="¡Cuenta creada!"
        subtitle="Te enviamos un correo para confirmar tu cuenta."
        footer={
          <Link href="/login" className="text-primary font-medium hover:underline">
            Volver a iniciar sesión
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground text-center">
          Revisa tu bandeja de entrada y haz clic en el enlace de confirmación
          para activar tu cuenta. Si no lo ves, revisa tu carpeta de spam.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Crear cuenta"
      subtitle="Comienza tu prueba gratis de 14 días"
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Iniciar sesión
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre completo</Label>
          <Input
            id="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Juan Pérez"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rut">RUT</Label>
          <Input
            id="rut"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            onBlur={() => rut && setRut(formatRut(rut))}
            placeholder="12.345.678-9"
          />
        </div>
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
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
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

        <div className="flex items-start gap-2.5 pt-1">
          <Checkbox
            id="aceptaPolitica"
            checked={aceptaPolitica}
            onCheckedChange={(checked) => setAceptaPolitica(checked === true)}
            className="mt-0.5"
          />
          <Label
            htmlFor="aceptaPolitica"
            className="text-sm font-normal leading-snug text-muted-foreground cursor-pointer"
          >
            Acepto la{" "}
            <Link
              href="/privacidad"
              className="text-primary font-medium hover:underline"
            >
              Política de Privacidad
            </Link>{" "}
            y los{" "}
            <Link
              href="/terminos"
              className="text-primary font-medium hover:underline"
            >
              Términos de Uso
            </Link>
            .
          </Label>
        </div>

        {errorMsg ? (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {errorMsg}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? "Creando cuenta..." : "Crear cuenta"}
        </Button>
      </form>
    </AuthLayout>
  );
}
