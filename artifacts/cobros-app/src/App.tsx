import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import ComoFuncionaPage from "@/pages/marketing/como-funciona";
import CaracteristicasPage from "@/pages/marketing/caracteristicas";
import PreciosPage from "@/pages/marketing/precios";
import NosotrosPage from "@/pages/marketing/nosotros";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import ResendVerificationPage from "@/pages/resend-verification";
import PrivacidadPage from "@/pages/privacidad";
import TerminosPage from "@/pages/terminos";
import Dashboard from "@/pages/dashboard";
import NewCobro from "@/pages/new-cobro";
import CobrosList from "@/pages/cobros-list";
import CobroDetail from "@/pages/cobro-detail";
import WebhookLog from "@/pages/webhook-log";
import SearchPage from "@/pages/search";
import Informes from "@/pages/informes";
import InformesCompras from "@/pages/informes-compras";
import InformesInventario from "@/pages/informes-inventario";
import InformesAreas from "@/pages/informes-areas";
import InformesClientes from "@/pages/informes-clientes";
import InformesGestion from "@/pages/informes-gestion";
import ProfilePage from "@/pages/profile";
import ClientesPage from "@/pages/clientes";
import ClienteDetailPage from "@/pages/cliente-detail";
import AdminPage from "@/pages/admin";
import LeadsPage from "@/pages/leads";
import PortalPage from "@/pages/portal";
import Notificaciones from "@/pages/notificaciones";
import RecordatoriosConfig from "@/pages/recordatorios-config";
import WorkflowsPage from "@/pages/workflows";
import WorkflowDetail from "@/pages/workflow-detail";
import TareasPage from "@/pages/tareas";
import GestionHoyPage from "@/pages/gestion-hoy";
import ClientesPrioritariosPage from "@/pages/clientes-prioritarios";
import EncuestasPage from "@/pages/encuestas";
import EncuestaPublicaPage from "@/pages/encuesta-publica";
import ConsultorLoginPage from "@/pages/consultor-login";
import InvitacionPage from "@/pages/invitacion";
import InventarioPage from "@/pages/inventario";
import ComprasPage from "@/pages/compras";
import CompraFormPage from "@/pages/compra-form";
import CompraDetailPage from "@/pages/compra-detail";
import ProveedoresPage from "@/pages/proveedores";
import ProveedorNuevoPage from "@/pages/proveedor-nuevo";
import ProveedorDetailPage from "@/pages/proveedor-detail";
import InventarioFormPage from "@/pages/inventario-form";
import InventarioMovimientoPage from "@/pages/inventario-movimiento";
import LocalesPage from "@/pages/locales";
import LocalNuevoPage from "@/pages/local-nuevo";
import LocalDetailPage from "@/pages/local-detail";
import BodegaNuevaPage from "@/pages/bodega-nueva";
import BodegaDetailPage from "@/pages/bodega-detail";
import CotizacionesPage from "@/pages/cotizaciones";
import CotizacionFormPage from "@/pages/cotizacion-form";
import CotizacionDetailPage from "@/pages/cotizacion-detail";
import PedidosPage from "@/pages/pedidos";
import PedidoDetailPage from "@/pages/pedido-detail";
import GuiasDespachoPage from "@/pages/guias-despacho";
import GuiaDetailPage from "@/pages/guia-detail";
import PreferenciasPage from "@/pages/preferencias";
import EmpresaPage from "@/pages/empresa";
import ConfiguracionUsuariosPage from "@/pages/configuracion-usuarios";
import ConfiguracionAreasPage from "@/pages/configuracion-areas";
import { Layout } from "@/components/layout";
import { useAuth, AuthProvider } from "@workspace/replit-auth-web";
import { useGetSubscriptionStatus } from "@workspace/api-client-react";
import { SubscriptionRequired } from "@/components/subscription-required";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data stays fresh across navigation so moving between pages does
      // not re-hit the API/DB on every mount. Mutations still invalidate the
      // specific queries they affect, so this only removes redundant refetches.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

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
  skipSubscription = false,
}: {
  children: React.ReactNode;
  skipProfile?: boolean;
  skipSubscription?: boolean;
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

  // The profile page must stay reachable even without an active subscription so
  // users whose trial ended can still manage, subscribe to, or delete their
  // account. Everything else stays behind the subscription gate.
  if (skipSubscription) {
    return <>{children}</>;
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
      <Route path="/como-funciona" component={ComoFuncionaPage} />
      <Route path="/caracteristicas" component={CaracteristicasPage} />
      <Route path="/precios" component={PreciosPage} />
      <Route path="/nosotros" component={NosotrosPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/consultor" component={ConsultorLoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/resend-verification" component={ResendVerificationPage} />
      <Route path="/privacidad" component={PrivacidadPage} />
      <Route path="/terminos" component={TerminosPage} />
      <Route path="/portal/:token" component={PortalPage} />
      <Route path="/encuesta/:token" component={EncuestaPublicaPage} />
      <Route path="/invitacion/:token" component={InvitacionPage} />
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
        <Redirect to="/informes/ventas" replace />
      </Route>
      <Route path="/informes">
        <Redirect to="/informes/ventas" replace />
      </Route>
      <Route path="/informes/ventas">
        <AuthGate>
          <Layout>
            <Informes />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/informes/compras">
        <AuthGate>
          <Layout>
            <InformesCompras />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/informes/inventario">
        <AuthGate>
          <Layout>
            <InformesInventario />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/informes/areas">
        <AuthGate>
          <Layout>
            <InformesAreas />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/informes/clientes">
        <AuthGate>
          <Layout>
            <InformesClientes />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/informes/gestion">
        <AuthGate>
          <Layout>
            <InformesGestion />
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
      <Route path="/compras">
        <AuthGate>
          <Layout>
            <ComprasPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/compras/nueva">
        <AuthGate>
          <Layout>
            <CompraFormPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/compras/:id/editar">
        <AuthGate>
          <Layout>
            <CompraFormPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/compras/:id">
        <AuthGate>
          <Layout>
            <CompraDetailPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/proveedores">
        <AuthGate>
          <Layout>
            <ProveedoresPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/proveedores/nuevo">
        <AuthGate>
          <Layout>
            <ProveedorNuevoPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/proveedores/:id">
        <AuthGate>
          <Layout>
            <ProveedorDetailPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/inventario">
        <AuthGate>
          <Layout>
            <InventarioPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/inventario/nuevo">
        <AuthGate>
          <Layout>
            <InventarioFormPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/inventario/:id/editar">
        <AuthGate>
          <Layout>
            <InventarioFormPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/inventario/:id/movimiento">
        <AuthGate>
          <Layout>
            <InventarioMovimientoPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/locales">
        <AuthGate>
          <Layout>
            <LocalesPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/locales/nuevo">
        <AuthGate>
          <Layout>
            <LocalNuevoPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/locales/:id">
        <AuthGate>
          <Layout>
            <LocalDetailPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/bodegas/nueva">
        <AuthGate>
          <Layout>
            <BodegaNuevaPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/bodegas/:id">
        <AuthGate>
          <Layout>
            <BodegaDetailPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cotizaciones">
        <AuthGate>
          <Layout>
            <CotizacionesPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cotizaciones/nueva">
        <AuthGate>
          <Layout>
            <CotizacionFormPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cotizaciones/:id/editar">
        <AuthGate>
          <Layout>
            <CotizacionFormPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cotizaciones/:id">
        <AuthGate>
          <Layout>
            <CotizacionDetailPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/pedidos">
        <AuthGate>
          <Layout>
            <PedidosPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/pedidos/:id">
        <AuthGate>
          <Layout>
            <PedidoDetailPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/guias-despacho">
        <AuthGate>
          <Layout>
            <GuiasDespachoPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/guias-despacho/:id">
        <AuthGate>
          <Layout>
            <GuiaDetailPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/configuracion/preferencias">
        <AuthGate>
          <Layout>
            <PreferenciasPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/configuracion/empresa">
        <AuthGate>
          <Layout>
            <EmpresaPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/configuracion/usuarios">
        <AuthGate>
          <Layout>
            <ConfiguracionUsuariosPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/configuracion/areas">
        <AuthGate>
          <Layout>
            <ConfiguracionAreasPage />
          </Layout>
        </AuthGate>
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
      <Route path="/workflows" nest={false}>
        <AuthGate>
          <Layout>
            <WorkflowsPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/workflows/nuevo">
        <AuthGate>
          <Layout>
            <WorkflowDetail />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/workflows/:id">
        {(params) => (
          <AuthGate>
            <Layout>
              <WorkflowDetail />
            </Layout>
          </AuthGate>
        )}
      </Route>
      <Route path="/tareas">
        <AuthGate>
          <Layout>
            <TareasPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/gestion/hoy">
        <AuthGate>
          <Layout>
            <GestionHoyPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/gestion/clientes-prioritarios">
        <AuthGate>
          <Layout>
            <ClientesPrioritariosPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/gestion/tareas">
        <AuthGate>
          <Layout>
            <TareasPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/encuestas">
        <AuthGate>
          <Layout>
            <EncuestasPage />
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/webhooks/log">
        <AdminGate>
          <Layout>
            <WebhookLog />
          </Layout>
        </AdminGate>
      </Route>
      <Route path="/perfil">
        <AuthGate skipProfile skipSubscription>
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
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRouter />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
