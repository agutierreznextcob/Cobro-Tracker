import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cobrosRouter from "./cobros";
import clientesRouter from "./clientes";
import liquidacionesRouter from "./liquidaciones";
import aiRouter from "./ai";
import webhooksRouter from "./webhooks";
import { profileRouter } from "./profile";
import { subscriptionRouter } from "./subscription";
import { adminRouter } from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// webhooksRouter must come BEFORE cobrosRouter — cobrosRouter has a blanket
// auth middleware (Router.use without a path) that would otherwise intercept
// every request including public webhook paths like /webhooks/flow.
router.use(webhooksRouter);
router.use(cobrosRouter);
router.use(clientesRouter);
router.use(liquidacionesRouter);
router.use(aiRouter);
router.use(profileRouter);
router.use(subscriptionRouter);
router.use(adminRouter);

export default router;
