import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, eq, isNotNull, isNull, or, sql, desc } from "drizzle-orm";
import { db, cotizacionesTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { envioKey, envioWindowStart, verificarEnvio } from "../lib/cotizacion-conciliacion";
import { ConciliarCotizacionBody } from "@workspace/api-zod";

const router = Router();
router.use("/admin/cotizaciones-envios", (req, res, next) => {
  // req.user is the impersonated customer, not the support operator.
  // Reject even if that customer's database role happens to be admin.
  if (req.consultor) {
    res.status(403).json({ error: "La conciliación no está disponible en sesiones de consultor." });
    return;
  }
  next();
}, requireAdmin);
router.get("/admin/cotizaciones-envios", async (_req, res) => {
  const rows = await db.select().from(cotizacionesTable)
    .where(and(isNotNull(cotizacionesTable.envioPdf), or(isNull(cotizacionesTable.enviadoEn), sql`${cotizacionesTable.envioPdf} ? 'audit'`)))
    .orderBy(desc(cotizacionesTable.updatedAt));
  res.json(rows.map(q => ({
    id: q.id, numero: q.numeroCotizacion, email: q.envioPdf!.email.email,
    key: envioKey(q.envioPdf!), preparedAt: q.envioPdf!.preparedAt,
    windowStart: envioWindowStart(q.envioPdf!), sha256: q.envioPdf!.sha256,
    audit: q.envioPdf!.audit ?? [], confirmed: !!q.enviadoEn,
  })));
});
router.post("/admin/cotizaciones-envios/:id/conciliar", async (req, res) => {
  const input = ConciliarCotizacionBody.safeParse(req.body);
  const id = Number(req.params.id);
  if (!input.success || !Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Datos de conciliación inválidos." }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      const [q] = await tx.select().from(cotizacionesTable).where(eq(cotizacionesTable.id, id)).for("update");
      if (!q?.envioPdf) throw new Error("No existe un envío conservado.");
      const a = q.envioPdf, body = input.data;
      if (q.enviadoEn || envioKey(a) !== body.key) throw new Error("El envío cambió; actualiza antes de conciliar.");
      // Only expired windows: no sender can still legitimately start this key.
      if (!Number.isFinite(Date.parse(envioWindowStart(a))) ||
          Date.now() - Date.parse(envioWindowStart(a)) <= 24 * 60 * 60_000 ||
          (q.envioEnCurso && Date.now() - q.envioEnCurso.getTime() < 60 * 60_000))
        throw new Error("Espera 24 horas desde el inicio y una hora desde el último intento antes de conciliar.");
      const at = new Date().toISOString();
      let evidence: string, providerId: string | undefined;
      let verified: Awaited<ReturnType<typeof verificarEnvio>> | undefined;
      if (body.action === "consultar" || body.action === "confirmar") {
        if (!body.providerId) throw new Error("Indica el identificador del correo en Resend.");
        verified = await verificarEnvio(a, body.providerId);
        providerId = verified.providerId;
        evidence = JSON.stringify(verified);
      } else {
        // Human verification of provider support's explicit written response.
        // This is NOT a claim that a 404/list absence proves non-acceptance.
        if (!body.providerCase || !body.providerStatement || body.noAcceptanceConfirmed !== true ||
            !body.providerStatement.includes(body.key))
          throw new Error("Se requiere el caso y la confirmación escrita de Resend para TODOS los intentos de esta clave.");
        if (a.providerId || a.audit?.some(e => e.key === body.key && (e.action === "consultar" || e.action === "confirmar")))
          throw new Error("Ya existe evidencia de aceptación; no se permite autorizar otro envío.");
        evidence = JSON.stringify({ providerCase: body.providerCase, statement: body.providerStatement, attestedBy: req.user!.id });
      }
      const audit = [...(a.audit ?? []), { at, actor: req.user!.id, action: body.action, key: body.key, reason: body.reason, evidence, providerId }];
      await tx.update(cotizacionesTable).set({
        envioPdf: { ...a, audit, ...(providerId ? { providerId } : {}),
          ...(body.action === "autorizar" ? { retry: { key: `cotizacion-${q.id}-${randomUUID()}`, authorizedAt: at } } : {}) },
        ...(body.action === "confirmar" ? { estado: "enviada" as const, enviadoEn: new Date(verified!.createdAt), envioEnCurso: null } : {}),
        updatedAt: new Date(),
      }).where(eq(cotizacionesTable.id, id));
      return { action: body.action, verified: verified ?? null };
    });
    res.json(result);
  } catch (err) {
    req.log.warn({ cotizacionId: id }, "Conciliación rechazada");
    res.status(409).json({ error: err instanceof Error ? err.message : "No se pudo conciliar." });
  }
});
export default router;
