import { MarketingShell, usePageMeta, PageHeader, RegisterButton, DemoButton } from "@/components/marketing/marketing-shell";

const PLANS = [
  { name: "Starter", for: "Para negocios que empiezan a ordenar ventas y cobros.", status: "Precio por confirmar", featured: false, available: true },
  { name: "NextCob", for: "Para negocios que quieren usar el sistema completo.", status: "Precio por confirmar", featured: true, available: true },
  { name: "Pro", for: "Consulta las opciones para las necesidades de tu equipo.", status: "Precio por confirmar", featured: false, available: true },
];

const FAQ = [
  { q: "¿Cuánto cuesta?", a: "Los valores de cada plan están por confirmar. Escríbenos o agenda una presentación y te contamos las condiciones vigentes." },
  { q: "¿Qué módulos incluye cada plan?", a: "El detalle de módulos, usuarios y límites por plan se confirma al contratar. Te lo informamos antes de que pagues cualquier cosa." },
  { q: "¿Cómo funciona la prueba?", a: "Al crear tu cuenta tienes 14 días de prueba para usar NextCob con tus propios datos." },
  { q: "¿Los valores incluyen IVA?", a: "Se informará junto con el precio de cada plan." },
];

export default function PreciosPage() {
  usePageMeta(
    "Precios de NextCob · Planes y prueba de 14 días",
    "Planes Starter, NextCob y Pro. Precios por confirmar. Crea tu cuenta y prueba NextCob 14 días.",
  );
  return (
    <MarketingShell>
      <PageHeader
        kicker="Precios"
        title={<>Precios <span className="text-[#E86B2A]">por confirmar.</span></>}
        lead="Estamos actualizando nuestros planes para reflejar todos los módulos actuales. Mientras tanto, puedes probar NextCob 14 días."
      />

      <section>
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14 grid md:grid-cols-3 gap-6">
          {PLANS.map((p) => (
            <div
              key={p.name}
              data-testid={`card-plan-${p.name.toLowerCase()}`}
              className={`flex flex-col border p-7 ${p.featured ? "border-[#0A0A0A] border-t-[6px] border-t-[#E86B2A] shadow-[8px_8px_0_0_#F4A800]" : "border-[#0A0A0A]"}`}
            >
              <div className="flex items-center justify-between">
                <p className="nc-kicker">Plan</p>
                {!p.available && <span className="nc-mono text-[10px] uppercase border border-[#0D6E6E] text-[#0D6E6E] px-2 py-0.5">Próximamente</span>}
              </div>
              <h2 className="nc-display text-4xl mt-3">{p.name}</h2>
              <p className="mt-3 text-sm text-neutral-600 min-h-[2.5rem]">{p.for}</p>
              <p className="mt-8 py-4 border-y nc-rule nc-mono text-sm font-semibold" data-testid={`text-price-${p.name.toLowerCase()}`}>{p.status}</p>
              <div className="mt-8 flex-1 flex flex-col justify-end gap-2">
                {p.available ? (
                  <RegisterButton className="w-full py-3" label="Comenzar 14 días de prueba" />
                ) : (
                  <DemoButton className="w-full py-3" label="Consultar disponibilidad" />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#FBFAF7] border-t border-[#0A0A0A]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 grid md:grid-cols-12 gap-10">
          <div className="md:col-span-4">
            <p className="nc-kicker mb-3">Preguntas</p>
            <h2 className="nc-display text-3xl">Antes de decidir</h2>
            <div className="mt-6"><DemoButton className="px-5 py-3" label="Hablar con nosotros" /></div>
          </div>
          <dl className="md:col-span-8 border-t border-[#0A0A0A]">
            {FAQ.map((f) => (
              <div key={f.q} className="grid sm:grid-cols-3 gap-2 py-5 border-b nc-rule">
                <dt className="font-semibold">{f.q}</dt>
                <dd className="sm:col-span-2 text-neutral-700 text-sm leading-relaxed">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </MarketingShell>
  );
}
