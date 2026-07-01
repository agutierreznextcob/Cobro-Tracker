import { Router, type IRouter } from "express";
import { db, encuestasTable, cobrosTable, type Encuesta } from "@workspace/db";
import { and, eq, isNotNull, desc, type SQL } from "drizzle-orm";
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
    const total = rows.length;
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
      .where(and(eq(encuestasTable.id, encuesta.id), isNotNull(encuestasTable.token)))
      .returning();
    res.json(
      serializePublica(
        updated!,
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
