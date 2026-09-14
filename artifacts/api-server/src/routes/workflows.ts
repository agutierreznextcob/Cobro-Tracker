import { Router, type IRouter } from "express";
import {
  db,
  cobrosTable,
  clientesTable,
  workflowsTable,
  workflowStepsTable,
  workflowEjecucionesTable,
  type Workflow,
  type WorkflowStep,
  type WorkflowEjecucion,
  type WorkflowCondiciones,
} from "@workspace/db";
import { and, eq, inArray, sql, desc, gte, type SQL } from "drizzle-orm";
import {
  CreateWorkflowBody,
  UpdateWorkflowBody,
  UpdateWorkflowParams,
  GetWorkflowParams,
  DeleteWorkflowParams,
  CreateWorkflowFromPlantillaBody,
  GetSugerenciaWorkflowQueryParams,
} from "@workspace/api-zod";
import { getOrgContext, cobroScopeCondition, type OrgContext } from "../lib/org";
import { computeClienteScores, categoriaFromScore } from "../lib/scoring";
import {
  WORKFLOW_PLANTILLAS,
  getPlantilla,
  plantillaKeyForScore,
} from "../lib/workflow-templates";
import { listProximasAcciones } from "../lib/workflows-engine";
import { requirePlanFeature } from "../middlewares/requirePlanFeature";

const workflowsRouter: IRouter = Router();

const workflowPaths = ["/workflows", "/cobros/:id/workflow", "/cobros/:id/workflow-ejecuciones"];
workflowsRouter.use(workflowPaths, (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});
// Workflows inteligentes: solo plan NextCob (trial/demo/admin incluidos).
workflowsRouter.use(workflowPaths, requirePlanFeature("workflows"));

// Scope: admin_org sees all workflows in their org; ejecutivo sees only their own.
function workflowScope(ctx: OrgContext, userId: string): SQL | undefined {
  if (ctx.isOrgAdmin && ctx.organizationId != null) {
    return eq(workflowsTable.organizationId, ctx.organizationId);
  }
  return eq(workflowsTable.userId, userId);
}

function serializeWorkflow(w: Workflow, cobrosUsando?: number) {
  return {
    id: w.id,
    organizationId: w.organizationId,
    userId: w.userId,
    nombre: w.nombre,
    descripcion: w.descripcion,
    activo: w.activo,
    plantillaKey: w.plantillaKey,
    triggerTipo: w.triggerTipo,
    triggerDias: w.triggerDias,
    condiciones: w.condiciones ?? null,
    ...(cobrosUsando != null ? { cobrosUsando } : {}),
    creadoEn: w.creadoEn.toISOString(),
    actualizadoEn: w.actualizadoEn.toISOString(),
  };
}

function serializeStep(s: WorkflowStep) {
  return {
    id: s.id,
    workflowId: s.workflowId,
    orden: s.orden,
    delayDias: s.delayDias,
    accionTipo: s.accionTipo,
    config: s.config ?? null,
  };
}

function serializeEjecucion(
  e: WorkflowEjecucion,
  extra?: { clienteNombre?: string | null; descripcion?: string | null; workflowNombre?: string | null },
) {
  return {
    id: e.id,
    cobroId: e.cobroId,
    workflowId: e.workflowId,
    stepId: e.stepId,
    accionTipo: e.accionTipo,
    estado: e.estado,
    detalle: e.detalle ?? null,
    fecha: e.fecha,
    clienteNombre: extra?.clienteNombre ?? null,
    descripcion: extra?.descripcion ?? null,
    workflowNombre: extra?.workflowNombre ?? null,
    creadoEn: e.creadoEn.toISOString(),
  };
}

// Counts, per workflow id, how many cobros are currently assigned to it (scoped).
async function cobrosUsandoPorWorkflow(
  workflowIds: number[],
  cobroScope: SQL | undefined,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (workflowIds.length === 0) return map;
  const conds: SQL[] = [inArray(cobrosTable.workflowId, workflowIds)];
  if (cobroScope) conds.push(cobroScope);
  const rows = await db
    .select({
      workflowId: cobrosTable.workflowId,
      total: sql<number>`count(*)::int`,
    })
    .from(cobrosTable)
    .where(and(...conds))
    .groupBy(cobrosTable.workflowId);
  for (const r of rows) if (r.workflowId != null) map.set(r.workflowId, r.total);
  return map;
}

// ---- Templates -----------------------------------------------------------
workflowsRouter.get("/workflows/plantillas", (_req, res) => {
  res.json(
    WORKFLOW_PLANTILLAS.map((p) => ({
      key: p.key,
      nombre: p.nombre,
      descripcion: p.descripcion,
      categoria: p.key,
      triggerTipo: p.triggerTipo,
      triggerDias: p.triggerDias,
      condiciones: p.condiciones ?? null,
      steps: p.steps.map((s) => ({
        orden: s.orden,
        delayDias: s.delayDias,
        accionTipo: s.accionTipo,
        config: s.config,
      })),
    })),
  );
});

// ---- Dashboard -----------------------------------------------------------
workflowsRouter.get("/workflows/dashboard", async (req, res) => {
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const wfScope = workflowScope(ctx, userId);
    const cobroScope = cobroScopeCondition(ctx, userId);

    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(wfScope)
      .orderBy(desc(workflowsTable.creadoEn));
    const wfIds = workflows.map((w) => w.id);
    const usando = await cobrosUsandoPorWorkflow(wfIds, cobroScope);

    // Execution counts (today / last 7 days) per workflow, scoped by cobro access.
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
    const hace7 = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(
      new Date(Date.now() - 6 * 86_400_000),
    );

    const scopedCobros = await db
      .select()
      .from(cobrosTable)
      .where(
        and(
          cobroScope,
          inArray(cobrosTable.estado, ["pendiente", "parcial"]),
          sql`${cobrosTable.workflowId} is not null`,
        ),
      );
    const scopedCobroIds = scopedCobros.map((c) => c.id);

    const ejecucionesSemana =
      scopedCobroIds.length > 0
        ? await db
            .select()
            .from(workflowEjecucionesTable)
            .where(
              and(
                inArray(workflowEjecucionesTable.cobroId, scopedCobroIds),
                gte(workflowEjecucionesTable.fecha, hace7),
                eq(workflowEjecucionesTable.estado, "enviado"),
              ),
            )
        : [];

    const porWorkflowHoy = new Map<number, number>();
    const porWorkflowSemana = new Map<number, number>();
    let accionesHoy = 0;
    let accionesSemana = 0;
    for (const e of ejecucionesSemana) {
      accionesSemana++;
      porWorkflowSemana.set(e.workflowId, (porWorkflowSemana.get(e.workflowId) ?? 0) + 1);
      if (e.fecha === hoy) {
        accionesHoy++;
        porWorkflowHoy.set(e.workflowId, (porWorkflowHoy.get(e.workflowId) ?? 0) + 1);
      }
    }

    const proximas = await listProximasAcciones(scopedCobros, 20);

    // Recent history (last executions), enriched with cobro/workflow labels.
    const historialRaw =
      scopedCobroIds.length > 0
        ? await db
            .select()
            .from(workflowEjecucionesTable)
            .where(inArray(workflowEjecucionesTable.cobroId, scopedCobroIds))
            .orderBy(desc(workflowEjecucionesTable.creadoEn))
            .limit(30)
        : [];
    const cobroById = new Map(scopedCobros.map((c) => [c.id, c]));
    const wfById = new Map(workflows.map((w) => [w.id, w]));
    const historial = historialRaw.map((e) =>
      serializeEjecucion(e, {
        clienteNombre: cobroById.get(e.cobroId)?.clienteNombre ?? null,
        descripcion: cobroById.get(e.cobroId)?.descripcion ?? null,
        workflowNombre: wfById.get(e.workflowId)?.nombre ?? null,
      }),
    );

    res.json({
      workflows: workflows.map((w) => ({
        id: w.id,
        nombre: w.nombre,
        activo: w.activo,
        cobrosUsando: usando.get(w.id) ?? 0,
        accionesHoy: porWorkflowHoy.get(w.id) ?? 0,
        accionesSemana: porWorkflowSemana.get(w.id) ?? 0,
      })),
      accionesHoy,
      accionesSemana,
      proximas,
      historial,
    });
  } catch (err) {
    req.log.error({ err }, "Error building workflow dashboard");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- AI suggestion by client score --------------------------------------
workflowsRouter.get("/workflows/sugerencia", async (req, res) => {
  const parsed = GetSugerenciaWorkflowQueryParams.safeParse({ cobroId: Number(req.query.cobroId) });
  if (!parsed.success) {
    res.status(400).json({ error: "cobroId inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, parsed.data.cobroId));
    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    // Access check (404 to avoid leaking existence).
    const canAccess =
      ctx.isOrgAdmin && ctx.organizationId != null
        ? cobro.organizationId === ctx.organizationId
        : cobro.responsableId === userId;
    if (!canAccess) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    let categoria = "sin_datos";
    let score: number | null = null;
    if (cobro.clienteId != null) {
      const scope = cobroScopeCondition(ctx, userId);
      const scores = await computeClienteScores([cobro.clienteId], scope);
      const s = scores.get(cobro.clienteId);
      score = s?.score ?? null;
      categoria = s?.categoria ?? categoriaFromScore(score);
    }
    const plantillaKey = plantillaKeyForScore(categoria);
    const plantilla = getPlantilla(plantillaKey);
    const razonPorCategoria: Record<string, string> = {
      excelente: "Este cliente tiene un excelente historial de pago. Recomendamos un trato preferente y cordial.",
      bueno: "Este cliente suele pagar bien. Una secuencia estándar equilibrada es apropiada.",
      regular: "El comportamiento de pago es irregular. Conviene una cobranza más intensiva.",
      riesgoso: "Este cliente presenta riesgo de mora. Recomendamos una secuencia firme y rápida.",
      critico: "Cliente con alto riesgo de impago. Recomendamos gestión inmediata y escalamiento.",
      sin_datos: "Aún no hay historial suficiente. Sugerimos comenzar con una secuencia estándar.",
    };

    res.json({
      plantillaKey,
      categoria,
      score,
      razon: `${razonPorCategoria[categoria] ?? razonPorCategoria.sin_datos} Plantilla sugerida: "${plantilla?.nombre ?? plantillaKey}".`,
    });
  } catch (err) {
    req.log.error({ err }, "Error computing workflow suggestion");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- Create from template ------------------------------------------------
workflowsRouter.post("/workflows/from-plantilla", async (req, res) => {
  const parsed = CreateWorkflowFromPlantillaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const plantilla = getPlantilla(parsed.data.plantillaKey);
  if (!plantilla) {
    res.status(400).json({ error: "Plantilla no encontrada" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [workflow] = await db
      .insert(workflowsTable)
      .values({
        organizationId: ctx.organizationId,
        userId,
        nombre: parsed.data.nombre?.trim() || plantilla.nombre,
        descripcion: plantilla.descripcion,
        plantillaKey: plantilla.key,
        triggerTipo: plantilla.triggerTipo,
        triggerDias: plantilla.triggerDias,
        condiciones: plantilla.condiciones,
      })
      .returning();
    const steps = await db
      .insert(workflowStepsTable)
      .values(
        plantilla.steps.map((s) => ({
          workflowId: workflow!.id,
          orden: s.orden,
          delayDias: s.delayDias,
          accionTipo: s.accionTipo,
          config: s.config,
        })),
      )
      .returning();
    res.status(201).json({ ...serializeWorkflow(workflow!, 0), steps: steps.map(serializeStep) });
  } catch (err) {
    req.log.error({ err }, "Error creating workflow from template");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- List / Create -------------------------------------------------------
workflowsRouter.get("/workflows", async (req, res) => {
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(workflowScope(ctx, userId))
      .orderBy(desc(workflowsTable.creadoEn));
    const usando = await cobrosUsandoPorWorkflow(
      workflows.map((w) => w.id),
      cobroScopeCondition(ctx, userId),
    );
    res.json(workflows.map((w) => serializeWorkflow(w, usando.get(w.id) ?? 0)));
  } catch (err) {
    req.log.error({ err }, "Error listing workflows");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

workflowsRouter.post("/workflows", async (req, res) => {
  const parsed = CreateWorkflowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const b = parsed.data;
    const [workflow] = await db
      .insert(workflowsTable)
      .values({
        organizationId: ctx.organizationId,
        userId,
        nombre: b.nombre,
        descripcion: b.descripcion ?? null,
        activo: b.activo ?? true,
        triggerTipo: b.triggerTipo,
        triggerDias: b.triggerDias ?? 0,
        condiciones: (b.condiciones as WorkflowCondiciones | undefined) ?? null,
      })
      .returning();
    let steps: WorkflowStep[] = [];
    if (b.steps && b.steps.length > 0) {
      steps = await db
        .insert(workflowStepsTable)
        .values(
          b.steps.map((s, i) => ({
            workflowId: workflow!.id,
            orden: s.orden ?? i,
            delayDias: s.delayDias ?? 0,
            accionTipo: s.accionTipo,
            config: s.config ?? null,
          })),
        )
        .returning();
    }
    res.status(201).json({ ...serializeWorkflow(workflow!, 0), steps: steps.map(serializeStep) });
  } catch (err) {
    req.log.error({ err }, "Error creating workflow");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Loads a workflow if the user may access it, else null (404-safe).
async function loadOwnedWorkflow(ctx: OrgContext, userId: string, id: number): Promise<Workflow | null> {
  const [w] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, id));
  if (!w) return null;
  const allowed =
    ctx.isOrgAdmin && ctx.organizationId != null
      ? w.organizationId === ctx.organizationId
      : w.userId === userId;
  return allowed ? w : null;
}

// ---- Get / Update / Delete ----------------------------------------------
workflowsRouter.get("/workflows/:id", async (req, res) => {
  const parsed = GetWorkflowParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const workflow = await loadOwnedWorkflow(ctx, userId, parsed.data.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow no encontrado" });
      return;
    }
    const steps = await db
      .select()
      .from(workflowStepsTable)
      .where(eq(workflowStepsTable.workflowId, workflow.id));
    steps.sort((a, b) => a.orden - b.orden || a.delayDias - b.delayDias);
    const usando = await cobrosUsandoPorWorkflow([workflow.id], cobroScopeCondition(ctx, userId));
    res.json({ ...serializeWorkflow(workflow, usando.get(workflow.id) ?? 0), steps: steps.map(serializeStep) });
  } catch (err) {
    req.log.error({ err }, "Error getting workflow");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

workflowsRouter.patch("/workflows/:id", async (req, res) => {
  const paramsParsed = UpdateWorkflowParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const bodyParsed = UpdateWorkflowBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const workflow = await loadOwnedWorkflow(ctx, userId, paramsParsed.data.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow no encontrado" });
      return;
    }
    const b = bodyParsed.data;
    const updates: Partial<typeof workflowsTable.$inferInsert> = { actualizadoEn: new Date() };
    if (b.nombre !== undefined) updates.nombre = b.nombre;
    if (b.descripcion !== undefined) updates.descripcion = b.descripcion;
    if (b.activo !== undefined) updates.activo = b.activo;
    if (b.triggerTipo !== undefined) updates.triggerTipo = b.triggerTipo;
    if (b.triggerDias !== undefined) updates.triggerDias = b.triggerDias;
    if (b.condiciones !== undefined) updates.condiciones = (b.condiciones as WorkflowCondiciones | null) ?? null;

    const [updated] = await db
      .update(workflowsTable)
      .set(updates)
      .where(eq(workflowsTable.id, workflow.id))
      .returning();

    // Full replacement of steps when provided.
    if (b.steps !== undefined) {
      await db.delete(workflowStepsTable).where(eq(workflowStepsTable.workflowId, workflow.id));
      if (b.steps.length > 0) {
        await db.insert(workflowStepsTable).values(
          b.steps.map((s, i) => ({
            workflowId: workflow.id,
            orden: s.orden ?? i,
            delayDias: s.delayDias ?? 0,
            accionTipo: s.accionTipo,
            config: s.config ?? null,
          })),
        );
      }
    }

    const steps = await db
      .select()
      .from(workflowStepsTable)
      .where(eq(workflowStepsTable.workflowId, workflow.id));
    steps.sort((a, b2) => a.orden - b2.orden || a.delayDias - b2.delayDias);
    const usando = await cobrosUsandoPorWorkflow([workflow.id], cobroScopeCondition(ctx, userId));
    res.json({ ...serializeWorkflow(updated!, usando.get(workflow.id) ?? 0), steps: steps.map(serializeStep) });
  } catch (err) {
    req.log.error({ err }, "Error updating workflow");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

workflowsRouter.delete("/workflows/:id", async (req, res) => {
  const parsed = DeleteWorkflowParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const workflow = await loadOwnedWorkflow(ctx, userId, parsed.data.id);
    if (!workflow) {
      res.status(404).json({ error: "Workflow no encontrado" });
      return;
    }
    // Unassign from any cobros first so they fall back to recordatorios simples.
    await db
      .update(cobrosTable)
      .set({ workflowId: null, workflowIniciadoEn: null })
      .where(eq(cobrosTable.workflowId, workflow.id));
    // Steps cascade via FK; ejecuciones keep their history (workflowId is a plain int).
    await db.delete(workflowsTable).where(eq(workflowsTable.id, workflow.id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Error deleting workflow");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- Assign / Unassign / Executions (on a cobro) ------------------------
workflowsRouter.post("/cobros/:id/workflow", async (req, res) => {
  const cobroId = Number(req.params.id);
  if (!Number.isInteger(cobroId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const body = req.body as { workflowId?: unknown };
  const workflowId = Number(body?.workflowId);
  if (!Number.isInteger(workflowId)) {
    res.status(400).json({ error: "workflowId inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));
    const cobroOk =
      cobro &&
      (ctx.isOrgAdmin && ctx.organizationId != null
        ? cobro.organizationId === ctx.organizationId
        : cobro.responsableId === userId);
    if (!cobroOk) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    const workflow = await loadOwnedWorkflow(ctx, userId, workflowId);
    if (!workflow) {
      res.status(404).json({ error: "Workflow no encontrado" });
      return;
    }
    const [updated] = await db
      .update(cobrosTable)
      .set({ workflowId: workflow.id, workflowIniciadoEn: new Date(), actualizadoEn: new Date() })
      .where(eq(cobrosTable.id, cobroId))
      .returning();
    res.json(serializeCobroLite(updated!));
  } catch (err) {
    req.log.error({ err }, "Error assigning workflow to cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

workflowsRouter.delete("/cobros/:id/workflow", async (req, res) => {
  const cobroId = Number(req.params.id);
  if (!Number.isInteger(cobroId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));
    const cobroOk =
      cobro &&
      (ctx.isOrgAdmin && ctx.organizationId != null
        ? cobro.organizationId === ctx.organizationId
        : cobro.responsableId === userId);
    if (!cobroOk) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    const [updated] = await db
      .update(cobrosTable)
      .set({ workflowId: null, workflowIniciadoEn: null, actualizadoEn: new Date() })
      .where(eq(cobrosTable.id, cobroId))
      .returning();
    res.json(serializeCobroLite(updated!));
  } catch (err) {
    req.log.error({ err }, "Error unassigning workflow from cobro");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

workflowsRouter.get("/cobros/:id/workflow-ejecuciones", async (req, res) => {
  const cobroId = Number(req.params.id);
  if (!Number.isInteger(cobroId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));
    const cobroOk =
      cobro &&
      (ctx.isOrgAdmin && ctx.organizationId != null
        ? cobro.organizationId === ctx.organizationId
        : cobro.responsableId === userId);
    if (!cobroOk) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }
    const rows = await db
      .select()
      .from(workflowEjecucionesTable)
      .where(eq(workflowEjecucionesTable.cobroId, cobroId))
      .orderBy(desc(workflowEjecucionesTable.creadoEn));
    const wfIds = [...new Set(rows.map((r) => r.workflowId))];
    const wfs = wfIds.length
      ? await db.select().from(workflowsTable).where(inArray(workflowsTable.id, wfIds))
      : [];
    const wfName = new Map(wfs.map((w) => [w.id, w.nombre]));
    res.json(
      rows.map((e) =>
        serializeEjecucion(e, {
          clienteNombre: cobro.clienteNombre,
          descripcion: cobro.descripcion,
          workflowNombre: wfName.get(e.workflowId) ?? null,
        }),
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing cobro executions");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Minimal cobro serializer for assign/unassign responses (matches Cobro schema
// fields consumed by the client after mutation).
function serializeCobroLite(c: typeof cobrosTable.$inferSelect) {
  const montoDescuento = c.montoDescuento != null ? Number(c.montoDescuento) : null;
  return {
    id: c.id,
    descripcion: c.descripcion,
    monto: Number(c.monto),
    montoDescuento,
    montoACobrar: Number(c.monto) - Number(c.montoDescuento ?? 0),
    estado: c.estado,
    tipoDocumento: c.tipoDocumento,
    clienteId: c.clienteId,
    clienteNombre: c.clienteNombre,
    emailPagador: c.emailPagador,
    fechaVencimiento: c.fechaVencimiento,
    referencia: c.referencia,
    workflowId: c.workflowId,
    incluyeIva: c.incluyeIva,
    montoNeto: c.montoNeto != null ? Number(c.montoNeto) : null,
    montoIva: c.montoIva != null ? Number(c.montoIva) : null,
    creadoEn: c.creadoEn.toISOString(),
    actualizadoEn: c.actualizadoEn.toISOString(),
  };
}

void clientesTable;

export default workflowsRouter;
