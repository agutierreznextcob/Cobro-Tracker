import { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import { useLoginUser } from "@workspace/api-client-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const search = useSearch();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recordarme, setRecordarme] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noVerificado, setNoVerificado] = useState(false);
  const login = useLoginUser();

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("verificado") === "1") {
      toast({
        title: "Correo confirmado",
        description: "Tu cuenta fue verificada. Ya puedes iniciar sesión.",
      });
    } else if (params.get("verificado") === "0") {
      toast({
        title: "No pudimos confirmar tu correo",
        description: "El enlace es inválido o expiró. Solicita uno nuevo.",
        variant: "destructive",
      });
    }
  }, [search, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoVerificado(false);
    if (!email.trim() || !password) {
      setErrorMsg("Ingresa tu correo y contraseña.");
      return;
    }
    try {
      const res = await login.mutateAsync({
        data: { email: email.trim(), password, recordarme },
      });
      if (res.ok) {
        const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
        // returnTo: solo rutas internas (ej. volver a /invitacion/:token tras
        // iniciar sesión). Se rechaza cualquier URL absoluta o externa.
        const returnTo = new URLSearchParams(search).get("returnTo");
        let dest = "/dashboard";
        if (returnTo && returnTo.startsWith("/") && !returnTo.includes("\\")) {
          // Anti open-redirect: parsear contra el origin actual y exigir que
          // el resultado siga siendo mismo-origen (rechaza "//host" y "/\host").
          try {
            const url = new URL(returnTo, window.location.origin);
            if (url.origin === window.location.origin) {
              dest = url.pathname + url.search;
            }
          } catch {
            /* dest queda en /dashboard */
          }
        }
        window.location.href = `${base}${dest}`;
        return;
      }
      if (res.code === "email_no_verificado") setNoVerificado(true);
      setErrorMsg(res.mensaje ?? "No se pudo iniciar sesión.");
    } catch {
      setErrorMsg("Correo o contraseña incorrectos.");
    }
  };

  return (
    <AuthLayout
      title="Inicia sesión"
      subtitle="Ingresa a tu cuenta de NextCob"
      footer={
        <>
          ¿No tienes cuenta?{" "}
          <Link href="/register" className="text-primary font-medium hover:underline">
            Crear cuenta
          </Link>
        </>
      }
    >
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
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              checked={recordarme}
              onCheckedChange={(v) => setRecordarme(v === true)}
            />
            Recordarme
          </label>
          <Link
            href="/forgot-password"
            className="text-sm text-primary hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        {errorMsg ? (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {errorMsg}
            {noVerificado ? (
              <>
                {" "}
                <Link
                  href="/resend-verification"
                  className="font-medium underline"
                >
                  Reenviar confirmación
                </Link>
              </>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? "Ingresando..." : "Iniciar sesión"}
        </Button>

        <div className="flex justify-end">
          <Link
            href="/consultor"
            className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
          >
            Acceso consultor
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
