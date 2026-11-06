import { Router } from "express";
import { db, preferenciasTable } from "@workspace/db";
import { SavePreferenciasBody } from "@workspace/api-zod";
import { getPreferenciasNegocio, preferenciasScope } from "../lib/preferencias";
import { requireSubscription } from "../middlewares/requireSubscription";
import { validGoogleReviewUrl } from "../lib/google-reviews";

const router = Router();
router.use("/configuracion/preferencias", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription);
router.get("/configuracion/preferencias", async (req, res) => {
  res.json(await getPreferenciasNegocio(req.user!.id));
});
router.put("/configuracion/preferencias", async (req, res) => {
  const parsed = SavePreferenciasBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Preferencias inválidas." }); return; }
  const { ctx, scope } = await preferenciasScope(req.user!.id);
  if (ctx.organizationId != null && !ctx.isOrgAdmin) { res.status(403).json({ error: "Solo el administrador puede cambiar las preferencias del negocio." }); return; }
  const values = parsed.data;
  if (values.googleReviewUrl !== undefined) values.googleReviewUrl = values.googleReviewUrl.trim();
  if (values.googleReviewUrl && !validGoogleReviewUrl(values.googleReviewUrl)) {
    res.status(400).json({ error: "Usa un enlace directo de Google con formato https://g.page/r/XXXXXXXX/review." }); return;
  }
  const current = await getPreferenciasNegocio(req.user!.id);
  if ((values.googleReviewEnabled ?? current.googleReviewEnabled) && !(values.googleReviewUrl ?? current.googleReviewUrl)) {
    res.status(400).json({ error: "Agrega un enlace de Google antes de activar la invitación." }); return;
  }
  if (![values.prefijoCobro, values.prefijoCotizacion].every(s => /^[A-Za-z0-9_-]{1,16}$/.test(s))) {
    res.status(400).json({ error: "Los prefijos solo pueden contener letras, números, guiones y guiones bajos." }); return;
  }
  const data = { ...values, porcentajeIva: String(values.porcentajeIva) };
  await db.insert(preferenciasTable).values({ scope, ...data }).onConflictDoUpdate({ target: preferenciasTable.scope, set: data });
  res.json(await getPreferenciasNegocio(req.user!.id));
});
export default router;
