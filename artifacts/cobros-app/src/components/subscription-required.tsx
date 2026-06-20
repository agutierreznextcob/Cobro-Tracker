import {
  useGetSubscriptionStatus,
  useStartSubscription,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2, Sparkles } from "lucide-react";

function formatCLP(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function SubscriptionRequired() {
  const { toast } = useToast();
  const { data: status } = useGetSubscriptionStatus();
  const startSubscription = useStartSubscription();

  const precio = status?.precioMensual ?? 22598;
  const precioNeto = status?.precioNeto ?? 18990;
  const precioIva = status?.precioIva ?? 3608;

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Lock className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Tu prueba terminó</h1>
        <p className="mt-3 text-muted-foreground">
          Suscríbete para seguir creando cobros, enviando links de pago y usando todas las
          funciones de Cobro Simple.
        </p>

        <div className="mt-8 rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-4xl font-bold tracking-tight">{formatCLP(precio)}</span>
            <span className="text-muted-foreground">/mes</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Neto {formatCLP(precioNeto)} + IVA {formatCLP(precioIva)} = Total {formatCLP(precio)} (IVA incluido)
          </p>
          <ul className="mt-5 space-y-2 text-left text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              Cobros y links de pago ilimitados
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              Dashboard en tiempo real y asistente IA
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              Cancela cuando quieras
            </li>
          </ul>
          <Button
            className="mt-6 w-full"
            size="lg"
            onClick={handleSubscribe}
            disabled={startSubscription.isPending}
          >
            {startSubscription.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirigiendo...
              </>
            ) : (
              `Suscribirme - ${formatCLP(precio)}/mes`
            )}
          </Button>
        </div>

        <a
          href="/api/logout"
          className="mt-6 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Cerrar sesión
        </a>
      </div>
    </div>
  );
}
