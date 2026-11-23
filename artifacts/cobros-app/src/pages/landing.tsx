import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Package,
  Receipt,
  ScanBarcode,
  ShoppingCart,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { MarketingShell, usePageMeta, RegisterButton, DemoButton, ClosingBand } from "@/components/marketing/marketing-shell";
import { MODULES, GROUPS } from "@/components/marketing/marketing-content";

const LEGACY: Record<string, string> = {
  "#como-funciona": "/como-funciona",
  "#caracteristicas": "/caracteristicas",
  "#precios": "/precios",
  "#nosotros": "/nosotros",
};

const DOORS = [
  { href: "/como-funciona", n: "01", title: "Cómo funciona", text: "El recorrido completo: de configurar tu empresa a cobrar y medir." },
  { href: "/caracteristicas", n: "02", title: "Características", text: "Los diez módulos actuales, con lo que hacen y lo que no." },
  { href: "/precios", n: "03", title: "Precios", text: "Planes y prueba gratuita. Valores por confirmar." },
  { href: "/nosotros", n: "04", title: "Nosotros", text: "Por qué construimos NextCob y cómo trabajamos." },
];

const FEATURES = [
  {
    icon: Receipt,
    title: "Ventas y Cobros",
    text: "Cobra con vencimiento, abonos parciales, descuentos e IVA. Links de pago vía Flow, Webpay o MercadoPago.",
  },
  {
    icon: Package,
    title: "Inventario y Stock",
    text: "Catálogo con pistola lectora, stock crítico por local/bodega y calculadora de precios con márgenes netos.",
  },
  {
    icon: ShoppingCart,
    title: "Compras y Proveedores",
    text: "Registra facturas de proveedores, recibe mercadería y actualiza stock y costos automáticamente.",
  },
  {
    icon: BarChart3,
    title: "Informes detallados",
    text: "Ventas, compras e inventario con filtros por período, ranking de clientes y exportación a Excel.",
  },
  {
    icon: Star,
    title: "Satisfacción del cliente",
    text: "Encuestas post-pago, comentarios privados e invitación voluntaria a Google Reviews.",
  },
  {
    icon: Users,
    title: "Gestión de clientes",
    text: "Fichas con RUT, giro, contacto e historial de pago. Seguimiento y comportamiento de pago.",
  },
];

const STATS = [
  { value: "10", label: "Módulos integrados" },
  { value: "14", label: "Días gratis" },
  { value: "1", label: "Sistema para todo" },
  { value: "Chile", label: "Diseñado para pymes" },
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

      {/* ═══ HERO ═══════════════════════════════════════════════════════ */}
      <section className="nc-hero-bg border-b border-[#D1E8E8]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-24 grid lg:grid-cols-2 gap-12 items-center">

          {/* Left: copy */}
          <div>
            <p className="nc-kicker mb-5 nc-rise">ERP para pymes en Chile</p>
            <h1
              className="nc-display text-[2.6rem] sm:text-6xl leading-[0.95] nc-rise"
              style={{ ["--d" as string]: "80ms" }}
            >
              Vende, cobra,{" "}
              <span className="nc-gradient-text">compra y controla</span>{" "}
              tu stock.
            </h1>
            <p
              className="mt-6 text-lg sm:text-xl text-neutral-600 max-w-lg leading-relaxed nc-rise"
              style={{ ["--d" as string]: "160ms" }}
            >
              NextCob empezó cobrando. Hoy también cotiza, maneja inventario por
              local y bodega, registra compras a proveedores y te entrega informes
              por área. Todo en un solo sistema.
            </p>

            <div
              className="mt-8 flex flex-col sm:flex-row gap-3 nc-rise"
              style={{ ["--d" as string]: "240ms" }}
            >
              <RegisterButton className="px-7 py-4 text-base" label="Comenzar prueba gratis" />
              <DemoButton className="px-7 py-4 text-base" />
            </div>

            <div
              className="mt-8 flex flex-wrap gap-5 nc-rise"
              style={{ ["--d" as string]: "320ms" }}
            >
              {["Sin tarjeta de crédito", "14 días gratis", "Soporte incluido"].map((item) => (
                <span key={item} className="flex items-center gap-2 text-sm text-neutral-600">
                  <CheckCircle2 className="h-4 w-4 text-[#0D6E6E] shrink-0" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* Right: mock UI */}
          <div
            className="relative nc-rise"
            style={{ ["--d" as string]: "200ms" }}
          >
            {/* Main card */}
            <div className="nc-mockup p-0 nc-float">
              <div className="nc-mockup-bar" />
              <div className="px-5 py-4 border-b border-[#D1E8E8] flex items-center justify-between">
                <span className="nc-mono text-xs text-neutral-500 uppercase tracking-widest">NextCob · Dashboard</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0D6E6E]">
                  <span className="h-2 w-2 bg-[#0D6E6E] nc-pulse" style={{ display: 'inline-block' }} />
                  En vivo
                </span>
              </div>
              <div className="p-5 grid grid-cols-3 gap-3">
                {[
                  { label: "Cobros hoy", value: "$1.240.000", up: true },
                  { label: "Por cobrar", value: "$3.780.000", up: false },
                  { label: "Stock bajo", value: "4 productos", up: false },
                ].map((stat) => (
                  <div key={stat.label} className="bg-[#F0F9F9] p-3 border border-[#D1E8E8]">
                    <p className="text-xs text-neutral-500 mb-1">{stat.label}</p>
                    <p className="font-bold text-sm text-[#0A0A0A] leading-tight">{stat.value}</p>
                    {stat.up && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-[#0D6E6E] mt-1">
                        <TrendingUp className="h-3 w-3" /> +12%
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-5 pb-5">
                <p className="nc-mono text-xs text-neutral-400 mb-2 uppercase">Últimas ventas</p>
                {[
                  { name: "Distribuidora Pérez", amount: "$450.000", status: "Pagado" },
                  { name: "Comercial Sur Ltda.", amount: "$189.000", status: "Pendiente" },
                  { name: "Ferretería El Clavo", amount: "$92.500", status: "Pagado" },
                ].map((row) => (
                  <div key={row.name} className="flex items-center justify-between py-2 border-b border-[#EBF5F5] last:border-b-0">
                    <span className="text-sm font-medium truncate pr-2">{row.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold">{row.amount}</span>
                      <span className={`nc-mono text-xs px-2 py-0.5 ${row.status === "Pagado" ? "bg-[#EBF5F5] text-[#0D6E6E]" : "bg-amber-50 text-amber-700"}`}>
                        {row.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Floating badge */}
            <div
              className="absolute -bottom-4 -left-4 bg-[#0D6E6E] text-white px-4 py-3 nc-float-slow shadow-lg"
              style={{ zIndex: 10 }}
            >
              <p className="nc-mono text-xs opacity-75 uppercase mb-0.5">Pistola lectora</p>
              <div className="flex items-center gap-2">
                <ScanBarcode className="h-4 w-4" />
                <span className="font-semibold text-sm">Producto escaneado</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ STATS BAND ══════════════════════════════════════════════════ */}
      <section className="nc-stats-band border-b border-[#0A5A5A]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-[#0A5A5A]">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className="nc-count bg-[#0D6E6E] px-6 py-8 text-center"
              style={{ ["--d" as string]: `${i * 100}ms` }}
            >
              <p className="nc-display text-4xl sm:text-5xl text-white leading-none">{s.value}</p>
              <p className="nc-mono text-xs text-[#A8D8D8] uppercase tracking-widest mt-2">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FEATURES GRID ═══════════════════════════════════════════════ */}
      <section className="bg-white border-b border-[#D1E8E8]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-24">
          <div className="max-w-2xl mb-12">
            <p className="nc-kicker mb-4">Todo lo que necesitas</p>
            <h2 className="nc-display text-3xl sm:text-5xl leading-[1]">
              Un sistema para cada área de tu negocio
            </h2>
            <p className="mt-4 text-lg text-neutral-600 leading-relaxed">
              Desde la cotización hasta el cobro. Desde la compra al proveedor hasta el control de stock.
              Nextcob cubre el ciclo completo.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="nc-feat-card p-6 nc-rise"
                style={{ ["--d" as string]: `${i * 60}ms` }}
              >
                <div className="h-10 w-10 bg-[#EBF5F5] flex items-center justify-center mb-5">
                  <f.icon className="h-5 w-5 text-[#0D6E6E]" />
                </div>
                <h3 className="font-bold text-base mb-2">{f.title}</h3>
                <p className="text-sm text-neutral-600 leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SPOTLIGHT — Pistola + Calculadora ═══════════════════════════ */}
      <section className="bg-[#F0F9F9] border-b border-[#D1E8E8]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="nc-kicker mb-4">En el mesón</p>
            <h2 className="nc-display text-3xl sm:text-5xl leading-[1] mb-6">
              Escanea, calcula el margen, cobra.
            </h2>
            <p className="text-lg text-neutral-600 leading-relaxed mb-8">
              Con la pistola lectora buscas cualquier producto al instante. La calculadora de precios
              te muestra costo, margen, IVA y precio sugerido — todo sobre valores netos, sin confusiones.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: ScanBarcode, title: "Pistola lectora", text: "Busca y selecciona productos con lector de códigos de barras." },
                { icon: Zap, title: "COSTO · MARGEN · IVA · PVP", text: "Márgenes sobre valores netos, IVA configurable e historial de costos." },
              ].map((item) => (
                <div key={item.title} className="bg-white border border-[#D1E8E8] p-5">
                  <item.icon className="h-5 w-5 text-[#0D6E6E] mb-3" />
                  <p className="font-semibold text-sm mb-1">{item.title}</p>
                  <p className="text-sm text-neutral-600 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Visual */}
          <div className="nc-mockup p-0 nc-float-slow">
            <div className="nc-mockup-bar" />
            <div className="px-5 py-4 border-b border-[#D1E8E8]">
              <span className="nc-mono text-xs text-neutral-400 uppercase tracking-widest">Inventario · Calculadora de precios</span>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: "Producto", value: "Tornillo M6 × 25mm" },
                { label: "Costo unitario (neto)", value: "$42" },
                { label: "Margen", value: "35%" },
                { label: "IVA", value: "19%" },
                { label: "PVP sugerido", value: "$67" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-[#EBF5F5] last:border-0">
                  <span className="nc-mono text-xs text-neutral-500 uppercase">{row.label}</span>
                  <span className="font-semibold text-sm text-[#0A0A0A]">{row.value}</span>
                </div>
              ))}
              <div className="mt-4 bg-[#0D6E6E] text-white p-4 flex items-center justify-between">
                <span className="font-semibold">Precio de venta</span>
                <span className="nc-display text-xl">$80 c/IVA</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOUR GROUPS ═════════════════════════════════════════════════ */}
      <section className="bg-white border-b border-[#D1E8E8]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-20">
          <div className="max-w-xl mb-12">
            <p className="nc-kicker mb-4">Áreas del sistema</p>
            <h2 className="nc-display text-3xl sm:text-5xl leading-[1]">
              Cuatro áreas, un solo sistema
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {GROUPS.map((g, i) => (
              <div
                key={g.name}
                className="nc-rise"
                style={{ ["--d" as string]: `${i * 80}ms` }}
              >
                <div className="bg-[#EBF5F5] h-12 w-12 flex items-center justify-center mb-5">
                  <g.icon className="h-6 w-6 text-[#0D6E6E]" />
                </div>
                <h3 className="nc-display text-xl mb-2">{g.name}</h3>
                <p className="text-sm text-neutral-600 leading-relaxed mb-4">{g.line}</p>
                <p className="nc-mono text-xs text-neutral-400">
                  {MODULES.filter((m) => m.group === g.name).map((m) => m.name).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ MODULE LIST ═════════════════════════════════════════════════ */}
      <section className="bg-[#F7FAFA] border-b border-[#D1E8E8]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-20 grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <p className="nc-kicker mb-4">Módulos</p>
            <h2 className="nc-display text-3xl sm:text-5xl leading-[1] mb-6">
              {MODULES.length} módulos listos para usar
            </h2>
            <p className="text-lg text-neutral-600 leading-relaxed mb-8">
              Cada área de tu negocio tiene su módulo. Desde ventas y cobros hasta satisfacción del
              cliente y el asistente Diana.
            </p>
            <RegisterButton className="px-7 py-4 text-base" label="Comenzar prueba gratis" />
          </div>

          <div className="border border-[#D1E8E8] bg-white">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#D1E8E8] bg-[#EBF5F5]">
              <span className="nc-mono text-xs uppercase text-neutral-500">Módulo</span>
              <span className="nc-mono text-xs uppercase text-neutral-500">Área</span>
            </div>
            <ul>
              {MODULES.map((m, i) => (
                <li key={m.id} className="nc-slide-in" style={{ ["--d" as string]: `${i * 40}ms` }}>
                  <Link
                    href={`/caracteristicas#${m.id}`}
                    className="nc-module-row group flex items-center gap-4 py-3 px-5 border-b border-[#EBF5F5] last:border-b-0"
                    data-testid={`link-module-${m.id}`}
                  >
                    <span className="nc-mono text-xs text-neutral-400 w-5 shrink-0">{m.code}</span>
                    <m.icon className="h-4 w-4 shrink-0 text-[#0D6E6E]" />
                    <span className="font-semibold text-sm flex-1">{m.name}</span>
                    <span className="nc-mono text-xs text-neutral-400 hidden sm:block">{m.group}</span>
                    <ArrowRight className="nc-arrow h-4 w-4 text-neutral-300 group-hover:text-[#0D6E6E]" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ═══ DOORS TO PAGES ══════════════════════════════════════════════ */}
      <section className="bg-white border-b border-[#D1E8E8]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-20">
          <p className="nc-kicker mb-8">Explorar</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {DOORS.map((d, i) => (
              <Link
                key={d.href}
                href={d.href}
                data-testid={`link-door${d.href.replace("/", "-")}`}
                className="nc-tile nc-feat-card block p-6 nc-rise"
                style={{ ["--d" as string]: `${i * 70}ms` }}
              >
                <span className="nc-mono text-xs text-[#0D6E6E] block mb-4">{d.n}</span>
                <span className="nc-display text-xl flex items-center justify-between mb-3">
                  {d.title}
                  <ArrowRight className="nc-arrow h-5 w-5 text-[#0D6E6E] shrink-0" />
                </span>
                <span className="block text-sm text-neutral-600 leading-relaxed">{d.text}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <ClosingBand title="Un sistema para todo el negocio, no solo para la cobranza." />
    </MarketingShell>
  );
}
