import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cobrosRouter from "./cobros";
import webhooksRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cobrosRouter);
router.use(webhooksRouter);

export default router;
