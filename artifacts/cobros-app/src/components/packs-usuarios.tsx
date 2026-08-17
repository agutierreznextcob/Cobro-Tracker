import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateUserPacks,
  getGetSubscriptionStatusQueryKey,
  getGetOrganizationQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Minus, Plus, Users } from "lucide-react";

// Definición de los packs de usuarios adicionales. Espejo de PACKS_USUARIOS en
// el backend (lib/plans.ts) — los precios y etiquetas deben mantenerse en sync.
export const PACKS = [
  {
    id: "individual" as const,
    nombre: "Pack Individual",
    usuarios: 1,
    neto: 9_990,
    iva: 1_898,
    total: 11_888,
    porUsuario: 9_990,
    ahorroPct: 0,
    etiqueta: null as string | null,
  },
  {
    id: "pack5" as const,
    nombre: "Pack 5 usuarios",
    usuarios: 5,
    neto: 39_990,
    iva: 7_598,
    total: 47_588,
    porUsuario: 7_998,
    ahorroPct: 20,
    etiqueta: "Buen precio",
  },
  {
    id: "pack10" as const,
    nombre: "Pack 10 usuarios",
    usuarios: 10,
    neto: 69_990,
    iva: 13_298,
    total: 83_288,
    porUsuario: 6_999,
    ahorroPct: 30,
    etiqueta: "⭐ Más popular",
  },
  {
    id: "pack20" as const,
    nombre: "Pack 20 usuarios",
    usuarios: 20,
    neto: 119_990,
    iva: 22_798,
    total: 142_788,
    porUsuario: 5_999,
    ahorroPct: 40,
    etiqueta: "💎 Mejor valor",
  },
];

export type PackUiId = (typeof PACKS)[number]["id"];

const PACK_INDIVIDUAL_TOTAL = 11_888;

export function formatCLPPacks(value: number): string {
  return `$${Math.round(value).toLocaleString("es-CL")}`;
}

// Comparativa: comprar N usuarios individuales vs el pack equivalente.
export function ahorroVsIndividual(packId: PackUiId): { individual: number; pack: number; ahorro: number } | null {
  const pack = PACKS.find((p) => p.id === packId)!;
  if (pack.usuarios <= 1) return null;
  const individual = pack.usuarios * PACK_INDIVIDUAL_TOTAL;
  return { individual, pack: pack.total, ahorro: individual - pack.total };
}

// Grid de packs de usuarios adicionales. `cantidades` (opcional) muestra los
// packs ya contratados con controles +/- para acumular o quitar packs.
// `interactivo=false` renderiza solo la comparativa (landing usa su propio
// markup, este modo es para pantallas informativas dentro de la app).
export function PacksUsuarios({
  cantidades,
  onChanged,
  compacto = false,
}: {
  cantidades?: Partial<Record<PackUiId, number>>;
  onChanged?: () => void;
  compacto?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<PackUiId>("pack10");

  const mutation = useUpdateUserPacks({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSubscriptionStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOrganizationQueryKey() });
        toast({ title: "Packs actualizados", description: "Tu cobro mensual se ajustó con el cambio." });
        onChanged?.();
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "error" in err
            ? String((err as { error?: string }).error)
            : "No se pudo actualizar el pack. Intenta nuevamente.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
      onSettled: () => setPendingPack(null),
    },
  });

  const cambiar = (pack: PackUiId, accion: "agregar" | "quitar") => {
    setPendingPack(`${pack}:${accion}`);
    mutation.mutate({ data: { pack, accion } });
  };

  const comparativa = ahorroVsIndividual(seleccion);

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", compacto ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4")}>
        {PACKS.map((pack) => {
          const cantidad = cantidades?.[pack.id] ?? 0;
          const seleccionado = seleccion === pack.id;
          return (
            <button
              key={pack.id}
              type="button"
              onClick={() => setSeleccion(pack.id)}
              className={cn(
                "relative rounded-xl border p-4 text-left transition-colors flex flex-col",
                seleccionado ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border hover:border-primary/50",
              )}
              data-testid={`pack-card-${pack.id}`}
            >
              {pack.etiqueta && (
                <span className="absolute -top-2.5 right-3 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {pack.etiqueta}
                </span>
              )}
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Users className="h-3.5 w-3.5 text-primary" />
                {pack.nombre}
              </div>
              <p className="text-lg font-bold mt-1">
                {formatCLPPacks(pack.total)}
                <span className="text-xs font-normal text-muted-foreground">/mes</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatCLPPacks(pack.neto)} + IVA {formatCLPPacks(pack.iva)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {pack.usuarios} usuario{pack.usuarios !== 1 ? "s" : ""} adicional{pack.usuarios !== 1 ? "es" : ""}
              </p>
              {pack.ahorroPct > 0 && (
                <p className="text-[11px] font-medium text-green-700 mt-0.5">
                  {formatCLPPacks(pack.porUsuario)}/usuario · Ahorras {pack.ahorroPct}%
                </p>
              )}
              {cantidades && (
                <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                  <span className="text-xs text-muted-foreground">
                    {cantidad > 0 ? `${cantidad} contratado${cantidad !== 1 ? "s" : ""}` : "No contratado"}
                  </span>
                  <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-6 w-6"
                      disabled={cantidad === 0 || mutation.isPending}
                      onClick={() => cambiar(pack.id, "quitar")}
                      data-testid={`pack-quitar-${pack.id}`}
                    >
                      {pendingPack === `${pack.id}:quitar` ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      className="h-6 w-6"
                      disabled={mutation.isPending}
                      onClick={() => cambiar(pack.id, "agregar")}
                      data-testid={`pack-agregar-${pack.id}`}
                    >
                      {pendingPack === `${pack.id}:agregar` ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                    </Button>
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      {comparativa && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-900 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-700" />
          <p>
            Si compras {PACKS.find((p) => p.id === seleccion)!.usuarios} usuarios individuales pagarías{" "}
            <span className="font-semibold">{formatCLPPacks(comparativa.individual)}/mes</span>. Con el{" "}
            {PACKS.find((p) => p.id === seleccion)!.nombre} pagas{" "}
            <span className="font-semibold">{formatCLPPacks(comparativa.pack)}/mes</span>.{" "}
            <span className="font-bold">Ahorras {formatCLPPacks(comparativa.ahorro)} al mes.</span>
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Los packs se suman a tu cobro mensual y se acumulan (puedes tener más de uno). Al quitar un
        pack, se descuenta del próximo cobro mensual.
      </p>
    </div>
  );
}
