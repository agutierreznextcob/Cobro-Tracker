import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import NewCobro from "@/pages/new-cobro";
import CobrosList from "@/pages/cobros-list";
import CobroDetail from "@/pages/cobro-detail";
import WebhookLog from "@/pages/webhook-log";
import SearchPage from "@/pages/search";
import ProfilePage from "@/pages/profile";
import ClientesPage from "@/pages/clientes";
import ClienteDetailPage from "@/pages/cliente-detail";
import LiquidacionesPage from "@/pages/liquidaciones";
import LiquidacionDetailPage from "@/pages/liquidacion-detail";
import { Layout } from "@/components/layout";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetSubscriptionStatus } from "@workspace/api-client-react";
import { SubscriptionRequired } from "@/components/subscription-required";

const queryClient = new QueryClient();

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-muted-foreground text-sm">Cargando...</div>
    </div>
  );
}

function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { data: status, isLoading } = useGetSubscriptionStatus();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (status && !status.hasAccess) {
    return <SubscriptionRequired />;
  }

  return <>{children}</>;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }

  return <SubscriptionGate>{children}</SubscriptionGate>;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/dashboard">
        <AuthGate>
          <Layout>
            <Dashboard />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cobros" nest={false}>
        <AuthGate>
          <Layout>
            <CobrosList />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cobros/nuevo">
        <AuthGate>
          <Layout>
            <NewCobro />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cobros/buscar">
        <AuthGate>
          <Layout>
            <SearchPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cobros/:id">
        {(params) => (
          <AuthGate>
            <Layout>
              <CobroDetail />
            </Layout>
          </AuthGate>
        )}
      </Route>
      <Route path="/clientes">
        <AuthGate>
          <Layout>
            <ClientesPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/clientes/:id">
        {(params) => (
          <AuthGate>
            <Layout>
              <ClienteDetailPage />
            </Layout>
          </AuthGate>
        )}
      </Route>
      <Route path="/liquidaciones">
        <AuthGate>
          <Layout>
            <LiquidacionesPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/liquidaciones/:id">
        {(params) => (
          <AuthGate>
            <Layout>
              <LiquidacionDetailPage params={params} />
            </Layout>
          </AuthGate>
        )}
      </Route>
      <Route path="/webhooks/log">
        <AuthGate>
          <Layout>
            <WebhookLog />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/perfil">
        <AuthGate>
          <Layout>
            <ProfilePage />
          </Layout>
        </AuthGate>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
