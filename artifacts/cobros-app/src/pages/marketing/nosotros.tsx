import { MarketingShell, usePageMeta, PageHeader, ClosingBand } from "@/components/marketing/marketing-shell";

const PRINCIPLES = [
  { t: "Decir lo que hace. Y lo que no.", d: "Si algo no está integrado, como el SII, lo decimos. Si Diana no puede ejecutar una acción, también." },
  { t: "Cada moneda en su lugar.", d: "Los informes analizan importes por moneda, sin mezclarlas. Los indicadores muestran su fecha de actualización." },
  { t: "Tu precio lo decides tú.", d: "Una compra actualiza costos y sugiere un precio, pero nunca cambia tu precio de venta sin que lo apruebes." },
  { t: "La opinión del cliente es tuya.", d: "Los comentarios privados se quedan en NextCob. La invitación a Google es voluntaria y para todas las calificaciones." },
];

export default function NosotrosPage() {
  usePageMeta(
    "Nosotros · NextCob",
    "NextCob nació para ordenar la cobranza de los negocios en Chile y creció hasta cubrir ventas, compras, stock e informes.",
  );
  return (
    <MarketingShell>
      <PageHeader
        kicker="Nosotros"
        title={<>Empezamos por la cobranza. <span className="text-[#0D6E6E]">Seguimos por todo lo demás.</span></>}
        lead="Construido en Santiago para negocios chilenos que venden, compran y cobran todos los días."
      />

      <section className="border-b border-[#0A0A0A]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 grid md:grid-cols-12 gap-10">
          <div className="md:col-span-7 space-y-5 text-lg leading-relaxed text-neutral-800">
            <p>
              Vimos de cerca cómo las empresas pierden control sobre su dinero, no porque no vendan,
              sino porque no cobran a tiempo. Así nació NextCob.
            </p>
            <p>
              Con el uso apareció lo obvio: para cobrar bien hay que saber qué se vendió, a qué costo
              y desde qué bodega. Por eso sumamos cotizaciones, inventario, locales y bodegas,
              compras a proveedores e informes por área.
            </p>
          </div>
          <div className="md:col-span-5 border border-[#0A0A0A] p-7 self-start">
            <p className="nc-kicker mb-3">Misión</p>
            <p className="nc-display text-2xl leading-snug">Que un negocio pequeño vea su operación completa en un solo lugar.</p>
          </div>
        </div>
      </section>

      <section>
        <div className="max-w-7xl mx-auto grid sm:grid-cols-2">
          {PRINCIPLES.map((p, i) => (
            <div key={p.t} className={`px-5 sm:px-8 py-12 border-b nc-rule ${i % 2 === 0 ? "sm:border-r" : ""}`}>
              <span className="nc-mono text-xs text-[#E86B2A]">0{i + 1}</span>
              <h2 className="nc-display text-2xl mt-3">{p.t}</h2>
              <p className="mt-3 text-neutral-700 leading-relaxed">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#FBFAF7]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14 grid sm:grid-cols-2 gap-6">
          <div>
            <p className="nc-kicker mb-2">Escríbenos</p>
            <a href="mailto:contacto@nextcob.com" className="nc-display text-2xl hover:text-[#E86B2A]">contacto@nextcob.com</a>
          </div>
          <div>
            <p className="nc-kicker mb-2">Dónde estamos</p>
            <p className="nc-display text-2xl">Santiago, Chile</p>
          </div>
        </div>
      </section>
      <ClosingBand />
    </MarketingShell>
  );
}
