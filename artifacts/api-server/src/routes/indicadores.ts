import { Router } from "express";
import { listIndicadoresCache, sincronizarIndicadores } from "../lib/indicadores";
const router = Router();
router.use("/indicadores", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
});
router.get("/indicadores", async (_req, res) => { res.json(await listIndicadoresCache()); });
router.post("/indicadores/sincronizar", async (req, res) => {
  try { await sincronizarIndicadores(true); res.json(await listIndicadoresCache()); }
  catch (err) {
    req.log.warn({ err }, "Falló la sincronización manual de indicadores");
    res.status(503).json({ error: "No fue posible actualizar los indicadores. Se conservan los últimos valores disponibles. Intenta nuevamente en unos minutos." });
  }
});
export default router;
