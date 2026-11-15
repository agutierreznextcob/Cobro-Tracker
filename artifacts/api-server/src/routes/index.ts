import { Router, type IRouter } from "express";
import indicadoresRouter from "./indicadores";
import cotizacionesRouter from "./cotizaciones";
import cotizacionesSoporteRouter from "./cotizaciones-soporte";
import comprasRouter from "./compras";
import preferenciasRouter from "./preferencias";
import informesRouter from "./informes";
import empresaRouter from "./empresa";
import cobroPdfRouter from "./cobro-pdf";
import healthRouter from "./health";
import authRouter from "./auth";
import cobrosRouter from "./cobros";
import clientesRouter from "./clientes";
import liquidacionesRouter from "./liquidaciones";
import aiRouter from "./ai";
import publicChatRouter from "./public-chat";
import webhooksRouter from "./webhooks";
import recordatoriosRouter from "./recordatorios";
import gestionesRouter from "./gestiones";
import notificacionesRouter from "./notificaciones";
import leadsRouter from "./leads";
import portalRouter from "./portal";
import workflowsRouter from "./workflows";
import tareasRouter from "./tareas";
import encuestasRouter from "./encuestas";
import { profileRouter } from "./profile";
import { subscriptionRouter } from "./subscription";
import { adminRouter } from "./admin";
import { organizationRouter } from "./organization";
import consultorRouter from "./consultor";
import inventarioRouter from "./inventario";
import localesRouter from "./locales";
import pedidosRouter from "./pedidos";
import guiasDespachoRouter from "./guias-despacho";
import permisosRouter from "./permisos";
import { areasRouter } from "./areas";

// ORDEN DE MONTAJE: los routers con rutas públicas (portal, leads, chat,
// webhooks, encuestas) deben ir ANTES de cualquier router con auth "en blanco"
// (Router.use sin path). Nunca agregues un guard sin path a un router montado
// en esta cadena — delimítalo por prefijo (ver gestiones.ts como ejemplo).
// Guardias de regresión:
// - scripts/e2e-public-routes.ts (workflow e2e-public-routes): runtime, verifica
//   que las rutas públicas respondan sin sesión y sin 401/403.
// - scripts/check-auth-guards.ts (workflow check-auth-guards): estático, falla
//   sin servidor si un router agrega un use() sin path fuera de la lista blanca
//   o si un router con blanket guard se monta antes que las rutas públicas.
const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// consultorRouter tiene un POST público (/consultor/login) y el resto de sus
// rutas se auto-protegen; debe ir antes de los routers con blanket auth.
router.use(consultorRouter);
// publicChatRouter is unauthenticated (landing-page sales assistant); mount it
// before aiRouter, which gates every route behind auth + subscription.
router.use(publicChatRouter);
// webhooksRouter must come BEFORE cobrosRouter — cobrosRouter has a blanket
// auth middleware (Router.use without a path) that would otherwise intercept
// every request including public webhook paths like /webhooks/flow.
router.use(webhooksRouter);
router.use(recordatoriosRouter);
router.use(gestionesRouter);
router.use(notificacionesRouter);
// leadsRouter has a public POST (/public/leads) plus admin-gated /leads routes;
// mount before cobrosRouter, whose blanket auth middleware would otherwise
// intercept the public lead-submission path.
router.use(leadsRouter);
// portalRouter exposes the unauthenticated debtor portal (/public/portal/:token);
// mount before cobrosRouter, whose blanket auth middleware would otherwise
// intercept the public path.
router.use(portalRouter);
// encuestasRouter exposes the unauthenticated public survey (/encuestas/:token);
// mount before cobrosRouter, whose blanket auth middleware would otherwise
// intercept the public path. Its /encuestas/stats/resumen route self-guards.
router.use(encuestasRouter);
// organizationRouter exposes public/self-guarded invitation routes
// (/invitaciones/:token lookup + /invitaciones/:token/aceptar); its private
// routes are prefix-guarded under /organization, so mounting early is safe.
// Must come before cobrosRouter's blanket auth middleware.
router.use(organizationRouter);
router.use(inventarioRouter);
router.use(indicadoresRouter);
router.use(cotizacionesRouter);
router.use(cotizacionesSoporteRouter);
router.use(comprasRouter);
router.use(preferenciasRouter);
router.use(informesRouter);
router.use(empresaRouter);
router.use(cobroPdfRouter);
router.use(localesRouter);
router.use(cobrosRouter);
// workflowsRouter and tareasRouter self-guard with their own auth middleware.
router.use(workflowsRouter);
router.use(tareasRouter);
router.use(clientesRouter);
router.use(liquidacionesRouter);
router.use(aiRouter);
router.use(profileRouter);
router.use(subscriptionRouter);
router.use(adminRouter);
router.use(pedidosRouter);
router.use(guiasDespachoRouter);
router.use("/permisos", permisosRouter);
router.use(areasRouter);

export default router;
