import { useAuth } from "@workspace/replit-auth-web";
import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { LandingChat } from "@/components/landing-chat";
import { DemoRequestModal } from "@/components/demo-request-modal";
import { HeroParticles } from "@/components/hero-particles";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Coins,
  CreditCard,
  Gauge,
  Globe,
  Link2,
  Percent,
  Share2,
  Sparkles,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";

function LandingNav() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const hero = document.getElementById("hero");
      const threshold = hero ? hero.offsetHeight - 80 : 400;
      setScrolled(window.scrollY > threshold);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const linkClass = scrolled
    ? "text-muted-foreground hover:text-foreground transition-colors"
    : "text-white/80 hover:text-white transition-colors";
  const ghostBtnClass = scrolled
    ? "text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-md hover:bg-secondary/60"
    : "text-sm font-medium text-white/80 hover:text-white transition-colors px-3 py-2 rounded-md hover:bg-white/10";

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "bg-background/80 backdrop-blur-md border-b border-border/50"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={`${import.meta.env.BASE_URL}brand/nextcob-logo.png`}
            alt="NextCob"
            className={`h-8 w-auto transition-[filter] duration-300 ${
              scrolled ? "" : "brightness-0 invert"
            }`}
          />
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <a href="#como-funciona" className={linkClass}>Cómo funciona</a>
          <a href="#caracteristicas" className={linkClass}>Características</a>
          <a href="#precios" className={linkClass}>Precios</a>
          <a href="#nosotros" className={linkClass}>Nosotros</a>
        </nav>
        <div className="flex items-center gap-3">
          <button onClick={login} className={ghostBtnClass}>
            Iniciar sesión
          </button>
          <DemoRequestModal
            trigger={
              <button className={`hidden sm:inline-flex ${ghostBtnClass}`}>
                Agenda una presentación
              </button>
            }
          />
          <button
            onClick={() => navigate("/register")}
            className={`text-sm font-semibold px-4 py-2 rounded-lg shadow transition-colors ${
              scrolled
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-[#F4A800] text-black hover:bg-[#ffba1f]"
            }`}
          >
            Crear cuenta
          </button>
        </div>
      </div>
    </header>
  );
}

function HeroSection() {
  const [, navigate] = useLocation();
  return (
    <section id="hero" className="relative overflow-hidden pt-32 pb-20 px-6 hero-animated-bg">
      {/* Animated fintech particle network */}
      <HeroParticles />
      {/* Dark overlay so the white text always stays legible */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      {/* Fade-to-white transition into the next section */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background"
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 bg-white/90 text-gray-900 px-3 py-1.5 rounded-full text-sm font-medium mb-8 border border-white/30 shadow-sm backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5 text-[#F4A800]" />
          Con asistente IA incluido
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-white leading-[1.1] mb-6">
          Gestiona la cobranza a tus clientes{" "}
          <span className="text-[#F4A800]">sin complicaciones</span>
        </h1>
        <p className="text-xl text-white/80 max-w-2xl mx-auto mb-10 leading-relaxed">
          Controla la cobranza de tus clientes, comparte links de pago con
          Webpay y MercadoPago, y automatiza el seguimiento. Con dashboard en
          tiempo real y asistente IA para analizar tu negocio.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => navigate("/register")}
            className="inline-flex items-center gap-2 bg-[#F4A800] text-black px-6 py-3 rounded-lg text-base font-semibold shadow-lg shadow-[#F4A800]/20 hover:bg-[#ffba1f] transition-colors w-full sm:w-auto justify-center"
          >
            Comenzar gratis
            <ArrowRight className="h-4 w-4" />
          </button>
          <DemoRequestModal
            trigger={
              <button className="inline-flex items-center gap-2 border border-white/70 text-white px-6 py-3 rounded-lg text-base font-semibold hover:bg-white/10 transition-colors w-full sm:w-auto justify-center">
                Agenda una presentación
              </button>
            }
          />
        </div>
        <p className="text-sm text-white/60 mt-5">
          14 días de prueba gratis · Luego $18.990 + IVA ($22.598 total) CLP/mes
        </p>

        {/* App preview mockup */}
        <div className="mt-16 rounded-2xl border border-white/10 bg-card shadow-2xl overflow-hidden text-left">
          <div className="bg-muted/40 border-b px-4 py-3 flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-yellow-400" />
            <div className="h-3 w-3 rounded-full bg-green-400" />
            <div className="mx-auto text-xs text-muted-foreground font-mono">nextcob.app/dashboard</div>
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Datos de ejemplo</span>
          </div>
          <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Monto recaudado", value: "$2.450.000", color: "text-green-700", bg: "bg-green-50 border-green-200" },
              { label: "Ticket promedio", value: "$85.000", color: "text-primary", bg: "bg-primary/5 border-primary/20" },
              { label: "Pendientes", value: "7", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
              { label: "Pagados este mes", value: "29", color: "text-foreground", bg: "bg-muted/30 border-border" },
            ].map((card) => (
              <div key={card.label} className={`rounded-xl border p-4 ${card.bg}`}>
                <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
                <p className={`text-xl font-bold font-mono ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>
          <div className="px-6 pb-6">
            <div className="rounded-xl border bg-background overflow-hidden">
              <div className="px-4 py-2 bg-muted/30 border-b text-xs font-medium text-muted-foreground">Cobros recientes</div>
              {[
                { desc: "Servicio mensual · Cliente Pérez", monto: "$85.000", estado: "Pagado", col: "text-green-700 bg-green-50" },
                { desc: "Consultoría Q2 · Empresa ABC", monto: "$320.000", estado: "Pendiente", col: "text-amber-700 bg-amber-50" },
                { desc: "Mantenimiento web Enero", monto: "$45.000", estado: "Pagado", col: "text-green-700 bg-green-50" },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3 border-b last:border-0 text-sm">
                  <span className="text-foreground font-medium">{row.desc}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold">{row.monto}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.col}`}>{row.estado}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComoFuncionaSection() {
  const steps = [
    {
      number: "01",
      icon: CreditCard,
      title: "Crea tu cobro",
      desc: "Ingresa el monto, la descripción y el cliente. Regístralo en segundos, ya sea con link de pago o cobranza manual.",
    },
    {
      number: "02",
      icon: Share2,
      title: "Comparte el link",
      desc: "Genera un link de pago con Webpay o MercadoPago y envíalo por WhatsApp o email. También puedes enviar recordatorios automáticos.",
    },
    {
      number: "03",
      icon: Wallet,
      title: "Haz seguimiento",
      desc: "Recibe el pago total o por abonos. La plataforma actualiza el estado y tu dashboard en tiempo real.",
    },
  ];
  return (
    <section id="como-funciona" className="py-20 px-6 bg-muted/20 border-y border-border/50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Cómo funciona</h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Tres pasos simples para gestionar la cobranza de tus clientes en
            Chile.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <div key={i} className="bg-card border rounded-2xl p-7 shadow-sm">
              <div className="flex items-start justify-between mb-5">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                  <step.icon className="h-5 w-5" />
                </div>
                <span className="text-5xl font-black text-muted-foreground/15 font-mono leading-none">{step.number}</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CaracteristicasSection() {
  const features = [
    { icon: Link2, title: "Links de pago Flow y MercadoPago", desc: "Genera links de pago con Webpay (Flow) y MercadoPago. Tus clientes pagan online con tarjeta o transferencia." },
    { icon: Wallet, title: "Cobranza manual", desc: "Registra pagos en efectivo, transferencia o cualquier medio. Mantén todos tus cobros en un solo lugar." },
    { icon: Coins, title: "Pagos parciales y abonos", desc: "Acepta abonos y haz seguimiento automático del saldo hasta completar el monto total del cobro." },
    { icon: Bell, title: "Recordatorios por email y WhatsApp", desc: "Envía recordatorios a tus clientes para que no se olviden de pagar y reduce la morosidad." },
    { icon: Bot, title: "Asistente IA incluido", desc: "Pregúntale sobre tu negocio: '¿Cuánto recaudé este mes?' o '¿Qué clientes tienen cobros pendientes?'", premium: true },
    { icon: Users, title: "Gestión de clientes", desc: "Organiza tus clientes con RUT, email y teléfono, con el historial completo de cobros de cada uno." },
    { icon: Gauge, title: "Scoring de clientes", desc: "Identifica automáticamente tus clientes más morosos y prioriza tu gestión de cobranza.", premium: true },
    { icon: Globe, title: "Portal del deudor", desc: "Tus clientes acceden a un link único donde ven todas sus deudas pendientes y pueden pagar con un clic.", premium: true },
    { icon: BarChart3, title: "Informes y aging", desc: "Reportes de cuentas por cobrar por antigüedad, proyección de flujo de caja y exportación a Excel." },
    { icon: Percent, title: "Descuentos por mora", desc: "Aplica descuentos negociados a cobros vencidos para recuperar algo antes que perderlo todo." },
    { icon: UsersRound, title: "Gestión de equipos", desc: "Agrega ejecutivos de cobranza, asigna cobros y mide el rendimiento de cada uno." },
    { icon: ClipboardList, title: "Notas de gestión", desc: "Registra cada llamada, email o visita con resultado y programa la próxima gestión automáticamente." },
  ];
  return (
    <section id="caracteristicas" className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Todo lo que necesitas para gestionar tu cobranza</h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Una plataforma completa para gestionar tus cobros en Chile, sin complicaciones.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div
              key={i}
              className={`bg-card border rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group ${
                f.premium ? "hover:border-[#F4A800]/40" : "hover:border-primary/30"
              }`}
            >
              <div
                className={`h-10 w-10 rounded-lg flex items-center justify-center mb-4 transition-colors ${
                  f.premium
                    ? "bg-[#F4A800]/10 text-[#F4A800] group-hover:bg-[#F4A800] group-hover:text-black"
                    : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                }`}
              >
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PreciosSection() {
  const [, navigate] = useLocation();
  return (
    <section id="precios" className="py-20 px-6 bg-muted/20 border-y border-border/50">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Un precio simple y transparente</h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Prueba 14 días gratis. Sin sorpresas ni letras chicas.
          </p>
        </div>
        <div className="max-w-md mx-auto">
          <div className="bg-[#0A0A0A] text-white rounded-2xl p-8 shadow-xl flex flex-col relative overflow-hidden border-2 border-[#F4A800]">
            <div className="absolute top-5 right-5">
              <span className="bg-[#F4A800] text-black text-xs font-bold px-2.5 py-1 rounded-full">14 DÍAS GRATIS</span>
            </div>
            <div className="mb-6">
              <p className="text-xs font-semibold text-[#F4A800] uppercase tracking-wider mb-2">Plan NextCob</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-black">$18.990 + IVA</span>
                <span className="text-white/60 pb-1 text-sm">/mes</span>
              </div>
              <p className="text-sm text-white/80 mt-2 font-medium">
                Neto $18.990 + IVA $3.608 = Total $22.598/mes
              </p>
              <p className="text-sm text-white/60 mt-1">CLP · IVA incluido · Después de tu prueba de 14 días. Cancela cuando quieras.</p>
            </div>
            <ul className="space-y-3 flex-1 mb-8">
              {[
                "Cobros ilimitados",
                "Links de pago Flow y MercadoPago",
                "Cobranza manual",
                "Pagos parciales y abonos",
                "Recordatorios por email y WhatsApp",
                "Asistente IA incluido",
                "Gestión de clientes",
                "Dashboard en tiempo real",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-[#F4A800] shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <button
              onClick={() => navigate("/register")}
              className="w-full bg-[#F4A800] text-black py-2.5 rounded-lg font-semibold text-sm hover:bg-[#ffba1f] transition-colors"
            >
              Comenzar 14 días gratis
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuienesSomosSection() {
  return (
    <section id="nosotros" className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-5">Quiénes somos</h2>
            <p className="text-primary font-semibold leading-relaxed mb-4">
              Una plataforma construida por emprendedores, para emprendedores.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Construimos NextCob porque sabíamos exactamente lo que las pymes y profesionales independientes necesitaban: una forma simple y profesional de gestionar la cobranza, sin depender de programadores ni contadores.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Integramos Webpay, MercadoPago y un asistente IA para que tú te enfoques en tu negocio, no en perseguir pagos.
            </p>
            <p className="font-medium text-foreground leading-relaxed">
              Nuestra misión: que te paguen a tiempo, siempre.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {[
              { icon: CreditCard, label: "Pagos con Webpay y MercadoPago" },
              { icon: Bot, label: "Asistente IA incluido" },
              { icon: Coins, label: "Cobros parciales y seguimiento automático" },
              { icon: Sparkles, label: "14 días de prueba gratis" },
            ].map((item) => (
              <div key={item.label} className="bg-card border rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:border-primary/30 transition-colors">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <item.icon className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  const [, navigate] = useLocation();
  return (
    <section className="relative overflow-hidden py-20 px-6 bg-[#0A0A0A]">
      {/* Subtle gold glow */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(244,168,0,0.18),transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold text-white mb-4">Empieza a gestionar tu cobranza hoy mismo</h2>
        <p className="text-white/75 text-lg mb-8 leading-relaxed">
          14 días de prueba gratis. Configura tu primer cobro en menos de 5 minutos.
        </p>
        <button
          onClick={() => navigate("/register")}
          className="inline-flex items-center gap-2 bg-[#F4A800] text-black px-8 py-3.5 rounded-lg text-base font-bold shadow-lg shadow-[#F4A800]/20 hover:bg-[#ffba1f] transition-colors"
        >
          Crear mi cuenta gratis
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-card border-t py-12 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid sm:grid-cols-4 gap-8 mb-10">
          <div className="sm:col-span-1">
            <div className="flex items-center mb-3">
              <img
                src={`${import.meta.env.BASE_URL}brand/nextcob-logo.png`}
                alt="NextCob"
                className="h-8 w-auto object-contain"
              />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">La forma más simple de gestionar tu cobranza en Chile.</p>
          </div>
          <div>
            <p className="font-semibold text-sm mb-3">Producto</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#caracteristicas" className="hover:text-foreground transition-colors">Características</a></li>
              <li><a href="#precios" className="hover:text-foreground transition-colors">Precios</a></li>
              <li><a href="#como-funciona" className="hover:text-foreground transition-colors">Cómo funciona</a></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-sm mb-3">Empresa</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#nosotros" className="hover:text-foreground transition-colors">Quiénes somos</a></li>
              <li><span>Blog</span></li>
              <li><span>Empleos</span></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-sm mb-3">Contacto</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="mailto:contacto@nextcob.com" className="hover:text-foreground transition-colors">contacto@nextcob.com</a></li>
              <li>Santiago, Chile</li>
            </ul>
          </div>
        </div>
        <div className="border-t pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">© 2025 NextCob. Todos los derechos reservados.</p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/terminos" className="hover:text-foreground transition-colors">Términos y condiciones</Link>
            <Link href="/privacidad" className="hover:text-foreground transition-colors">Privacidad</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />
      <HeroSection />
      <ComoFuncionaSection />
      <CaracteristicasSection />
      <PreciosSection />
      <QuienesSomosSection />
      <CtaSection />
      <Footer />
      <LandingChat />
    </div>
  );
}
