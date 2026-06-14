import { Router } from "express";
import { getFlowCredentials } from "./profile";
import { listarLiquidaciones, obtenerDetalleLiquidacion } from "../lib/flow-api";

const liquidacionesRouter = Router();

liquidacionesRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

liquidacionesRouter.get("/liquidaciones", async (req, res) => {
  const userId = req.user!.id;
  const start = Number(req.query.start) || 0;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    const creds = await getFlowCredentials(userId);
    if (!creds) {
      res.status(422).json({ error: "Credenciales Flow no configuradas. Configúralas en tu perfil." });
      return;
    }

    const result = await listarLiquidaciones(creds.apiKey, creds.secretKey, { start, limit });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error listing liquidaciones from Flow");
    const message = err instanceof Error ? err.message : "Error interno";
    res.status(502).json({ error: message });
  }
});

liquidacionesRouter.get("/liquidaciones/:id", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const creds = await getFlowCredentials(userId);
    if (!creds) {
      res.status(422).json({ error: "Credenciales Flow no configuradas. Configúralas en tu perfil." });
      return;
    }

    const detalle = await obtenerDetalleLiquidacion(creds.apiKey, creds.secretKey, id);
    res.json(detalle);
  } catch (err) {
    req.log.error({ err }, "Error getting liquidacion detail from Flow");
    const message = err instanceof Error ? err.message : "Error interno";
    res.status(502).json({ error: message });
  }
});

export default liquidacionesRouter;
