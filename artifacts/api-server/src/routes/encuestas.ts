import { Router, type IRouter } from "express";
import { db, encuestasTable, cobrosTable, type Encuesta } from "@workspace/db";
import { and, eq, isNull, isNotNull, desc, type SQL } from "drizzle-orm";
import { ResponderEncuestaBody } from "@workspace/api-zod";
import { getOrgContext, type OrgContext } from "../lib/org";

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
    const ctx = await getOrgContext(userId);
    const scope = encuestaScope(ctx, userId);
    const rows = await db
      .select()
      .from(encuestasTable)
      .where(scope)
      .orderBy(desc(encuestasTable.respondidoEn));

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
    }));

    res.json({
      total,
      respondidas,
      promedio: Math.round(promedio * 100) / 100,
      distribucion,
      recientes,
    });
  } catch (err) {
    req.log.error({ err }, "Error building encuestas summary");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- Public: survey by token (unauthenticated) --------------------------
function serializePublica(e: Encuesta, empresa: string, descripcion: string, monto: number) {
  return {
    empresa,
    descripcion,
    monto,
    calificacion: e.calificacion ?? null,
    comentario: e.comentario ?? null,
    respondidoEn: e.respondidoEn ? e.respondidoEn.toISOString() : null,
    yaRespondida: e.calificacion != null,
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
      serializePublica(
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
        serializePublica(
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
        comentario: parsed.data.comentario ?? null,
        respondidoEn: new Date(),
      })
      // Atomic single-response guard: a concurrent first answer wins and this
      // update becomes a no-op instead of overwriting it.
      .where(and(eq(encuestasTable.id, encuesta.id), isNull(encuestasTable.calificacion)))
      .returning();
    res.json(
      serializePublica(
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

export default encuestasRouter;
