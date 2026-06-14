import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cobrosRouter from "./cobros";
import clientesRouter from "./clientes";
import liquidacionesRouter from "./liquidaciones";
import webhooksRouter from "./webhooks";
import { profileRouter } from "./profile";

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
router.use(profileRouter);

export default router;
