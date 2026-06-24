import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cobrosRouter from "./cobros";
import clientesRouter from "./clientes";
import liquidacionesRouter from "./liquidaciones";
import aiRouter from "./ai";
import publicChatRouter from "./public-chat";
import webhooksRouter from "./webhooks";
import recordatoriosRouter from "./recordatorios";
import notificacionesRouter from "./notificaciones";
import leadsRouter from "./leads";
import { profileRouter } from "./profile";
import { subscriptionRouter } from "./subscription";
import { adminRouter } from "./admin";
import { organizationRouter } from "./organization";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// publicChatRouter is unauthenticated (landing-page sales assistant); mount it
// before aiRouter, which gates every route behind auth + subscription.
router.use(publicChatRouter);
// webhooksRouter must come BEFORE cobrosRouter — cobrosRouter has a blanket
// auth middleware (Router.use without a path) that would otherwise intercept
// every request including public webhook paths like /webhooks/flow.
router.use(webhooksRouter);
router.use(recordatoriosRouter);
router.use(notificacionesRouter);
// leadsRouter has a public POST (/public/leads) plus admin-gated /leads routes;
// mount before cobrosRouter, whose blanket auth middleware would otherwise
// intercept the public lead-submission path.
router.use(leadsRouter);
router.use(cobrosRouter);
router.use(clientesRouter);
router.use(liquidacionesRouter);
router.use(aiRouter);
router.use(profileRouter);
router.use(subscriptionRouter);
router.use(adminRouter);
router.use(organizationRouter);

export default router;
