import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ScanBarcode } from "lucide-react";
import { MarketingShell, usePageMeta, RegisterButton, DemoButton, ClosingBand } from "@/components/marketing/marketing-shell";
import { MODULES, GROUPS } from "@/components/marketing/marketing-content";

const LEGACY: Record<string, string> = {
  "#como-funciona": "/como-funciona",
  "#caracteristicas": "/caracteristicas",
  "#precios": "/precios",
  "#nosotros": "/nosotros",
};

const DOORS = [
  { href: "/como-funciona", n: "A", title: "Cómo funciona", text: "El recorrido completo: de configurar tu empresa a cobrar y medir." },
  { href: "/caracteristicas", n: "B", title: "Características", text: "Los diez módulos actuales, con lo que hacen y lo que no." },
  { href: "/precios", n: "C", title: "Precios", text: "Planes y prueba gratuita. Valores por confirmar." },
  { href: "/nosotros", n: "D", title: "Nosotros", text: "Por qué construimos NextCob y cómo trabajamos." },
];

export default function LandingPage() {
  const [, navigate] = useLocation();
  usePageMeta(
    "NextCob · ERP para pymes en Chile: ventas, cobros, stock y compras",
    "NextCob reúne cotizaciones, cobros, inventario con pistola lectora, locales y bodegas, compras, informes y satisfacción en un solo sistema para negocios en Chile.",
  );

  useEffect(() => {
    const target = LEGACY[window.location.hash];
    if (target) navigate(target, { replace: true });
  }, [navigate]);

  return (
    <MarketingShell>
      {/* Hero */}
      <section className="border-b border-[#0A0A0A]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 grid lg:grid-cols-12">
          <div className="lg:col-span-7 py-16 md:py-24 lg:pr-12 lg:border-r border-[#0A0A0A]">
            <p className="nc-kicker mb-6 nc-rise">ERP para pymes en Chile</p>
            <h1 className="nc-display text-[2.7rem] sm:text-7xl leading-[0.95] nc-rise" style={{ ["--d" as string]: "80ms" }}>
              Vende, cobra, compra y controla tu stock.{" "}
              <span className="text-[#E86B2A]">En un solo lugar.</span>
            </h1>
            <p className="mt-8 text-lg sm:text-xl text-neutral-700 max-w-xl leading-relaxed nc-rise" style={{ ["--d" as string]: "160ms" }}>
              NextCob empezó cobrando. Hoy también cotiza, maneja inventario por local y bodega,
              registra compras a proveedores y te entrega informes por área.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3 nc-rise" style={{ ["--d" as string]: "240ms" }}>
              <RegisterButton className="px-6 py-3.5 text-base" label="Comenzar prueba de 14 días" />
              <DemoButton className="px-6 py-3.5 text-base" />
            </div>
          </div>

          {/* Module ledger */}
          <div className="lg:col-span-5 py-10 lg:py-16 lg:pl-10">
            <div className="flex items-baseline justify-between border-b border-[#0A0A0A] pb-3 mb-1">
              <p className="nc-mono text-xs uppercase">Módulos actuales</p>
              <p className="nc-mono text-xs text-neutral-500">{MODULES.length}</p>
            </div>
            <ul>
              {MODULES.map((m, i) => (
                <li key={m.id} className="nc-rise" style={{ ["--d" as string]: `${200 + i * 45}ms` }}>
                  <Link
                    href={`/caracteristicas#${m.id}`}
                    className="nc-tile group flex items-center gap-4 py-3 px-2 border-b nc-rule"
                    data-testid={`link-module-${m.id}`}
                  >
                    <span className="nc-mono text-xs text-neutral-400 w-6">{m.code}</span>
                    <m.icon className={`h-4 w-4 shrink-0 ${i % 3 === 0 ? "text-[#E86B2A]" : i % 3 === 1 ? "text-[#0D6E6E]" : "text-[#C98A00]"}`} />
                    <span className="font-semibold text-sm flex-1">{m.name}</span>
                    <ArrowRight className="nc-arrow h-4 w-4 text-neutral-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Four areas */}
      <section className="bg-[#FBFAF7] border-b border-[#0A0A0A]">
        <div className="max-w-7xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map((g, i) => (
            <div key={g.name} className={`px-5 sm:px-8 py-10 border-b lg:border-b-0 nc-rule ${i < 3 ? "lg:border-r" : ""} ${i % 2 === 0 ? "sm:border-r" : ""}`}>
              <g.icon className="h-5 w-5 text-[#0D6E6E] mb-5" />
              <p className="nc-display text-2xl">{g.name}</p>
              <p className="mt-2 text-sm text-neutral-600">{g.line}</p>
              <p className="mt-4 nc-mono text-xs text-neutral-500">
                {MODULES.filter((m) => m.group === g.name).map((m) => m.name).join(" · ")}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Spotlight */}
      <section className="border-b border-[#0A0A0A]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-20 grid md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-5">
            <p className="nc-kicker mb-4">En el mesón</p>
            <h2 className="nc-display text-3xl sm:text-5xl leading-[1]">Escanea, calcula el margen, cobra.</h2>
          </div>
          <div className="md:col-span-7 grid sm:grid-cols-2 border border-[#0A0A0A]">
            <div className="p-6 border-b sm:border-b-0 sm:border-r border-[#0A0A0A]">
              <ScanBarcode className="h-6 w-6 text-[#E86B2A] mb-4" />
              <p className="font-semibold">Pistola lectora</p>
              <p className="text-sm text-neutral-600 mt-2 leading-relaxed">Busca y selecciona productos con lector de códigos de barras.</p>
            </div>
            <div className="p-6">
              <p className="nc-mono text-xs text-neutral-500 mb-4">COSTO · MARGEN · IVA · PVP</p>
              <p className="font-semibold">Calculadora de precios</p>
              <p className="text-sm text-neutral-600 mt-2 leading-relaxed">Márgenes sobre valores netos, IVA configurable e historial de costos.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Doors to pages */}
      <section>
        <div className="max-w-7xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4">
          {DOORS.map((d, i) => (
            <Link
              key={d.href}
              href={d.href}
              data-testid={`link-door${d.href.replace("/", "-")}`}
              className={`nc-tile block px-5 sm:px-8 py-12 border-b lg:border-b-0 nc-rule ${i < 3 ? "lg:border-r" : ""} ${i % 2 === 0 ? "sm:border-r" : ""}`}
            >
              <span className="nc-mono text-xs text-[#0D6E6E]">{d.n}</span>
              <span className="mt-6 flex items-center justify-between nc-display text-2xl">
                {d.title}
                <ArrowRight className="nc-arrow h-5 w-5" />
              </span>
              <span className="block mt-3 text-sm text-neutral-600 leading-relaxed">{d.text}</span>
            </Link>
          ))}
        </div>
      </section>

      <ClosingBand title="Un sistema para todo el negocio, no solo para la cobranza." />
    </MarketingShell>
  );
}
