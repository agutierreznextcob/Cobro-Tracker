import { useGetSubscriptionStatus } from "@workspace/api-client-react";
import { Lock } from "lucide-react";
import { PlanSelector } from "@/components/plan-selector";

// Pantalla de bloqueo al terminar la prueba (o con la suscripción vencida):
// el usuario debe elegir un plan para continuar.
export function SubscriptionRequired() {
  const { data: status } = useGetSubscriptionStatus();
  const vencida = status?.status === "vencida" && status?.tieneSuscripcion;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-3xl">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {vencida ? "Tu suscripción está vencida" : "Tu prueba terminó"}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Elige un plan para seguir creando cobros, enviando links de pago y haciendo
            seguimiento de tus clientes.
          </p>
        </div>

        <div className="mt-8">
          <PlanSelector />
        </div>

        <div className="mt-6 text-center">
          <a
            href="/api/logout"
            className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Cerrar sesión
          </a>
        </div>
      </div>
    </div>
  );
}
