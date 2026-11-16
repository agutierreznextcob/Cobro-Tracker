import { Router } from "express";
import { GetInformeAreaQueryParams, GetInformeAreaResponse } from "@workspace/api-zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { informeArea } from "../lib/informes";
import { kpiPorArea } from "../lib/informes-por-area";

const router = Router();
router.use("/informes", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription);
router.get("/informes", async (req, res) => {
  const parsed = GetInformeAreaQueryParams.safeParse(req.query);
  if (!parsed.success || [parsed.success ? parsed.data.proveedorId : null, parsed.success ? parsed.data.bodegaId : null, parsed.success ? parsed.data.localId : null].some(id => id != null && !Number.isSafeInteger(id))) {
    res.status(400).json({ error: "Filtros de informe inválidos." }); return;
  }
  try {
    res.json(GetInformeAreaResponse.parse(await informeArea(req.user!.id, parsed.data)));
  } catch (err) {
    req.log.error({ err }, "No se pudo generar el informe");
    res.status(500).json({ error: "No se pudo generar el informe. Intenta nuevamente." });
  }
});

/** GET /informes/area/:areaId?moneda=CLP — KPIs para un área/dpto/centro de costo específico */
router.get("/informes/area/:areaId", async (req, res) => {
  const areaId = parseInt(req.params.areaId, 10);
  if (!Number.isFinite(areaId) || areaId <= 0) {
    res.status(400).json({ error: "ID de área inválido." }); return;
  }
  const moneda = typeof req.query.moneda === "string" ? req.query.moneda : "CLP";
  try {
    res.json(await kpiPorArea(req.user!.id, areaId, moneda));
  } catch (err) {
    req.log.error({ err }, "No se pudo generar el informe de área");
    res.status(500).json({ error: "No se pudo generar el informe. Intenta nuevamente." });
  }
});

export default router;
