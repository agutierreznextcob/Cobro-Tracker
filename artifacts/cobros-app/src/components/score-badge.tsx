import type { ScoreCategoria } from "@workspace/api-client-react";

export const SCORE_META: Record<
  ScoreCategoria,
  { label: string; text: string; bg: string; border: string; dot: string }
> = {
  excelente: { label: "Excelente", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500" },
  bueno: { label: "Bueno", text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", dot: "bg-blue-500" },
  regular: { label: "Regular", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500" },
  riesgoso: { label: "Riesgoso", text: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", dot: "bg-orange-500" },
  critico: { label: "Crítico", text: "text-red-700", bg: "bg-red-50", border: "border-red-200", dot: "bg-red-500" },
  sin_datos: { label: "Sin historial", text: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200", dot: "bg-gray-400" },
};

export function ScoreBadge({
  score,
  categoria,
  size = "sm",
  showLabel = true,
}: {
  score: number | null;
  categoria: ScoreCategoria;
  size?: "sm" | "xs";
  showLabel?: boolean;
}) {
  const meta = SCORE_META[categoria] ?? SCORE_META.sin_datos;
  const pad = size === "xs" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold leading-none ${pad} ${meta.text} ${meta.bg} ${meta.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {score != null ? <span className="font-bold tabular-nums">{score}</span> : null}
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
}
