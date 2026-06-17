import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, Plus, Search, Users, Landmark, Webhook, UserCircle, Activity, LogOut, List, Shield } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useWebhookPolling } from "@/hooks/use-webhook-polling";
import { AiChat } from "@/components/ai-chat";

function WebhookPoller() {
  useWebhookPolling();
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "admin";

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/cobros", label: "Cobros", icon: List },
    { href: "/cobros/nuevo", label: "Nuevo cobro", icon: Plus },
    { href: "/cobros/buscar", label: "Buscar", icon: Search },
    { href: "/clientes", label: "Clientes", icon: Users },
    { href: "/liquidaciones", label: "Liquidaciones", icon: Landmark },
    { href: "/webhooks/log", label: "Log webhooks", icon: Webhook },
    { href: "/perfil", label: "Perfil", icon: UserCircle },
  ];

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Usuario"
    : "";

  const initials = user
    ? ([user.firstName, user.lastName].filter(Boolean).map((n) => n![0].toUpperCase()).join("") || "U")
    : "U";

  return (
    <div className="min-h-[100dvh] flex bg-background text-foreground">
      <WebhookPoller />

      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col border-r bg-card">
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 border-b">
          <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm shrink-0">
            <Activity className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg tracking-tight">Cobros App</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
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
        <main className="flex-1 px-8 py-8 overflow-y-auto">
          {children}
        </main>
      </div>

      <AiChat />
    </div>
  );
}
