import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Home, Plus, Search, Users, UserCircle, LogOut, List, Shield, BarChart3, Bell, CalendarClock, Inbox, Menu, X, Workflow, CheckSquare, MessageSquare, Lock, Clock, ChevronDown, Calendar, Star, ListTodo, Boxes, Warehouse } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useListNotificaciones, getListNotificacionesQueryKey, useGetSubscriptionStatus, useGetGestionResumen, getGetGestionResumenQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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

// Barra fija roja mostrada durante una sesión de consultor de soporte NextCob
// (Ley 21.719: el acceso es visible y auditado).
function ConsultorBar() {
  const { user } = useAuth();
  if (!user?.esConsultor) return null;
  const cuentaNombre =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.companyName ||
    user.email ||
    "";
  const hora = user.consultorInicioEn
    ? new Date(user.consultorInicioEn).toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
  const cerrarSesion = () => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
    fetch("/api/consultor/logout", { method: "POST", credentials: "include" })
      .catch(() => {})
      .finally(() => {
        window.location.href = `${base}/consultor`;
      });
  };
  return (
    <div className="fixed top-0 inset-x-0 z-[60] h-10 bg-red-600 text-white flex items-center justify-between gap-2 px-3 text-xs sm:text-sm shadow-md">
      <div className="truncate font-medium">
        ⚠️ MODO CONSULTOR — Cuenta: {cuentaNombre} ({user.accountId ?? "—"})
        {hora ? ` | Ingreso: ${hora}` : ""}
        {user.consultorNombre ? ` | ${user.consultorNombre}` : ""}
      </div>
      <button
        onClick={cerrarSesion}
        className="shrink-0 rounded bg-white/15 hover:bg-white/25 px-2.5 py-1 font-medium transition-colors"
      >
        Cerrar sesión consultor
      </button>
    </div>
  );
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

function NotificacionesNavItem({
  location,
  onNavigate,
}: {
  location: string;
  onNavigate: () => void;
}) {
  // Comparte cache con useNotificacionesPolling (misma query key), sin refetch propio.
  const { data } = useListNotificaciones(
    { soloNoLeidas: true },
    { query: { queryKey: getListNotificacionesQueryKey({ soloNoLeidas: true }) } },
  );
  const noLeidas = data?.length ?? 0;
  const active = location === "/notificaciones";
  return (
    <Link
      href="/notificaciones"
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
      }`}
    >
      <Bell
        className={`h-4 w-4 shrink-0 ${
          active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
        }`}
      />
      <span>Notificaciones</span>
      {noLeidas > 0 && (
        <span
          data-testid="badge-notificaciones"
          className={`ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold ${
            active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
          }`}
        >
          {noLeidas > 99 ? "99+" : noLeidas}
        </span>
      )}
    </Link>
  );
}

// Aviso de fin de prueba: visible desde 7 días antes; urgente desde 2 días.
function TrialBanner() {
  const { data: sub } = useGetSubscriptionStatus();
  const [, navigate] = useLocation();
  if (!sub || sub.status !== "prueba" || sub.isAdmin) return null;
  const dias = sub.diasRestantes;
  if (dias == null || dias > 7) return null;
  const urgente = dias <= 2;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm ${
        urgente
          ? "bg-red-600 text-white"
          : "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
      data-testid="banner-trial"
    >
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 shrink-0" />
        <span>
          {urgente
            ? dias <= 0
              ? "Tu prueba gratuita termina hoy. Elige un plan para no perder acceso."
              : `Tu prueba gratuita termina en ${dias} día${dias === 1 ? "" : "s"}. Elige un plan para no perder acceso.`
            : `Te quedan ${dias} días de prueba gratuita. Elige tu plan para continuar sin interrupciones.`}
        </span>
      </div>
      <Button
        size="sm"
        variant={urgente ? "secondary" : "default"}
        className="h-7"
        onClick={() => navigate("/perfil")}
        data-testid="button-banner-ver-planes"
      >
        Ver planes
      </Button>
    </div>
  );
}

function GestionNavGroup({ closeMobile, esStarter, setUpgradeFeature }: { closeMobile: () => void, esStarter: boolean, setUpgradeFeature: (f: string) => void }) {
  const [location, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(() => location.startsWith("/gestion") || location.startsWith("/tareas"));

  const { data } = useGetGestionResumen({ query: { queryKey: getGetGestionResumenQueryKey() } });
  const badgeTotal = data ? (data.total || 0) : 0;

  const subItems = [
    { href: "/gestion/hoy", label: "Qué hacer hoy", icon: Calendar, badge: data?.compromisosPendientes },
    { href: "/gestion/clientes-prioritarios", label: "Clientes prioritarios", icon: Star },
    { href: "/gestion/tareas", label: "Tareas", icon: ListTodo, badge: data?.tareasPendientes },
  ];

  const isActive = location.startsWith("/gestion") || location.startsWith("/tareas");

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group ${
          isActive && !isOpen
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
        }`}
      >
        <div className="flex items-center gap-3">
          <CheckSquare className={`h-4 w-4 shrink-0 ${
            isActive && !isOpen ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
          }`} />
          <span>Gestión</span>
        </div>
        <div className="flex items-center gap-2">
          {badgeTotal > 0 && (
            <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold ${
              isActive && !isOpen ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
            }`}>
              {badgeTotal > 99 ? "99+" : badgeTotal}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {isOpen && (
        <div className="pl-9 pr-2 py-1 space-y-1">
          {subItems.map(item => {
            const isSubActive = location === item.href || (item.href === '/gestion/tareas' && location === '/tareas');
            const hasBadge = typeof item.badge === 'number' && item.badge > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isSubActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <item.icon className={`h-3.5 w-3.5 shrink-0 ${isSubActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span>{item.label}</span>
                </div>
                {hasBadge && (
                  <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold bg-primary text-primary-foreground`}>
                    {item.badge! > 99 ? "99+" : item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: subStatus } = useGetSubscriptionStatus();
  // Candados del plan Starter (el trial y las cuentas demo operan como NextCob).
  const esStarter = subStatus?.planEfectivo === "starter";
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/cobros/nuevo", label: "Nuevo cobro", icon: Plus },
    { href: "/cobros", label: "Cobros", icon: List },
    { href: "/cobros/buscar", label: "Buscar", icon: Search },
    { href: "/clientes", label: "Clientes", icon: Users },
    { href: "/inventario", label: "Inventario", icon: Boxes },
    { href: "/locales", label: "Locales y bodegas", icon: Warehouse },
    { id: "gestion_group" },
    { id: "notificaciones" },
    { href: "/recordatorios/config", label: "Recordatorios", icon: CalendarClock, feature: "Recordatorios automáticos" },
    { href: "/workflows", label: "Automatización", icon: Workflow, feature: "Workflows inteligentes" },
    { href: "/encuestas", label: "Satisfacción", icon: MessageSquare, feature: "Encuestas de satisfacción" },
    { href: "/cobros/informes", label: "Informes", icon: BarChart3 },
    { href: "/perfil", label: "Perfil", icon: UserCircle },
  ] as Array<
    | { href: string; label: string; icon: typeof Home; feature?: string }
    | { id: "gestion_group" | "notificaciones" }
  >;

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

  const esConsultor = !!user?.esConsultor;

  return (
    <div
      className={`min-h-[100dvh] flex bg-background text-foreground ${esConsultor ? "pt-10" : ""}`}
    >
      <ConsultorBar />
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
            if ("id" in item && item.id === "gestion_group") {
              return <GestionNavGroup key="gestion_group" closeMobile={closeMobile} esStarter={esStarter} setUpgradeFeature={setUpgradeFeature} />;
            }
            if ("id" in item && item.id === "notificaciones") {
              return <NotificacionesNavItem key="notificaciones" location={location} onNavigate={closeMobile} />;
            }
            if (!("href" in item)) return null;

            const isActive = location === item.href || (item.href === "/inventario" && location.startsWith("/inventario/")) || (item.href === "/locales" && (location.startsWith("/locales/") || location.startsWith("/bodegas/")));
            const bloqueado = esStarter && !!item.feature;
            return (
              <div key={item.href} className="space-y-0.5">
              {bloqueado ? (
                <button
                  type="button"
                  onClick={() => setUpgradeFeature(item.feature!)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group text-muted-foreground/70 hover:bg-secondary/60"
                  data-testid={`nav-locked-${item.href.replace(/\//g, "")}`}
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <span>{item.label}</span>
                  <Lock className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground/60" />
                </button>
              ) : (
              <Link
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
              )}
              </div>
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

        <TrialBanner />
        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Diana: solo plan NextCob (trial/demo incluidos). */}
      {!esStarter && <AiChat />}

      {/* Mensaje al intentar usar una función bloqueada en Starter. */}
      <Dialog open={upgradeFeature != null} onOpenChange={(o) => !o && setUpgradeFeature(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Función del plan NextCob
            </DialogTitle>
            <DialogDescription>
              {upgradeFeature} está disponible en el plan NextCob. Mejora tu plan para
              desbloquear esta y todas las funciones avanzadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeFeature(null)}>
              Ahora no
            </Button>
            <Button
              onClick={() => {
                setUpgradeFeature(null);
                closeMobile();
                navigate("/perfil");
              }}
              data-testid="button-upgrade-ver-planes"
            >
              Ver planes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
