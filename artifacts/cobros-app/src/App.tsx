import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import ResendVerificationPage from "@/pages/resend-verification";
import Dashboard from "@/pages/dashboard";
import NewCobro from "@/pages/new-cobro";
import CobrosList from "@/pages/cobros-list";
import CobroDetail from "@/pages/cobro-detail";
import WebhookLog from "@/pages/webhook-log";
import SearchPage from "@/pages/search";
import Informes from "@/pages/informes";
import ProfilePage from "@/pages/profile";
import ClientesPage from "@/pages/clientes";
import ClienteDetailPage from "@/pages/cliente-detail";
import AdminPage from "@/pages/admin";
import LeadsPage from "@/pages/leads";
import PortalPage from "@/pages/portal";
import LiquidacionesPage from "@/pages/liquidaciones";
import LiquidacionDetailPage from "@/pages/liquidacion-detail";
import Notificaciones from "@/pages/notificaciones";
import RecordatoriosConfig from "@/pages/recordatorios-config";
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

function AuthGate({
  children,
  skipProfile = false,
}: {
  children: React.ReactNode;
  skipProfile?: boolean;
}) {
  // Single source of resolved auth state for this chain. We deliberately read
  // user/isLoading/isAuthenticated from ONE useAuth() call so the profile gate
  // can't race a separate, still-loading instance and leak protected content.
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }

  // Force first-login users through the mandatory profile-completion form.
  if (!skipProfile && user && !user.profileCompleted) {
    return <Redirect to="/perfil" />;
  }

  return <SubscriptionGate>{children}</SubscriptionGate>;
}

function AdminGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }

  // Admins must also complete their profile before reaching any section.
  if (user && !user.profileCompleted) {
    return <Redirect to="/perfil" />;
  }

  if (user?.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  return <>{children}</>;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/resend-verification" component={ResendVerificationPage} />
      <Route path="/portal/:token" component={PortalPage} />
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
      <Route path="/cobros/informes">
        <AuthGate>
          <Layout>
            <Informes />
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
      <Route path="/notificaciones">
        <AuthGate>
          <Layout>
            <Notificaciones />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/recordatorios/config">
        <AuthGate>
          <Layout>
            <RecordatoriosConfig />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/webhooks/log">
        <AuthGate>
          <Layout>
            <WebhookLog />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/perfil">
        <AuthGate skipProfile>
          <Layout>
            <ProfilePage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/admin">
        <AdminGate>
          <Layout>
            <AdminPage />
          </Layout>
        </AdminGate>
      </Route>
      <Route path="/leads">
        <AdminGate>
          <Layout>
            <LeadsPage />
          </Layout>
        </AdminGate>
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
