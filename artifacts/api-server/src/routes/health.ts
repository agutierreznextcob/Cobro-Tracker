import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Root of the API path ("/api"). The deployment platform probes the service's
// base path ("/api") for its healthcheck; without a public handler here the
// request falls through to the auth-gated routers and returns 401, which the
// platform treats as an unhealthy (non-2xx) response and the deploy never goes
// live. Mounted before the auth routers so it always answers 200.
router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
