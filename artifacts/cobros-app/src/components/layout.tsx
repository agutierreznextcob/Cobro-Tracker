import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Home, Plus, Search, Users, Landmark, Webhook, UserCircle, LogOut, List, Shield, BarChart3, Bell, CalendarClock, Inbox, Menu, X } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useWebhookPolling } from "@/hooks/use-webhook-polling";
import { useNotificacionesPolling } from "@/hooks/use-notificaciones-polling";
import { useLeadsCountPolling } from "@/hooks/use-leads-count-polling";
import { AiChat } from "@/components/ai-chat";

function WebhookPoller() {
  useWebhookPolling();
  return null;
}

function NotificacionesPoller() {
  useNotificacionesPolling();
  return null;
}

function LeadsNavItem({
  location,
  onNavigate,
}: {
  location: string;
  onNavigate: () => void;
}) {
  const nuevos = useLeadsCountPolling(true);
  const active = location === "/leads";
  return (
    <Link
      href="/leads"
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
      }`}
    >
      <Inbox
        className={`h-4 w-4 shrink-0 ${
          active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
        }`}
      />
      <span>Leads</span>
      {nuevos > 0 && (
        <span
          className={`ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold ${
            active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
          }`}
        >
          {nuevos > 99 ? "99+" : nuevos}
        </span>
      )}
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.role === "admin";

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/cobros", label: "Cobros", icon: List },
    { href: "/cobros/nuevo", label: "Nuevo cobro", icon: Plus },
    { href: "/cobros/buscar", label: "Buscar", icon: Search },
    { href: "/cobros/informes", label: "Informes", icon: BarChart3 },
    { href: "/clientes", label: "Clientes", icon: Users },
    { href: "/liquidaciones", label: "Liquidaciones", icon: Landmark },
    { href: "/notificaciones", label: "Notificaciones", icon: Bell },
    { href: "/recordatorios/config", label: "Recordatorios", icon: CalendarClock },
    { href: "/webhooks/log", label: "Log webhooks", icon: Webhook },
    { href: "/perfil", label: "Perfil", icon: UserCircle },
  ];

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Usuario"
    : "";

  const initials = user
    ? ([user.firstName, user.lastName].filter(Boolean).map((n) => n![0].toUpperCase()).join("") || "U")
    : "U";

  const closeMobile = () => setMobileOpen(false);

  // Close drawer on Escape and lock background scroll while open (mobile only)
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-[100dvh] flex bg-background text-foreground">
      <WebhookPoller />
      <NotificacionesPoller />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="sidebar-nav"
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r bg-card transform transition-transform duration-200 md:static md:z-auto md:w-60 md:shrink-0 md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 border-b">
          <img
            src={`${import.meta.env.BASE_URL}brand/nextcob-logo.png`}
            alt="NextCob"
            className="h-8 w-auto object-contain shrink-0"
          />
          <button
            onClick={closeMobile}
            className="md:hidden ml-auto p-1.5 -mr-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                }`}
              >
                <item.icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {isAdmin && (
            <div className="pt-4 mt-3 border-t">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Administración
              </p>
              <Link
                href="/admin"
                onClick={closeMobile}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
                  location === "/admin"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                }`}
              >
                <Shield
                  className={`h-4 w-4 shrink-0 ${
                    location === "/admin"
                      ? "text-primary-foreground"
                      : "text-muted-foreground group-hover:text-foreground"
                  }`}
                />
                <span>Usuarios</span>
              </Link>
              <LeadsNavItem location={location} onNavigate={closeMobile} />
            </div>
          )}
        </nav>

        {/* User footer */}
        {user && (
          <div className="border-t px-3 py-3">
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
              {user.profileImageUrl ? (
                <img
                  src={user.profileImageUrl}
                  alt={displayName}
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-border shrink-0"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold ring-2 ring-border shrink-0">
                  {initials}
                </div>
              )}
              <span className="text-sm font-medium text-foreground flex-1 truncate">
                {displayName}
              </span>
              <button
                onClick={logout}
                title="Cerrar sesión"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors shrink-0"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-4 border-b bg-card/95 backdrop-blur">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 rounded-md text-foreground hover:bg-secondary/80 transition-colors"
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
            aria-controls="sidebar-nav"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <img
              src={`${import.meta.env.BASE_URL}brand/nextcob-logo.png`}
              alt="NextCob"
              className="h-7 w-auto"
            />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 overflow-y-auto">
          {children}
        </main>
      </div>

      <AiChat />
    </div>
  );
}
