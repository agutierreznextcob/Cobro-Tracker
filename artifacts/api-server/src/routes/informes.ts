import { Router } from "express";
import { GetInformeAreaQueryParams, GetInformeAreaResponse } from "@workspace/api-zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { informeArea } from "../lib/informes";

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
export default router;
