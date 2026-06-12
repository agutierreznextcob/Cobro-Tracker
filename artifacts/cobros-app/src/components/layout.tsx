import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, Plus, Activity, Webhook } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/cobros/nuevo", label: "Nuevo cobro", icon: Plus },
    { href: "/webhooks/log", label: "Log webhooks", icon: Webhook },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <Activity className="h-4 w-4" />
            </div>
            <span className="font-bold text-lg tracking-tight">Cobros App</span>
          </div>
          
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
                  {item.label}
                </div>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
