import { Router, type Request, type Response } from "express";
import { RequestEmpresaLogoUploadBody } from "@workspace/api-zod";
import { requireSubscription } from "../middlewares/requireSubscription";
import { preferenciasScope } from "../lib/preferencias";
import { EmpresaError, getEmpresaForScope, getEmpresaLogoBytes, saveEmpresa, requestLogoUpload, validateEmpresa } from "../lib/empresa";

const router = Router();
router.use("/configuracion/empresa", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription);
const action = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await fn(req, res); } catch (err) {
    req.log.error({ err }, "Operación del perfil de empresa fallida");
    res.status(err instanceof EmpresaError ? err.status : 500).json({ error: err instanceof EmpresaError ? err.message : "No se pudo completar la operación. Intenta nuevamente." });
  }
};
async function context(req: Request, write = false) {
  const { ctx, scope } = await preferenciasScope(req.user!.id);
  if (write && ctx.organizationId != null && !ctx.isOrgAdmin) throw new EmpresaError("Solo el administrador puede editar el perfil de empresa.", 403);
  return scope;
}
router.get("/configuracion/empresa", action(async (req, res) => {
  res.json(await getEmpresaForScope(await context(req)));
}));
router.put("/configuracion/empresa", action(async (req, res) => {
  const scope = await context(req, true);
  const perfil = validateEmpresa(req.body);
  res.json(await saveEmpresa(scope, perfil));
}));
const uploadWindows = new Map<string, { start: number; count: number }>();
router.post("/configuracion/empresa/logo/upload", action(async (req, res) => {
  const scope = await context(req, true);
  const parsed = RequestEmpresaLogoUploadBody.safeParse(req.body);
  if (!parsed.success) throw new EmpresaError("Elige un logo JPG o PNG de hasta 2 MB.");
  const now = Date.now();
  for (const [key, value] of uploadWindows) if (now - value.start > 3600_000) uploadWindows.delete(key);
  const window = uploadWindows.get(scope) ?? { start: now, count: 0 };
  if (window.count >= 20) throw new EmpresaError("Has realizado muchas cargas. Intenta nuevamente más tarde.", 429);
  window.count++;
  uploadWindows.set(scope, window);
  res.json(await requestLogoUpload(scope));
}));
router.get("/configuracion/empresa/logo", action(async (req, res) => {
  const bytes = await getEmpresaLogoBytes(await getEmpresaForScope(await context(req)));
  if (!bytes) { res.sendStatus(404); return; }
  res.set("Cache-Control", "private, no-store").type("image/png").send(bytes);
}));
export default router;
