import { useState } from "react";
import {
  useGetSubscriptionStatus,
  useStartSubscription,
  useCambiarPlanSubscription,
  useJoinProWaitlist,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { Check, Loader2, Lock, Sparkles, Star } from "lucide-react";

function formatCLP(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

// Redirige al checkout de Reveniu vía form POST con el input oculto TBK_TOKEN
// (Transbank OneClick).
function redirectToReveniu(completionUrl: string, securityToken: string) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = completionUrl;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "TBK_TOKEN";
  input.value = securityToken;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

const PLANES_UI = {
  starter: {
    nombre: "Starter",
    neto: 14990,
    iva: 2848,
    total: 17838,
    descripcion: "Para quienes empiezan a ordenar su cobranza.",
    incluye: [
      "1 usuario",
      "Cobros y links de pago ilimitados",
      "Clientes y abonos",
      "Recordatorios manuales",
      "Dashboard y reportes básicos",
    ],
    bloqueado: [
      "Workflows inteligentes",
      "Scoring predictivo",
      "Asistente IA",
      "Recordatorios automáticos",
      "Informes avanzados",
      "Equipos (más usuarios)",
    ],
  },
  nextcob: {
    nombre: "NextCob",
    neto: 24990,
    iva: 4748,
    total: 29738,
    descripcion: "Todo NextCob, sin límites de funciones.",
    incluye: [
      "2 usuarios incluidos (agrega más cuando quieras)",
      "Todo lo del plan Starter",
      "Workflows inteligentes",
      "Scoring predictivo y probabilidad de pago",
      "Asistente IA",
      "Recordatorios automáticos por email y WhatsApp",
      "Informes avanzados y rendimiento de equipo",
    ],
    bloqueado: [] as string[],
  },
} as const;

function errorMsg(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error && err.message ? err.message : fallback)
  );
}

// Selector de planes: se usa en la pantalla de fin de prueba y en el diálogo
// "Ver planes" del perfil. Si el usuario ya tiene una suscripción activa,
// elegir otro plan hace un cambio de plan (Reveniu actualiza el monto); si no,
// inicia el checkout de Reveniu con el plan elegido.
export function PlanSelector({ onPlanCambiado }: { onPlanCambiado?: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: status } = useGetSubscriptionStatus();
  const [pendingPlan, setPendingPlan] = useState<"starter" | "nextcob" | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistOk, setWaitlistOk] = useState(false);

  const tieneActiva = status?.status === "activa" && status?.tieneSuscripcion;
  const planActual = tieneActiva ? (status?.plan ?? "nextcob") : null;

  const start = useStartSubscription({
    mutation: {
      onSuccess: (data) => redirectToReveniu(data.completionUrl, data.securityToken),
      onError: (err: unknown) => {
        setPendingPlan(null);
        toast({
          title: "Error",
          description: errorMsg(err, "No se pudo iniciar la suscripción. Intenta nuevamente."),
          variant: "destructive",
        });
      },
    },
  });
  const cambiar = useCambiarPlanSubscription({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Plan actualizado",
          description: `Ahora estás en el plan ${data.plan === "starter" ? "Starter" : "NextCob"}. El próximo cobro será de ${formatCLP(data.totalMensual)}.`,
        });
        onPlanCambiado?.();
        // El plan afecta gates de funciones en toda la app: recarga completa.
        setTimeout(() => window.location.reload(), 800);
      },
      onError: (err: unknown) => {
        setPendingPlan(null);
        toast({
          title: "Error",
          description: errorMsg(err, "No se pudo cambiar el plan. Intenta nuevamente."),
          variant: "destructive",
        });
      },
    },
  });
  const waitlist = useJoinProWaitlist({
    mutation: {
      onSuccess: () => setWaitlistOk(true),
      onError: (err: unknown) =>
        toast({
          title: "Error",
          description: errorMsg(err, "No se pudo guardar tu email."),
          variant: "destructive",
        }),
    },
  });

  const elegir = (plan: "starter" | "nextcob") => {
    setPendingPlan(plan);
    if (tieneActiva) {
      cambiar.mutate({ data: { plan } });
    } else {
      start.mutate({ data: { plan } });
    }
  };

  const busy = start.isPending || cambiar.isPending;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["starter", "nextcob"] as const).map((id) => {
          const p = PLANES_UI[id];
          const esActual = planActual === id;
          const destacado = id === "nextcob";
          return (
            <div
              key={id}
              className={`relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm ${
                destacado ? "border-primary ring-1 ring-primary" : "border-border/60"
              }`}
              data-testid={`card-plan-${id}`}
            >
              {destacado && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 gap-1">
                  <Star className="h-3 w-3" /> Recomendado
                </Badge>
              )}
              <h3 className="text-lg font-semibold">{p.nombre}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.descripcion}</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight">{formatCLP(p.neto)}</span>
                <span className="text-sm text-muted-foreground">+ IVA/mes</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Total {formatCLP(p.total)}/mes, IVA incluido
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {p.incluye.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
                {p.bloqueado.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-muted-foreground">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-5 w-full"
                variant={destacado ? "default" : "outline"}
                disabled={busy || esActual}
                onClick={() => elegir(id)}
                data-testid={`button-elegir-${id}`}
              >
                {busy && pendingPlan === id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...
                  </>
                ) : esActual ? (
                  "Tu plan actual"
                ) : tieneActiva ? (
                  `Cambiar a ${p.nombre}`
                ) : (
                  `Elegir ${p.nombre}`
                )}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Pro</h3>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" /> Próximamente
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Para equipos grandes y cobranza a gran escala. Déjanos tu email y te avisamos.
            </p>
          </div>
          {waitlistOk ? (
            <p className="text-sm font-medium text-primary">¡Listo! Te avisaremos.</p>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                waitlist.mutate({ data: { email: waitlistEmail || user?.email || "" } });
              }}
            >
              <Input
                type="email"
                placeholder={user?.email ?? "tu@email.cl"}
                value={waitlistEmail}
                onChange={(e) => setWaitlistEmail(e.target.value)}
                className="h-9 w-52"
                data-testid="input-waitlist-email"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={waitlist.isPending}
                data-testid="button-waitlist"
              >
                {waitlist.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unirme a lista de espera"}
              </Button>
            </form>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Registras tu tarjeta una sola vez (Transbank) y el cobro mensual es automático. Cancela cuando quieras.
      </p>
    </div>
  );
}
