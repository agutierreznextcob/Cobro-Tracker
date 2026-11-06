import { Router, type IRouter } from "express";
import { db, encuestasTable, cobrosTable, type Encuesta } from "@workspace/db";
import { and, eq, isNull, isNotNull, desc, sql, type SQL } from "drizzle-orm";
import { ResponderEncuestaBody, AgregarComentarioEncuestaBody } from "@workspace/api-zod";
import { getOrgContext, type OrgContext } from "../lib/org";
import { userTieneFeature } from "../middlewares/requirePlanFeature";
import { googleReviewForSurvey } from "../lib/google-reviews";
import { hoySantiago } from "../lib/preferencias";

const encuestasRouter: IRouter = Router();

function encuestaScope(ctx: OrgContext, userId: string): SQL | undefined {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return eq(encuestasTable.organizationId, ctx.organizationId);
  }
  return eq(encuestasTable.userId, userId);
}

// ---- Authed: satisfaction summary ---------------------------------------
// Mounted before cobrosRouter's blanket auth, so this route guards itself.
encuestasRouter.get("/encuestas/stats/resumen", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  const userId = req.user!.id;
  try {
    // Informes avanzados: solo plan NextCob (trial/demo/admin incluidos).
    if (!(await userTieneFeature(userId, "informes_avanzados"))) {
      res.status(403).json({
        error: "Esta función está disponible en el plan NextCob. Mejora tu plan para usarla.",
        code: "plan_upgrade",
        feature: "informes_avanzados",
      });
      return;
    }
    const ctx = await getOrgContext(userId);
    const scope = encuestaScope(ctx, userId);
    const records = await db
      .select({ encuesta: encuestasTable, email: cobrosTable.emailPagador })
      .from(encuestasTable)
      .leftJoin(cobrosTable, eq(cobrosTable.id, encuestasTable.cobroId))
      .where(scope)
      .orderBy(desc(encuestasTable.respondidoEn));
    const rows = records.map(r => r.encuesta);
    const month = hoySantiago().slice(0, 7);
    const monthOf = (date: Date) => new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Santiago", year: "numeric", month: "2-digit",
    }).format(date).slice(0, 7);
    const googleRedirigidosMes = new Set(records.filter(r =>
      r.encuesta.googleClickedAt && monthOf(r.encuesta.googleClickedAt) === month,
    ).map(({ encuesta: e, email }) => e.clienteId != null ? `cliente:${e.clienteId}`
      : email?.trim() ? `email:${email.trim().toLowerCase()}` : `encuesta:${e.id}`)).size;

    const respondidasRows = rows.filter((r) => r.calificacion != null);
    // "Enviadas" = emails que realmente salieron (o ya respondidas); las
    // encuestas programadas aún no enviadas no cuentan.
    const total = rows.filter((r) => r.emailEnviadoEn != null || r.respondidoEn != null).length;
    const respondidas = respondidasRows.length;
    const promedio =
      respondidas > 0
        ? respondidasRows.reduce((acc, r) => acc + (r.calificacion ?? 0), 0) / respondidas
        : 0;
    const distribucion = [1, 2, 3, 4, 5].map((calificacion) => ({
      calificacion,
      cantidad: respondidasRows.filter((r) => r.calificacion === calificacion).length,
    }));
    const recientes = respondidasRows.slice(0, 10).map((r) => ({
      clienteNombre: r.clienteNombre ?? null,
      calificacion: r.calificacion!,
      comentario: r.comentario ?? null,
      respondidoEn: r.respondidoEn ? r.respondidoEn.toISOString() : null,
      googleRedirigido: r.googleClickedAt != null,
    }));

    res.json({
      total,
      respondidas,
      promedio: Math.round(promedio * 100) / 100,
      distribucion,
      recientes,
      googleRedirigidosMes,
    });
  } catch (err) {
    req.log.error({ err }, "Error building encuestas summary");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- Public: survey by token (unauthenticated) --------------------------
async function serializePublica(e: Encuesta, empresa: string, descripcion: string, monto: number) {
  return {
    empresa,
    descripcion,
    monto,
    calificacion: e.calificacion ?? null,
    comentario: e.comentario ?? null,
    respondidoEn: e.respondidoEn ? e.respondidoEn.toISOString() : null,
    yaRespondida: e.calificacion != null,
    googleReviewUrl: await googleReviewForSurvey(e),
    googleRedirigido: e.googleClickedAt != null,
  };
}

async function loadEncuestaConCobro(token: string) {
  const [encuesta] = await db.select().from(encuestasTable).where(eq(encuestasTable.token, token));
  if (!encuesta) return null;
  const [cobro] = await db
    .select({
      descripcion: cobrosTable.descripcion,
      monto: cobrosTable.monto,
      clienteNombre: cobrosTable.clienteNombre,
    })
    .from(cobrosTable)
    .where(eq(cobrosTable.id, encuesta.cobroId));
  return { encuesta, cobro };
}

encuestasRouter.get("/encuestas/:token", async (req, res) => {
  try {
    const loaded = await loadEncuestaConCobro(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Encuesta no encontrada" });
      return;
    }
    const { encuesta, cobro } = loaded;
    res.json(
      await serializePublica(
        encuesta,
        cobro?.clienteNombre ?? "",
        cobro?.descripcion ?? "",
        cobro ? Number(cobro.monto) : 0,
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Error loading public encuesta");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// One-click answer entry point from the email buttons. Deliberately does NOT
// mutate on GET: email scanners/prefetchers follow links automatically, which
// would register phantom answers. Instead it redirects to the public survey
// page with the chosen rating; the page records it via POST when it renders in
// a real browser — still a single click for the user, no extra form.
encuestasRouter.get("/encuestas/:token/responder", async (req, res) => {
  const calificacion = Number(req.query.calificacion);
  if (![1, 2, 3, 4, 5].includes(calificacion)) {
    res.status(400).json({ error: "Calificación inválida" });
    return;
  }
  res.redirect(`/encuesta/${encodeURIComponent(req.params.token)}?calificacion=${calificacion}`);
});

encuestasRouter.post("/encuestas/:token", async (req, res) => {
  const parsed = ResponderEncuestaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Calificación inválida" });
    return;
  }
  try {
    const loaded = await loadEncuestaConCobro(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Encuesta no encontrada" });
      return;
    }
    const { encuesta, cobro } = loaded;
    if (encuesta.calificacion != null) {
      // Already answered — single-response survey; return current state.
      res.json(
        await serializePublica(
          encuesta,
          cobro?.clienteNombre ?? "",
          cobro?.descripcion ?? "",
          cobro ? Number(cobro.monto) : 0,
        ),
      );
      return;
    }
    const [updated] = await db
      .update(encuestasTable)
      .set({
        calificacion: parsed.data.calificacion,
        comentario: parsed.data.comentario?.trim() || null,
        respondidoEn: new Date(),
      })
      // Atomic single-response guard: a concurrent first answer wins and this
      // update becomes a no-op instead of overwriting it.
      .where(and(eq(encuestasTable.id, encuesta.id), isNull(encuestasTable.calificacion)))
      .returning();
    res.json(
      await serializePublica(
        // A concurrent first answer may have won the race; return its state.
        updated ?? (await loadEncuestaConCobro(req.params.token))!.encuesta,
        cobro?.clienteNombre ?? "",
        cobro?.descripcion ?? "",
        cobro ? Number(cobro.monto) : 0,
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Error saving encuesta response");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Supplement an email one-click rating with one private comment. Never replace
// a saved rating/comment, including under concurrent submissions.
encuestasRouter.post("/encuestas/:token/comentario", async (req, res) => {
  const parsed = AgregarComentarioEncuestaBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.comentario.trim()) {
    res.status(400).json({ error: "Escribe un comentario de hasta 2000 caracteres." }); return;
  }
  try {
    const loaded = await loadEncuestaConCobro(req.params.token);
    if (!loaded) { res.status(404).json({ error: "Encuesta no encontrada" }); return; }
    if (loaded.encuesta.calificacion == null) {
      res.status(409).json({ error: "Responde la encuesta antes de agregar un comentario." }); return;
    }
    const [updated] = await db.update(encuestasTable)
      .set({ comentario: parsed.data.comentario.trim() })
      .where(and(eq(encuestasTable.id, loaded.encuesta.id), isNotNull(encuestasTable.calificacion),
        sql`nullif(trim(${encuestasTable.comentario}), '') is null`)).returning();
    const e = updated ?? (await loadEncuestaConCobro(req.params.token))?.encuesta;
    if (!e) { res.status(404).json({ error: "Encuesta no encontrada" }); return; }
    res.json(await serializePublica(e, loaded.cobro?.clienteNombre ?? "", loaded.cobro?.descripcion ?? "",
      Number(loaded.cobro?.monto ?? 0)));
  } catch (err) {
    req.log.error({ err }, "Error saving private survey comment");
    res.status(500).json({ error: "No se pudo guardar tu comentario. Intenta nuevamente." });
  }
});

// Explicit POST only: rendering/prefetching the invitation does not count.
encuestasRouter.post("/encuestas/:token/google", async (req, res) => {
  try {
    const loaded = await loadEncuestaConCobro(req.params.token);
    if (!loaded) { res.status(404).json({ error: "Encuesta no encontrada" }); return; }
    const url = await googleReviewForSurvey(loaded.encuesta);
    if (!url) {
      res.status(409).json({ error: "La invitación a Google no está disponible en este momento." }); return;
    }
    await db.update(encuestasTable).set({ googleClickedAt: new Date() })
      .where(and(eq(encuestasTable.id, loaded.encuesta.id), isNull(encuestasTable.googleClickedAt),
        isNotNull(encuestasTable.calificacion)));
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "Error recording Google invitation click");
    res.status(500).json({ error: "No se pudo abrir la invitación. Intenta nuevamente." });
  }
});

export default encuestasRouter;
