import { useEffect } from "react";
import { Check, Info } from "lucide-react";
import { MarketingShell, usePageMeta, PageHeader, DemoButton, ClosingBand } from "@/components/marketing/marketing-shell";
import { MODULES } from "@/components/marketing/marketing-content";

export default function CaracteristicasPage() {
  usePageMeta(
    "Características de NextCob · Módulos actuales",
    "Ventas y cobros, cotizaciones, clientes, inventario con pistola lectora y calculadora de precios, locales y bodegas, compras, informes, satisfacción, configuración y Diana.",
  );

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <MarketingShell>
      <PageHeader
        kicker="Características"
        title={<>Diez módulos. <span className="text-[#E86B2A]">Cada uno, completo.</span></>}
        lead="Lo que NextCob hace hoy, módulo por módulo, incluyendo los límites que conviene conocer antes de empezar."
      >
        <DemoButton className="px-5 py-3" label="Verlo en una presentación" />
      </PageHeader>

      <div className="max-w-7xl mx-auto grid lg:grid-cols-12">
        <aside className="hidden lg:block lg:col-span-3 border-r nc-rule">
          <nav aria-label="Módulos" className="sticky top-16 py-10 px-8">
            <p className="nc-kicker mb-4">Índice</p>
            <ul className="space-y-1 text-sm">
              {MODULES.map((m) => (
                <li key={m.id}>
                  <a href={`#${m.id}`} className="flex gap-3 py-1.5 hover:text-[#E86B2A]">
                    <span className="nc-mono text-xs text-neutral-400 pt-0.5">{m.code}</span>
                    {m.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="lg:col-span-9">
          {MODULES.map((m, i) => (
            <article key={m.id} id={m.id} className="scroll-mt-20 border-b nc-rule px-5 sm:px-10 py-12 grid md:grid-cols-12 gap-6">
              <div className="md:col-span-5">
                <div className="flex items-center gap-3">
                  <span className={`h-10 w-10 inline-flex items-center justify-center ${i % 3 === 0 ? "bg-[#E86B2A] text-[#0A0A0A]" : i % 3 === 1 ? "bg-[#0D6E6E] text-white" : "bg-[#F4A800] text-[#0A0A0A]"}`}>
                    <m.icon className="h-5 w-5" />
                  </span>
                  <span className="nc-mono text-xs text-neutral-500">{m.code} · {m.group}</span>
                </div>
                <h2 className="nc-display text-3xl mt-5">{m.name}</h2>
                <p className="mt-3 text-neutral-700 leading-relaxed">{m.short}</p>
              </div>
              <div className="md:col-span-7">
                <ul className="border-t border-[#0A0A0A]">
                  {m.points.map((p) => (
                    <li key={p} className="flex gap-3 py-3 border-b nc-rule text-sm leading-relaxed">
                      <Check className="h-4 w-4 mt-0.5 shrink-0 text-[#0D6E6E]" />
                      {p}
                    </li>
                  ))}
                </ul>
                {m.note && (
                  <p className="mt-4 flex gap-3 bg-[#FBFAF7] border-l-4 border-[#F4A800] px-4 py-3 text-sm text-neutral-700">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    {m.note}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
      <ClosingBand title="¿Quieres ver un módulo en particular?" />
    </MarketingShell>
  );
}
