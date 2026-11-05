import { ESTADO_COTIZACION, type EstadoCotizacion } from "@/lib/cotizaciones";

export function EstadoCotizacionBadge({ estado }: { estado: EstadoCotizacion }) {
  const m = ESTADO_COTIZACION[estado] ?? ESTADO_COTIZACION.borrador;
  return (
    <span
      data-testid={`status-cotizacion-${estado}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
