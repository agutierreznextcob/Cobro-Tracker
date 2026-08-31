import { useAuth } from "@workspace/replit-auth-web";
import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { LandingChat } from "@/components/landing-chat";
import { DemoRequestModal } from "@/components/demo-request-modal";
import { HeroParticles } from "@/components/hero-particles";
import { Reveal } from "@/components/reveal";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronRight,
  Coins,
  CreditCard,
  FileText,
  LogOut,
  Sparkles,
  UserCircle,
  UsersRound,
  Zap,
} from "lucide-react";

function LandingNav() {
  const { login, logout, isAuthenticated, user } = useAuth();
  const [, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-account-menu]")) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const accountName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.email ||
    "Mi cuenta";
  const accountInitial = (accountName[0] || "?").toUpperCase();

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
          {isAuthenticated ? (
            <>
              <button
                onClick={() => navigate("/dashboard")}
                className={`inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg shadow transition-colors ${
                  scrolled
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-[#F4A800] text-black hover:bg-[#ffba1f]"
                }`}
              >
                Ir al dashboard
                <ArrowRight className="h-4 w-4" />
              </button>
              <div className="relative" data-account-menu>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Menú de cuenta"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    scrolled
                      ? "bg-secondary text-foreground hover:bg-secondary/70 border border-border/60"
                      : "bg-white/15 text-white hover:bg-white/25 border border-white/20"
                  }`}
                >
                  {accountInitial}
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden z-50"
                  >
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-sm font-medium truncate">{accountName}</p>
                      {user?.email && (
                        <p className="text-xs text-muted-foreground truncate">
                          {user.email}
                        </p>
                      )}
                    </div>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/perfil");
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/70 transition-colors"
                    >
                      <UserCircle className="h-4 w-4" />
                      Mi perfil
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/70 transition-colors border-t border-border"
                    >
                      <LogOut className="h-4 w-4" />
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
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
        <Reveal variant="up">
          <div className="inline-flex items-center gap-2 bg-white/90 text-gray-900 px-3 py-1.5 rounded-full text-sm font-medium mb-8 border border-white/30 shadow-sm backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-[#F4A800]" />
            Gestión inteligente de cuentas por cobrar
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-white leading-[1.1] mb-6">
            Controla el dinero que te deben.{" "}
            <span className="text-[#F4A800]">Predícelo. Recupéralo.</span>
          </h1>
        </Reveal>
        <Reveal variant="up" delayMs={150}>
          <p className="text-xl text-white/80 max-w-2xl mx-auto mb-10 leading-relaxed">
            NextCob es la plataforma de gestión de cuentas por cobrar para
            empresas y profesionales que quieren saber exactamente cuándo y
            cuánto dinero recibirán — y actuar antes de que sea tarde.
          </p>
        </Reveal>
        <Reveal variant="up" delayMs={300}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => navigate("/register")}
              className="btn-shimmer inline-flex items-center gap-2 bg-[#F4A800] text-black px-6 py-3 rounded-lg text-base font-semibold shadow-lg shadow-[#F4A800]/20 hover:bg-[#ffba1f] transition-colors w-full sm:w-auto justify-center"
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
            14 días de prueba gratis con todas las funciones · Planes desde $14.990 + IVA CLP/mes
          </p>
        </Reveal>

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
      icon: FileText,
      title: "Registra y organiza tu cartera",
      desc: "Crea cobros con tipo de documento, IVA automático y asígnalos a clientes con su historial completo.",
    },
    {
      number: "02",
      icon: CreditCard,
      title: "Cobra por múltiples canales",
      desc: "Genera links de pago con Webpay (Flow) y MercadoPago. Acepta pagos totales, parciales y abonos automáticamente.",
    },
    {
      number: "03",
      icon: Zap,
      title: "Automatiza el seguimiento",
      desc: "Configura recordatorios simples o workflows inteligentes que actúan según el comportamiento del cliente — se detienen solos cuando paga.",
    },
    {
      number: "04",
      icon: UsersRound,
      title: "Gestiona y mide tu equipo",
      desc: "Asigna cobros a ejecutivos, registra gestiones, mide el rendimiento de cada uno y ve todo consolidado como administrador.",
    },
    {
      number: "05",
      icon: BarChart3,
      title: "Predice tu flujo de caja",
      desc: "Dashboard en tiempo real, scoring de clientes, informes aging, proyección de flujo de caja y Diana, que responde preguntas sobre tu negocio en lenguaje natural.",
    },
  ];
  return (
    <section id="como-funciona" className="py-20 px-6 bg-muted/20 border-y border-border/50">
      <div className="max-w-5xl mx-auto">
        <Reveal variant="up">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">De la cuenta por cobrar al dinero en tu cuenta</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Cinco pasos para gestionar toda la cobranza de tus clientes en Chile,
              de principio a fin.
            </p>
          </div>
        </Reveal>
        <div className="flex flex-wrap justify-center gap-6">
          {steps.map((step, i) => (
            <Reveal
              key={i}
              variant="up"
              delayMs={i * 120}
              className="w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]"
            >
            <div className="card-lift bg-card border rounded-2xl p-7 shadow-sm h-full">
              <div className="flex items-start justify-between mb-5">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                  <step.icon className="h-5 w-5" />
                </div>
                <span className="text-5xl font-black text-muted-foreground/15 font-mono leading-none">{step.number}</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
            </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CaracteristicasSection() {
  const features = [
    { title: "Links de pago", desc: "Webpay (Flow) y MercadoPago integrados" },
    { title: "Pagos parciales y abonos", desc: "Acepta abonos y hace seguimiento automático del saldo" },
    { title: "Cobranza manual", desc: "Registra pagos en efectivo, transferencia u otro medio" },
    { title: "Recordatorios automáticos", desc: "Email y WhatsApp programados antes y después del vencimiento" },
    { title: "Workflows inteligentes", desc: "Flujos condicionales que se adaptan al comportamiento del cliente" },
    { title: "Diana incluida", desc: "Pregúntale sobre tu negocio en lenguaje natural" },
    { title: "Scoring de clientes", desc: "Clasificación automática por historial de pago" },
    { title: "Portal del deudor", desc: "Link único donde tu cliente ve y paga todas sus deudas" },
    { title: "Gestión de equipos", desc: "Asigna cobros a ejecutivos y mide su rendimiento" },
    { title: "Notas de gestión", desc: "Registra llamadas, emails y visitas con historial completo" },
    { title: "Informes aging", desc: "Cuentas por cobrar clasificadas por antigüedad de deuda" },
    { title: "Proyección de flujo de caja", desc: "Anticipa cuánto recibirás en los próximos 30/60/90 días" },
    { title: "Descuentos por mora", desc: "Negocia y aplica descuentos a cobros vencidos" },
    { title: "Comprobantes en PDF", desc: "Se generan y envían automáticamente al pagar" },
    { title: "Tipo de documento tributario", desc: "Factura afecta, exenta, boleta y más" },
    { title: "Exportación a Excel", desc: "Todos los informes descargables con un clic" },
    { title: "Dashboard en tiempo real", desc: "Métricas y resumen de tu actividad siempre actualizados" },
    { title: "Ley 21.719", desc: "Plataforma preparada para la ley de protección de datos" },
  ];
  return (
    <section id="caracteristicas" className="py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal variant="up">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Todo lo que necesitas para controlar el dinero que te deben</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Una plataforma completa para gestionar tus cobros en Chile, sin complicaciones.
            </p>
          </div>
        </Reveal>
        <div className="rounded-2xl border border-border/60 overflow-hidden shadow-sm">
          {features.map((f, i) => (
            <Reveal
              key={i}
              variant="up"
              delayMs={Math.min(i * 40, 400)}
              className={`flex items-center gap-4 px-5 py-3.5 sm:px-6 ${
                i % 2 === 1 ? "bg-muted/40" : "bg-card"
              }`}
            >
              <span className="font-semibold text-sm sm:text-base flex-1 sm:flex-none sm:w-56 shrink-0">
                {f.title}
              </span>
              <span className="hidden sm:block text-sm text-muted-foreground flex-1">
                {f.desc}
              </span>
              <CheckCircle2 className="h-5 w-5 text-[#F4A800] shrink-0" />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SaludCarteraSection() {
  const niveles = [
    {
      color: "bg-green-500",
      ring: "border-green-200 bg-green-50",
      titulo: "Cartera sana",
      desc: "Cobros al día",
    },
    {
      color: "bg-yellow-400",
      ring: "border-yellow-200 bg-yellow-50",
      titulo: "Cartera en riesgo",
      desc: "Próximos a vencer",
    },
    {
      color: "bg-red-500",
      ring: "border-red-200 bg-red-50",
      titulo: "Cartera crítica",
      desc: "Vencidos sin gestionar",
    },
  ];
  return (
    <section className="py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal variant="up">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight mb-3">
              La salud financiera de tu cartera, en tiempo real
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              NextCob clasifica automáticamente tu cartera y te dice exactamente
              qué hacer primero para maximizar tu recuperación.
            </p>
          </div>
        </Reveal>
        <div className="grid sm:grid-cols-3 gap-6">
          {niveles.map((n, i) => (
            <Reveal key={n.titulo} variant="up" delayMs={i * 120}>
              <div className={`card-lift rounded-2xl border p-6 text-center shadow-sm h-full ${n.ring}`}>
                <span className={`inline-block h-5 w-5 rounded-full ${n.color} shadow mb-4`} aria-hidden="true" />
                <h3 className="font-semibold text-lg mb-1 text-foreground">{n.titulo}</h3>
                <p className="text-sm text-muted-foreground">{n.desc}</p>
              </div>
            </Reveal>
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
      <div className="max-w-5xl mx-auto">
        <Reveal variant="up">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Planes simples y transparentes</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Prueba 14 días gratis con todas las funciones. Sin sorpresas ni letras chicas.
            </p>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto items-stretch">
          {/* Plan Starter */}
          <Reveal variant="up">
            <div className="h-full bg-card rounded-2xl p-8 shadow-lg flex flex-col border border-border">
              <div className="mb-6">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Plan Starter</p>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-black">$14.990 + IVA</span>
                  <span className="text-muted-foreground pb-1 text-sm">/mes</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2 font-medium">
                  Neto $14.990 + IVA $2.848 = Total $17.838/mes
                </p>
                <p className="text-sm text-muted-foreground mt-1">Para quienes empiezan a ordenar su cobranza.</p>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                {[
                  "1 usuario",
                  "Cobros y links de pago ilimitados",
                  "Links de pago Flow y MercadoPago",
                  "Pagos parciales y abonos",
                  "Recordatorios manuales",
                  "Gestión de clientes",
                  "Portal del deudor incluido",
                  "Dashboard y reportes básicos",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => navigate("/register")}
                className="w-full border border-border py-2.5 rounded-lg font-semibold text-sm hover:bg-muted transition-colors"
              >
                Comenzar 14 días gratis
              </button>
            </div>
          </Reveal>
          {/* Plan NextCob (destacado) */}
          <Reveal variant="zoom">
            <div className="h-full bg-[#0A0A0A] text-white rounded-2xl p-8 shadow-xl flex flex-col relative overflow-hidden border-2 border-[#F4A800]">
              <div className="absolute top-5 right-5">
                <span className="bg-[#F4A800] text-black text-xs font-bold px-2.5 py-1 rounded-full">RECOMENDADO</span>
              </div>
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#F4A800] uppercase tracking-wider mb-2">Plan NextCob</p>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-black">$24.990 + IVA</span>
                  <span className="text-white/60 pb-1 text-sm">/mes</span>
                </div>
                <p className="text-sm text-white/80 mt-2 font-medium">
                  Neto $24.990 + IVA $4.748 = Total $29.738/mes
                </p>
                <p className="text-sm text-white/60 mt-1">Todo NextCob, sin límites de funciones.</p>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                {[
                  "2 usuarios incluidos",
                  "Todo lo del plan Starter",
                  "Recordatorios automáticos por email y WhatsApp",
                  "Workflows inteligentes de cobranza",
                  "Diana incluida",
                  "Scoring predictivo de clientes",
                  "Informes avanzados y exportación Excel",
                  "Rendimiento de equipo",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-[#F4A800] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-white/50 mb-4">
                Usuarios adicionales: $9.990 + IVA/mes c/u
              </p>
              <button
                onClick={() => navigate("/register")}
                className="w-full bg-[#F4A800] text-black py-2.5 rounded-lg font-semibold text-sm hover:bg-[#ffba1f] transition-colors"
              >
                Comenzar 14 días gratis
              </button>
            </div>
          </Reveal>
        </div>
        {/* Plan Pro: próximamente */}
        <Reveal variant="up" className="max-w-3xl mx-auto mt-6">
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-8 py-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold">Plan Pro</p>
                <span className="bg-primary/10 text-primary text-xs font-bold px-2.5 py-1 rounded-full">PRÓXIMAMENTE</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Para equipos grandes y cobranza a gran escala.
              </p>
            </div>
            <button
              onClick={() => navigate("/register")}
              className="text-sm font-semibold text-primary hover:underline underline-offset-4"
            >
              Crea tu cuenta y únete a la lista de espera →
            </button>
          </div>
        </Reveal>
        <p className="text-center text-sm text-muted-foreground mt-8">
          CLP · IVA incluido · La prueba de 14 días incluye todas las funciones del plan NextCob. Cancela cuando quieras.
        </p>
      </div>
    </section>
  );
}

function QuienesSomosSection() {
  return (
    <section id="nosotros" className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <Reveal variant="left">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-5">Quiénes somos</h2>
            <p className="text-primary font-semibold leading-relaxed mb-4">
              Una plataforma construida por emprendedores, para emprendedores.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Construimos NextCob porque vimos de cerca cómo las empresas pierden control sobre su dinero — no porque no vendan, sino porque no cobran a tiempo.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              NextCob nació para cambiar eso: darte visibilidad total sobre tu cartera, predecir cuándo te pagarán y automatizar la gestión para que tú te enfoques en hacer crecer tu negocio.
            </p>
            <p className="font-medium text-foreground leading-relaxed">
              Nuestra misión: que nunca pierdas el control del dinero que te deben.
            </p>
          </div>
          </Reveal>
          <div className="grid grid-cols-1 gap-4">
            {[
              { icon: CreditCard, label: "Pagos con Webpay y MercadoPago" },
              { icon: Bot, label: "Diana incluida" },
              { icon: Coins, label: "Cobros parciales y seguimiento automático" },
              { icon: Sparkles, label: "14 días de prueba gratis" },
            ].map((item, i) => (
              <Reveal key={item.label} variant="right" delayMs={i * 100}>
                <div className="card-lift bg-card border rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:border-primary/30 transition-colors">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                </div>
              </Reveal>
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
        <Reveal variant="up">
          <h2 className="text-3xl font-bold text-white mb-4">Toma el control de tus cuentas por cobrar hoy</h2>
          <p className="text-white/75 text-lg mb-8 leading-relaxed">
            14 días gratis. Sin tarjeta de crédito. Tu primer cobro en 5 minutos.
          </p>
          <button
            onClick={() => navigate("/register")}
            className="btn-pulse inline-flex items-center gap-2 bg-[#F4A800] text-black px-8 py-3.5 rounded-lg text-base font-bold shadow-lg shadow-[#F4A800]/20 hover:bg-[#ffba1f] transition-colors"
          >
            Crear mi cuenta gratis
            <ChevronRight className="h-5 w-5" />
          </button>
        </Reveal>
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
      <SaludCarteraSection />
      <PreciosSection />
      <QuienesSomosSection />
      <CtaSection />
      <Footer />
      <LandingChat />
    </div>
  );
}
