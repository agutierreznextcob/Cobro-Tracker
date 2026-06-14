import { useAuth } from "@workspace/replit-auth-web";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Link2,
  Share2,
  Sparkles,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

function LandingNav() {
  const { login } = useAuth();
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
            <Activity className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg tracking-tight">Cobro Simple</span>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#como-funciona" className="hover:text-foreground transition-colors">Cómo funciona</a>
          <a href="#caracteristicas" className="hover:text-foreground transition-colors">Características</a>
          <a href="#precios" className="hover:text-foreground transition-colors">Precios</a>
          <a href="#nosotros" className="hover:text-foreground transition-colors">Nosotros</a>
        </nav>
        <div className="flex items-center gap-3">
          <button
            onClick={login}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-md hover:bg-secondary/60"
          >
            Iniciar sesión
          </button>
          <button
            onClick={login}
            className="text-sm font-semibold bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow hover:bg-primary/90 transition-colors"
          >
            Crear cuenta
          </button>
        </div>
      </div>
    </header>
  );
}

function HeroSection() {
  const { login } = useAuth();
  return (
    <section className="pt-32 pb-20 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-medium mb-8 border border-primary/20">
          <Sparkles className="h-3.5 w-3.5" />
          Con asistente IA incluido
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground leading-[1.1] mb-6">
          Cobra a tus clientes{" "}
          <span className="text-primary">sin complicaciones</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Crea cobros, comparte links de pago con Webpay y recibe tu dinero
          directamente. Con dashboard en tiempo real y asistente IA para
          analizar tu negocio.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={login}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg text-base font-semibold shadow-md hover:bg-primary/90 transition-colors w-full sm:w-auto justify-center"
          >
            Comenzar gratis
            <ArrowRight className="h-4 w-4" />
          </button>
          <a
            href="#como-funciona"
            className="inline-flex items-center gap-2 border border-border text-foreground px-6 py-3 rounded-lg text-base font-semibold hover:bg-secondary/60 transition-colors w-full sm:w-auto justify-center"
          >
            Ver cómo funciona
          </a>
        </div>
        <p className="text-sm text-muted-foreground mt-5">
          Primeros 30 días gratis · Sin tarjeta de crédito
        </p>

        {/* App preview mockup */}
        <div className="mt-16 rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden text-left">
          <div className="bg-muted/40 border-b px-4 py-3 flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-yellow-400" />
            <div className="h-3 w-3 rounded-full bg-green-400" />
            <div className="mx-auto text-xs text-muted-foreground font-mono">cobrosimple.app/dashboard</div>
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
                { desc: "Servicio mensual Plan Pro", monto: "$85.000", estado: "Pagado", col: "text-green-700 bg-green-50" },
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
      desc: "Ingresa el monto, descripción y el cliente. En segundos tienes tu cobro registrado y listo para enviar.",
    },
    {
      number: "02",
      icon: Share2,
      title: "Comparte el link",
      desc: "Genera un link de pago con Webpay con un clic y envíalo por WhatsApp, email o donde prefieras.",
    },
    {
      number: "03",
      icon: Wallet,
      title: "Recibe el pago",
      desc: "Tu cliente paga online y el dinero llega a tu cuenta. Ves todo en el dashboard en tiempo real.",
    },
  ];
  return (
    <section id="como-funciona" className="py-20 px-6 bg-muted/20 border-y border-border/50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Cómo funciona</h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Tres pasos simples para cobrar a cualquier cliente en Chile.
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
    { icon: BarChart3, title: "Dashboard en tiempo real", desc: "Métricas de recaudación, cobros pendientes, ticket promedio y más. Todo actualizado al instante." },
    { icon: Link2, title: "Links de pago Webpay", desc: "Integración nativa con Flow/Webpay. Tus clientes pagan con tarjeta de crédito, débito o transferencia." },
    { icon: Bot, title: "Asistente IA incluido", desc: "Pregúntale: '¿Cuánto recaudé este mes?' o '¿Qué clientes tienen cobros pendientes?'" },
    { icon: Users, title: "Gestión de clientes", desc: "Organiza tus clientes con RUT, email y teléfono. Ve el historial completo de cobros de cada uno." },
    { icon: Wallet, title: "Liquidaciones automáticas", desc: "Revisa tus liquidaciones de Flow directamente desde la plataforma. Sin cambiar de pantalla." },
    { icon: Zap, title: "Notificaciones en tiempo real", desc: "Recibe notificaciones automáticas cuando un cobro cambia de estado. Siempre al día." },
  ];
  return (
    <section id="caracteristicas" className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Todo lo que necesitas para cobrar</h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Una plataforma completa para gestionar tus cobros en Chile, sin complicaciones.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div key={i} className="bg-card border rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
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
  const { login } = useAuth();
  return (
    <section id="precios" className="py-20 px-6 bg-muted/20 border-y border-border/50">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Precios simples y transparentes</h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Comienza gratis. Sin sorpresas ni letras chicas.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <div className="bg-card border rounded-2xl p-8 shadow-sm flex flex-col">
            <div className="mb-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Gratuito</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-black">$0</span>
                <span className="text-muted-foreground pb-1 text-sm">/mes</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">Primeros 30 días. Sin tarjeta de crédito.</p>
            </div>
            <ul className="space-y-3 flex-1 mb-8">
              {["Cobros ilimitados", "Links de pago Webpay", "Dashboard en tiempo real", "Gestión de clientes", "Liquidaciones Flow", "Asistente IA básico"].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <button
              onClick={login}
              className="w-full border border-primary text-primary py-2.5 rounded-lg font-semibold text-sm hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              Comenzar gratis
            </button>
          </div>

          <div className="bg-primary text-primary-foreground rounded-2xl p-8 shadow-xl flex flex-col relative overflow-hidden">
            <div className="absolute top-5 right-5">
              <span className="bg-white/20 border border-white/30 text-primary-foreground text-xs font-bold px-2.5 py-1 rounded-full">POPULAR</span>
            </div>
            <div className="mb-6">
              <p className="text-xs font-semibold text-primary-foreground/60 uppercase tracking-wider mb-2">Pro</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-black">$15.000</span>
                <span className="text-primary-foreground/60 pb-1 text-sm">/mes</span>
              </div>
              <p className="text-sm text-primary-foreground/70 mt-2">CLP · Facturación mensual</p>
            </div>
            <ul className="space-y-3 flex-1 mb-8">
              {["Todo lo del plan gratuito", "Asistente IA sin límites", "Múltiples usuarios", "Exportación CSV avanzada", "Soporte prioritario", "Integraciones personalizadas"].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary-foreground/70 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <button
              onClick={login}
              className="w-full bg-white text-primary py-2.5 rounded-lg font-semibold text-sm hover:bg-white/90 transition-colors"
            >
              Comenzar 30 días gratis
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
            <p className="text-muted-foreground leading-relaxed mb-4">
              Somos un equipo de emprendedores chilenos que sufrió en carne propia el dolor de cobrar: hojas de cálculo, transferencias perdidas y clientes que "van a pagar la próxima semana".
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Creamos Cobro Simple para que cualquier freelancer, pyme o negocio chileno pueda cobrar de forma profesional, con Webpay integrado y sin depender de un contador o programador.
            </p>
            <p className="font-medium text-foreground leading-relaxed">
              Nuestra misión: que te paguen a tiempo.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: "500+", label: "Usuarios activos" },
              { value: "$200M", label: "CLP procesados" },
              { value: "98%", label: "Tasa de cobro" },
              { value: "24/7", label: "Disponibilidad" },
            ].map((stat) => (
              <div key={stat.label} className="bg-card border rounded-2xl p-6 text-center shadow-sm hover:border-primary/30 transition-colors">
                <p className="text-3xl font-black text-primary mb-1">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  const { login } = useAuth();
  return (
    <section className="py-20 px-6 bg-primary">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold text-primary-foreground mb-4">Empieza a cobrar hoy mismo</h2>
        <p className="text-primary-foreground/75 text-lg mb-8 leading-relaxed">
          30 días gratis, sin tarjeta de crédito. Configura tu primer cobro en menos de 5 minutos.
        </p>
        <button
          onClick={login}
          className="inline-flex items-center gap-2 bg-white text-primary px-8 py-3.5 rounded-lg text-base font-bold shadow-lg hover:bg-white/90 transition-colors"
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
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
                <Activity className="h-3.5 w-3.5" />
              </div>
              <span className="font-bold text-sm">Cobro Simple</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">La forma más simple de cobrar en Chile.</p>
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
              <li><a href="mailto:hola@cobrosimple.cl" className="hover:text-foreground transition-colors">hola@cobrosimple.cl</a></li>
              <li>+56 9 1234 5678</li>
              <li>Santiago, Chile</li>
            </ul>
          </div>
        </div>
        <div className="border-t pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">© 2025 Cobro Simple. Todos los derechos reservados.</p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Términos y condiciones</a>
            <a href="#" className="hover:text-foreground transition-colors">Privacidad</a>
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
    </div>
  );
}
