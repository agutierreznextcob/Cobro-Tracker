import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { ArrowRight, LogOut, Menu, UserCircle, X } from "lucide-react";
import { LandingChat } from "@/components/landing-chat";
import { DemoRequestModal } from "@/components/demo-request-modal";
import "@/pages/landing.css";

export const NAV = [
  { href: "/como-funciona", label: "Cómo funciona" },
  { href: "/caracteristicas", label: "Características" },
  { href: "/precios", label: "Precios" },
  { href: "/nosotros", label: "Nosotros" },
];

const LOGO = `${import.meta.env.BASE_URL}brand/nextcob-logo.png`;

function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", "website");
    return () => {
      document.title = prev;
    };
  }, [title, description]);
}

export function DemoButton({ className = "", label = "Agenda una presentación" }: { className?: string; label?: string }) {
  return (
    <DemoRequestModal
      contentClassName="nc-dialog"
      trigger={
        <button type="button" data-testid="button-demo" className={`landing-secondary inline-flex items-center justify-center gap-2 font-semibold ${className}`}>
          {label}
        </button>
      }
    />
  );
}

export function RegisterButton({ className = "", label = "Crear cuenta" }: { className?: string; label?: string }) {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      data-testid="button-register"
      onClick={() => navigate("/register")}
      className={`landing-cta inline-flex items-center justify-center gap-2 font-semibold ${className}`}
    >
      {label}
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}

function AccountArea() {
  const { login, logout, isAuthenticated, user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-account-menu]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={login} data-testid="button-login" className="text-sm font-medium px-3 py-2 hover:text-[#E86B2A] transition-colors">
          Iniciar sesión
        </button>
        <div className="hidden lg:block"><DemoButton className="text-sm px-4 py-2" /></div>
        <div className="hidden sm:block"><RegisterButton className="text-sm px-4 py-2" /></div>
      </div>
    );
  }

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Mi cuenta";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="button-dashboard"
        onClick={() => navigate("/dashboard")}
        className="landing-cta hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2"
      >
        Ir al dashboard <ArrowRight className="h-4 w-4" />
      </button>
      <div className="relative" data-account-menu>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Menú de cuenta"
          data-testid="button-account-menu"
          className="h-9 w-9 inline-flex items-center justify-center border border-[#0A0A0A] text-sm font-semibold hover:bg-[#FFF4EC] transition-colors"
        >
          {(name[0] || "?").toUpperCase()}
        </button>
        {open && (
          <div role="menu" className="absolute right-0 mt-2 w-60 border border-[#0A0A0A] bg-white shadow-[6px_6px_0_0_#0D6E6E] z-50">
            <div className="px-4 py-3 border-b nc-rule">
              <p className="text-sm font-semibold truncate">{name}</p>
              {user?.email && <p className="text-xs text-neutral-600 truncate">{user.email}</p>}
            </div>
            <button role="menuitem" type="button" onClick={() => { setOpen(false); navigate("/dashboard"); }} className="sm:hidden flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#FBFAF7]">
              <ArrowRight className="h-4 w-4" /> Ir al dashboard
            </button>
            <button role="menuitem" type="button" onClick={() => { setOpen(false); navigate("/perfil"); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#FBFAF7]">
              <UserCircle className="h-4 w-4" /> Mi perfil
            </button>
            <button role="menuitem" type="button" onClick={() => { setOpen(false); logout(); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#FBFAF7] border-t nc-rule">
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MarketingNav() {
  const [location] = useLocation();
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [location]);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-[#0A0A0A]">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" aria-label="NextCob, inicio" data-testid="link-home" className="flex items-center shrink-0">
          <img src={LOGO} alt="NextCob" className="h-8 w-auto" />
        </Link>
        <nav aria-label="Principal" className="hidden md:flex items-center gap-7 text-sm">
          <Link href="/" className="nc-navlink" aria-current={location === "/" ? "page" : undefined} data-testid="link-nav-inicio">Inicio</Link>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nc-navlink" aria-current={location === n.href ? "page" : undefined} data-testid={`link-nav${n.href.replace("/", "-")}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <AccountArea />
          <button
            type="button"
            className="md:hidden h-9 w-9 inline-flex items-center justify-center border border-[#0A0A0A]"
            aria-label={mobile ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobile}
            aria-controls="nc-mobile-nav"
            onClick={() => setMobile((v) => !v)}
            data-testid="button-mobile-menu"
          >
            {mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobile && (
        <nav id="nc-mobile-nav" aria-label="Principal móvil" className="md:hidden border-t border-[#0A0A0A] bg-white">
          {[{ href: "/", label: "Inicio" }, ...NAV].map((n) => {
            const active = location === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between px-5 py-4 border-b nc-rule text-base ${active ? "font-semibold border-l-4 border-l-[#E86B2A]" : ""}`}
              >
                {n.label}
                <ArrowRight className="h-4 w-4" />
              </Link>
            );
          })}
          <div className="p-5 grid gap-2">
            <RegisterButton className="w-full py-3" />
            <DemoButton className="w-full py-3" />
          </div>
        </nav>
      )}
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="border-t border-[#0A0A0A] bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14 grid gap-10 md:grid-cols-12">
        <div className="md:col-span-4">
          <Link href="/" aria-label="NextCob, inicio"><img src={LOGO} alt="NextCob" className="h-8 w-auto" /></Link>
          <p className="mt-4 text-sm text-neutral-600 max-w-xs leading-relaxed">
            Ventas, cobros, compras, stock e informes para negocios en Chile. En un solo sistema.
          </p>
        </div>
        <div className="md:col-span-3">
          <p className="nc-kicker mb-4">Sitio</p>
          <ul className="space-y-2.5 text-sm">
            <li><Link href="/" className="hover:text-[#E86B2A]">Inicio</Link></li>
            {NAV.map((n) => <li key={n.href}><Link href={n.href} className="hover:text-[#E86B2A]">{n.label}</Link></li>)}
          </ul>
        </div>
        <div className="md:col-span-2">
          <p className="nc-kicker mb-4">Cuenta</p>
          <ul className="space-y-2.5 text-sm">
            <li><Link href="/register" className="hover:text-[#E86B2A]">Crear cuenta</Link></li>
            <li><Link href="/login" className="hover:text-[#E86B2A]">Iniciar sesión</Link></li>
          </ul>
        </div>
        <div className="md:col-span-3">
          <p className="nc-kicker mb-4">Contacto</p>
          <ul className="space-y-2.5 text-sm">
            <li><a href="mailto:contacto@nextcob.com" className="hover:text-[#E86B2A]">contacto@nextcob.com</a></li>
            <li className="text-neutral-600">Santiago, Chile</li>
          </ul>
        </div>
      </div>
      <div className="border-t nc-rule">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-5 flex flex-col sm:flex-row gap-3 justify-between text-xs text-neutral-600">
          <p>© {new Date().getFullYear()} NextCob. Todos los derechos reservados.</p>
          <div className="flex gap-5">
            <Link href="/terminos" className="hover:text-[#0A0A0A]">Términos y condiciones</Link>
            <Link href="/privacidad" className="hover:text-[#0A0A0A]">Privacidad</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function PageHeader({ kicker, title, lead, children }: { kicker: string; title: ReactNode; lead: string; children?: ReactNode }) {
  return (
    <section className="border-b border-[#0A0A0A]">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 pt-16 pb-14 md:pt-24 md:pb-20 grid md:grid-cols-12 gap-8 items-end">
        <div className="md:col-span-8 nc-rise">
          <p className="nc-kicker mb-5">{kicker}</p>
          <h1 className="nc-display text-4xl sm:text-6xl leading-[0.98]">{title}</h1>
        </div>
        <div className="md:col-span-4 nc-rise" style={{ ["--d" as string]: "120ms" }}>
          <p className="text-lg text-neutral-700 leading-relaxed">{lead}</p>
          {children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}

export function ClosingBand({ title = "Pruébalo con tu propio negocio." }: { title?: string }) {
  return (
    <section className="bg-[#FBFAF7] border-t border-[#0A0A0A]">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 grid md:grid-cols-12 gap-6 items-center">
        <h2 className="md:col-span-7 nc-display text-3xl sm:text-4xl leading-tight">{title}</h2>
        <div className="md:col-span-5 flex flex-col sm:flex-row gap-3 md:justify-end">
          <RegisterButton className="px-6 py-3" label="Crear cuenta" />
          <DemoButton className="px-6 py-3" />
        </div>
      </div>
    </section>
  );
}

export function MarketingShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return (
    <div className="nextcob-landing min-h-[100dvh] flex flex-col">
      <a href="#nc-main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 bg-white px-3 py-2 border">Saltar al contenido</a>
      <MarketingNav />
      <main id="nc-main" className="flex-1">{children}</main>
      <MarketingFooter />
      <div className="nc-chat"><LandingChat /></div>
    </div>
  );
}
