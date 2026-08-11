import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

// Acceso interno para consultores de soporte NextCob. Página sobria, fondo
// oscuro, sin marketing; la URL no se enlaza desde ningún menú público (solo
// un link discreto en /login).
export default function ConsultorLoginPage() {
  const [accountId, setAccountId] = useState("");
  const [tipo, setTipo] = useState<"soporte" | "admin">("soporte");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/consultor/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accountId.trim(), tipo, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "No se pudo iniciar sesión.");
      return data;
    },
    onSuccess: () => {
      const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
      window.location.href = `${base}/dashboard`;
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : "Error de acceso.");
    },
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <img
            src={`${import.meta.env.BASE_URL}brand/nextcob-logo.png`}
            alt="NextCob"
            className="h-8 w-auto opacity-80"
          />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Acceso Consultor</h1>
            <p className="text-xs text-zinc-500">Uso exclusivo del equipo NextCob</p>
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrorMsg(null);
            login.mutate();
          }}
        >
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              ID de cuenta cliente
            </label>
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="NCB-XXXXXXXXXX"
              required
              className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Tipo de acceso
            </label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "soporte" | "admin")}
              className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              <option value="soporte">Consultor de soporte</option>
              <option value="admin">Administrador NextCob (reservado)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Contraseña de consultor
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="off"
              className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          {errorMsg ? (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">
              {errorMsg}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full rounded-md bg-zinc-100 text-zinc-900 py-2 text-sm font-medium hover:bg-white disabled:opacity-60 transition-colors"
          >
            {login.isPending ? "Verificando..." : "Ingresar"}
          </button>
        </form>

        <p className="mt-8 text-[11px] leading-relaxed text-zinc-600">
          Toda sesión de consultor queda registrada (fecha, cuenta visitada y
          acciones realizadas) conforme a la Ley 21.719. El cliente puede ver
          estos accesos en su panel.
        </p>
      </div>
    </div>
  );
}
