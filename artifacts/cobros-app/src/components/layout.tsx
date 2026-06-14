import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, Plus, Activity, Webhook, LogOut, Search, UserCircle, Users } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useWebhookPolling } from "@/hooks/use-webhook-polling";

function UserBadge() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initials = [user.firstName, user.lastName]
    .filter(Boolean)
    .map((n) => n![0].toUpperCase())
    .join("") || "U";

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Usuario";

  return (
    <div className="flex items-center gap-3 ml-4 pl-4 border-l">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt={displayName}
          className="h-8 w-8 rounded-full object-cover ring-2 ring-border"
        />
      ) : (
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold ring-2 ring-border">
          {initials}
        </div>
      )}
      <span className="text-sm font-medium text-foreground hidden sm:block max-w-[120px] truncate">
        {displayName}
      </span>
      <button
        onClick={logout}
        title="Cerrar sesión"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Salir</span>
      </button>
    </div>
  );
}

function WebhookPoller() {
  useWebhookPolling();
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/cobros/nuevo", label: "Nuevo cobro", icon: Plus },
    { href: "/cobros/buscar", label: "Buscar", icon: Search },
    { href: "/clientes", label: "Clientes", icon: Users },
    { href: "/webhooks/log", label: "Log webhooks", icon: Webhook },
    { href: "/perfil", label: "Perfil", icon: UserCircle },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <WebhookPoller />
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <Activity className="h-4 w-4" />
            </div>
            <span className="font-bold text-lg tracking-tight">Cobros App</span>
          </div>

          <div className="flex items-center">
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors hover:bg-secondary/80 ${
                    location === item.href
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    <span className="hidden md:inline">{item.label}</span>
                  </div>
                </Link>
              ))}
            </nav>
            <UserBadge />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
