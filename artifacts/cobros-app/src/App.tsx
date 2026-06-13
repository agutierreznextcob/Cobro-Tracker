import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import NewCobro from "@/pages/new-cobro";
import CobroDetail from "@/pages/cobro-detail";
import WebhookLog from "@/pages/webhook-log";
import SearchPage from "@/pages/search";
import { Layout } from "@/components/layout";
import { useAuth } from "@workspace/replit-auth-web";

const queryClient = new QueryClient();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, login } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Cargando...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6 p-8 rounded-xl border bg-card shadow-sm max-w-sm w-full">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Cobros</h1>
            <p className="text-muted-foreground text-sm">
              Inicia sesión para acceder al sistema de gestión de cobros.
            </p>
          </div>
          <button
            onClick={login}
            className="w-full inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-4 py-2 text-sm font-medium shadow hover:bg-primary/90 transition-colors"
          >
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/cobros/nuevo" component={NewCobro} />
        <Route path="/cobros/buscar" component={SearchPage} />
        <Route path="/cobros/:id" component={CobroDetail} />
        <Route path="/webhooks/log" component={WebhookLog} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <Router />
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
