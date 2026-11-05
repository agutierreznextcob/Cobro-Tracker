import { AlertTriangle, Archive, Ban, CheckCircle2, Wrench } from "lucide-react";
import type { EstadoVisual } from "@/lib/inventario";

const MAP: Record<EstadoVisual, { label: string; cls: string; Icon: typeof Ban }> = {
  normal: { label: "Normal", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  critico: { label: "Stock crítico", cls: "bg-red-600 text-white border-red-600", Icon: AlertTriangle },
  agotado: { label: "Agotado", cls: "bg-red-50 text-red-700 border-red-300", Icon: Ban },
  servicio: { label: "Sin stock", cls: "bg-sky-50 text-sky-700 border-sky-200", Icon: Wrench },
  archivado: { label: "Archivado", cls: "bg-muted text-muted-foreground border-border", Icon: Archive },
};

export function EstadoStockBadge({ estado }: { estado: EstadoVisual }) {
  const { label, cls, Icon } = MAP[estado];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function TipoBadge({ tipo }: { tipo: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
        tipo === "servicio" ? "bg-sky-100 text-sky-800" : "bg-primary/10 text-primary"
      }`}
    >
      {tipo === "servicio" ? "Servicio" : "Producto"}
    </span>
  );
}
