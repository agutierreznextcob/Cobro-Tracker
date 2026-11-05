import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, AlertTriangle } from "lucide-react";
import type { IndicadorEconomico } from "@workspace/api-client-react";
import { useIndicadores, indicadorPorCodigo, fmtCLP, fmtPct, fmtFechaHora, esObsoleto } from "@/hooks/use-indicadores";

const ITEMS: { codigo: IndicadorEconomico["codigo"]; label: string; dec: number; mobile: boolean }[] = [
  { codigo: "uf", label: "UF", dec: 2, mobile: true },
  { codigo: "dolar", label: "USD", dec: 2, mobile: true },
  { codigo: "euro", label: "EUR", dec: 2, mobile: false },
  { codigo: "utm", label: "UTM", dec: 0, mobile: false },
];

function Item({ label, ind, dec }: { label: string; ind?: IndicadorEconomico; dec: number }) {
  if (!ind) return <span className="whitespace-nowrap"><span className="font-semibold text-foreground/80">{label}</span> <span className="text-muted-foreground">sin dato</span></span>;
  const v = ind.variacion;
  return (
    <span title={`Valor publicado: ${ind.fecha}. Comparación: ${ind.fechaAnterior ?? "sin dato anterior"}.`} className="whitespace-nowrap inline-flex items-baseline gap-1.5" data-testid={`indicador-${ind.codigo}`}>
      <span className="font-semibold tracking-wide text-foreground/70">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{fmtCLP(ind.valor, dec)}</span>
      {v != null && v !== 0 && (
        <span className={`inline-flex items-center font-mono text-[11px] ${v > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} aria-label={`${v > 0 ? "subió" : "bajó"} ${fmtPct(v)}`}>
          {v > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{fmtPct(v)}
        </span>
      )}
    </span>
  );
}

function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>("[data-scroll-container]");
    const check = () => {
      const y = Math.max(window.scrollY, main && main.scrollHeight > main.clientHeight ? main.scrollTop : 0);
      setScrolled(y > 8);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    main?.addEventListener("scroll", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      main?.removeEventListener("scroll", check);
    };
  }, []);
  return scrolled;
}

export function IndicadoresBar() {
  const q = useIndicadores();
  const hidden = useScrolled();
  const data = q.data;
  const latest = data?.reduce<string | null>((acc, i) => (!acc || i.updatedAt > acc ? i.updatedAt : acc), null) ?? null;
  const stale = latest ? esObsoleto(latest) : false;

  let content: React.ReactNode;
  if (q.isLoading) {
    content = <div className="flex gap-6">{[0, 1, 2, 3].map((i) => <span key={i} className="h-3 w-24 rounded bg-foreground/10 animate-pulse" />)}</div>;
  } else if (q.isError && !data) {
    content = <span className="flex items-center gap-1.5 text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />Indicadores no disponibles</span>;
  } else if (!data || data.length === 0) {
    content = <span className="text-muted-foreground">Aún no hay indicadores sincronizados</span>;
  } else {
    const desk = ITEMS.map((it, idx) => (
      <span key={it.codigo} className="inline-flex items-center">
        {idx > 0 && <span className="mx-3.5 h-3 w-px bg-border" aria-hidden />}
        <Item label={it.label} ind={indicadorPorCodigo(data, it.codigo)} dec={it.dec} />
      </span>
    ));
    const mob = ITEMS.filter((i) => i.mobile).map((it) => <Item key={it.codigo} label={it.label} ind={indicadorPorCodigo(data, it.codigo)} dec={it.dec} />);
    content = (
      <>
        <div className="hidden md:flex items-center">{desk}</div>
        <div className="md:hidden flex-1 min-w-0 overflow-hidden ind-marquee-wrap">
          <div className="ind-marquee flex w-max gap-8">
            <div className="flex gap-8">{mob}</div>
            <div className="flex gap-8 ind-marquee-dup" aria-hidden>{mob}</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: hidden ? "0fr" : "1fr", opacity: hidden ? 0 : 1 }}
      aria-hidden={hidden}
      data-testid="bar-indicadores"
    >
      <div className="overflow-hidden">
        <div className="h-9 flex items-center justify-between gap-4 px-4 md:px-8 text-xs bg-secondary/70 border-b border-border/60" role="region" aria-label="Indicadores económicos">
          {content}
          {latest && (
            <span className={`hidden md:inline whitespace-nowrap text-[11px] ${stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`} data-testid="text-indicadores-actualizado">
              {stale ? "Desactualizado · " : "Actualizado "}{fmtFechaHora(latest)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
