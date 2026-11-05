import { ESTADO_COMPRA, type EstadoCompra } from "@/lib/compras";

export function EstadoCompraBadge({ estado }: { estado: string }) {
  const m = ESTADO_COMPRA[estado as EstadoCompra] ?? ESTADO_COMPRA.borrador;
  return (
    <span data-testid={`status-compra-${estado}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
