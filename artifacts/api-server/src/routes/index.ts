import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cobrosRouter from "./cobros";
import webhooksRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(cobrosRouter);
router.use(webhooksRouter);

export default router;
