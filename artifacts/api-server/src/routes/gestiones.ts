import { Router, type Request, type Response, type NextFunction } from "express";
import {
  db,
  cobrosTable,
  clientesTable,
  gestionesCobranzaTable,
  pagosParciales,
  usersTable,
  tareasTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, isNotNull, isNull } from "drizzle-orm";
import { CrearGestionBody } from "@workspace/api-zod";
import { z } from "zod";
import {
  getOrgContext,
  cobroScopeCondition,
  clienteScopeCondition,
  userCanAccessCobro,
} from "../lib/org";
import { requireSubscription } from "../middlewares/requireSubscription";
import { requirePlanFeature } from "../middlewares/requirePlanFeature";
import { computeClienteScores } from "../lib/scoring";

const gestionesRouter = Router();

// Scope auth to this router's own paths. A blanket `use()` without a path
// would intercept EVERY request that reaches this router — including public
// routes mounted after it (e.g. /public/portal/:token) — because Express
// routers pass unmatched requests through their middlewares in mount order.
const requireAuthGestiones = [
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
    next();
  },
  requireSubscription,
];
gestionesRouter.use("/gestiones", requireAuthGestiones);
gestionesRouter.use("/gestion", requireAuthGestiones);
gestionesRouter.use("/cobros/:id/gestiones", requireAuthGestiones);

const CobroIdParam = z.object({ id: z.coerce.number().int().positive() });

// Results that imply the client was actually reached.
const RESULTADOS_CONTACTADO = new Set<string>([
  "contactado_pagara",
  "contactado_no_pagara",
  "acordo_pago_parcial",
  "acordo_fecha_pago",
  "disputa_reclamo",
]);

// Builds a display name from a user's first/last name, falling back to email.
function nombreDe(u: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string | null {
  return (
    [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || null
  );
}

// GET /cobros/:id/gestiones — management notes for a cobro, newest first.
gestionesRouter.get("/cobros/:id/gestiones", async (req, res) => {
  const parsed = CobroIdParam.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const userId = req.user!.id;
  const ctx = await getOrgContext(userId);

  try {
    const [cobro] = await db
      .select({
        id: cobrosTable.id,
        organizationId: cobrosTable.organizationId,
        responsableId: cobrosTable.responsableId,
      })
      .from(cobrosTable)
      .where(eq(cobrosTable.id, parsed.data.id));
    if (!cobro || !userCanAccessCobro(ctx, userId, cobro)) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    const rows = await db
      .select({
        g: gestionesCobranzaTable,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(gestionesCobranzaTable)
      .leftJoin(usersTable, eq(usersTable.id, gestionesCobranzaTable.usuarioId))
      .where(eq(gestionesCobranzaTable.cobroId, parsed.data.id))
      .orderBy(desc(gestionesCobranzaTable.creadoEn));

    res.json(
      rows.map(({ g, firstName, lastName, email }) => ({
        id: g.id,
        cobroId: g.cobroId,
        usuarioId: g.usuarioId,
        usuarioNombre: nombreDe({ firstName, lastName, email }),
        tipo: g.tipo,
        resultado: g.resultado,
        nota: g.nota,
        proximaGestionEn: g.proximaGestionEn ? g.proximaGestionEn.toISOString() : null,
        proximaGestionTipo: g.proximaGestionTipo,
        proximaGestionCompletadaEn: g.proximaGestionCompletadaEn ? g.proximaGestionCompletadaEn.toISOString() : null,
        creadoEn: g.creadoEn.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing gestiones");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// POST /cobros/:id/gestiones — register a management note for a cobro.
gestionesRouter.post("/cobros/:id/gestiones", async (req, res) => {
  const parsed = CobroIdParam.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const bodyParsed = CrearGestionBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const userId = req.user!.id;
  const ctx = await getOrgContext(userId);

  try {
    const [cobro] = await db
      .select({
        id: cobrosTable.id,
        organizationId: cobrosTable.organizationId,
        responsableId: cobrosTable.responsableId,
      })
      .from(cobrosTable)
      .where(eq(cobrosTable.id, parsed.data.id));
    if (!cobro || !userCanAccessCobro(ctx, userId, cobro)) {
      res.status(404).json({ error: "Cobro no encontrado" });
      return;
    }

    const { tipo, resultado, nota, proximaGestionEn, proximaGestionTipo } = bodyParsed.data;

    const [inserted] = await db
      .insert(gestionesCobranzaTable)
      .values({
        cobroId: parsed.data.id,
        usuarioId: userId,
        tipo,
        resultado,
        nota: nota?.trim() ? nota.trim() : null,
        proximaGestionEn: proximaGestionEn ? new Date(proximaGestionEn) : null,
        proximaGestionTipo: proximaGestionEn ? (proximaGestionTipo ?? null) : null,
      })
      .returning();

    const [u] = await db
      .select({
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    res.status(201).json({
      id: inserted.id,
      cobroId: inserted.cobroId,
      usuarioId: inserted.usuarioId,
      usuarioNombre: u ? nombreDe(u) : null,
      tipo: inserted.tipo,
      resultado: inserted.resultado,
      nota: inserted.nota,
      proximaGestionEn: inserted.proximaGestionEn
        ? inserted.proximaGestionEn.toISOString()
        : null,
      proximaGestionTipo: inserted.proximaGestionTipo,
      proximaGestionCompletadaEn: inserted.proximaGestionCompletadaEn ? inserted.proximaGestionCompletadaEn.toISOString() : null,
      creadoEn: inserted.creadoEn.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating gestión");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /gestiones/agenda — for each in-progress cobro in the user's scope, the
// planned next gestión taken from its most recent gestión (if it set one).
gestionesRouter.get("/gestiones/agenda", async (req, res) => {
  const userId = req.user!.id;
  const ctx = await getOrgContext(userId);
  const scope = cobroScopeCondition(ctx, userId);

  try {
    const cobros = await db
      .select({
        id: cobrosTable.id,
        descripcion: cobrosTable.descripcion,
        estado: cobrosTable.estado,
        monto: cobrosTable.monto,
        montoDescuento: cobrosTable.montoDescuento,
        responsableId: cobrosTable.responsableId,
        clienteNombre: clientesTable.nombre,
        respFirstName: usersTable.firstName,
        respLastName: usersTable.lastName,
        respEmail: usersTable.email,
      })
      .from(cobrosTable)
      .leftJoin(clientesTable, eq(clientesTable.id, cobrosTable.clienteId))
      .leftJoin(usersTable, eq(usersTable.id, cobrosTable.responsableId))
      .where(
        scope
          ? and(scope, inArray(cobrosTable.estado, ["pendiente", "parcial"]))
          : inArray(cobrosTable.estado, ["pendiente", "parcial"]),
      );

    if (cobros.length === 0) {
      res.json([]);
      return;
    }

    const cobroIds = cobros.map((c) => c.id);

    // Only the latest gestión decides an agenda commitment. An older commitment
    // must not reappear after a later management note changes the plan.
    const ultimaPorCobro = new Map<
      number,
      { gestionId: number; proximaGestionEn: Date; proximaGestionTipo: string }
    >();
    const gestionVista = new Set<number>();
    const gestiones = await db
      .select({
        id: gestionesCobranzaTable.id,
        cobroId: gestionesCobranzaTable.cobroId,
        proximaGestionEn: gestionesCobranzaTable.proximaGestionEn,
        proximaGestionTipo: gestionesCobranzaTable.proximaGestionTipo,
        proximaGestionCompletadaEn: gestionesCobranzaTable.proximaGestionCompletadaEn,
        creadoEn: gestionesCobranzaTable.creadoEn,
      })
      .from(gestionesCobranzaTable)
      .where(
        and(
          inArray(gestionesCobranzaTable.cobroId, cobroIds),
        ),
      )
      .orderBy(desc(gestionesCobranzaTable.creadoEn));
    for (const g of gestiones) {
      if (gestionVista.has(g.cobroId)) continue;
      gestionVista.add(g.cobroId);
      if (g.proximaGestionEn && g.proximaGestionTipo && !g.proximaGestionCompletadaEn) {
        ultimaPorCobro.set(g.cobroId, {
          gestionId: g.id,
          proximaGestionEn: g.proximaGestionEn,
          proximaGestionTipo: g.proximaGestionTipo,
        });
      }
    }

    // Confirmed abonos per cobro for saldo.
    const abonosRows = await db
      .select({
        cobroId: pagosParciales.cobroId,
        total: sql<string>`coalesce(sum(${pagosParciales.monto}), 0)`,
      })
      .from(pagosParciales)
      .where(
        and(
          inArray(pagosParciales.cobroId, cobroIds),
          eq(pagosParciales.estado, "confirmado"),
        ),
      )
      .groupBy(pagosParciales.cobroId);
    const abonadoMap = new Map<number, number>();
    for (const a of abonosRows) abonadoMap.set(a.cobroId, Number(a.total));

    const now = Date.now();
    const items = cobros
      .map((c) => {
        const ultima = ultimaPorCobro.get(c.id);
        if (!ultima || !ultima.proximaGestionEn) return null;
        const aCobrar = Number(c.monto) - Number(c.montoDescuento ?? 0);
        const saldo = Math.max(aCobrar - (abonadoMap.get(c.id) ?? 0), 0);
        return {
          gestionId: ultima.gestionId,
          cobroId: c.id,
          cobroDescripcion: c.descripcion,
          clienteNombre: c.clienteNombre,
          saldo,
          estado: c.estado,
          responsableId: c.responsableId,
          responsableNombre: nombreDe({
            firstName: c.respFirstName,
            lastName: c.respLastName,
            email: c.respEmail,
          }),
          proximaGestionEn: ultima.proximaGestionEn.toISOString(),
          proximaGestionTipo: ultima.proximaGestionTipo,
          vencida: ultima.proximaGestionEn.getTime() < now,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.proximaGestionEn.localeCompare(b.proximaGestionEn));

    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Error building gestiones agenda");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Completing is deliberately conditional: concurrent clicks cannot overwrite
// each other and a commitment from an inaccessible cobro is indistinguishable
// from a missing one.
gestionesRouter.post("/gestiones/agenda/:gestionId/completar", async (req, res) => {
  const gestionId = Number(req.params.gestionId);
  if (!Number.isInteger(gestionId) || gestionId <= 0) return void res.status(400).json({ error: "ID inválido" });
  const userId = req.user!.id;
  try {
    const ctx = await getOrgContext(userId);
    const [row] = await db.select({
      gestion: gestionesCobranzaTable,
      organizationId: cobrosTable.organizationId,
      responsableId: cobrosTable.responsableId,
    }).from(gestionesCobranzaTable).innerJoin(cobrosTable, eq(cobrosTable.id, gestionesCobranzaTable.cobroId))
      .where(eq(gestionesCobranzaTable.id, gestionId));
    if (!row || !userCanAccessCobro(ctx, userId, row)) return void res.status(404).json({ error: "Gestión no encontrada" });
    const [latest] = await db.select({ id: gestionesCobranzaTable.id })
      .from(gestionesCobranzaTable).where(eq(gestionesCobranzaTable.cobroId, row.gestion.cobroId))
      .orderBy(desc(gestionesCobranzaTable.creadoEn));
    if (!latest || latest.id !== gestionId || !row.gestion.proximaGestionEn || !row.gestion.proximaGestionTipo) {
      return void res.status(404).json({ error: "Gestión no encontrada" });
    }
    const [updated] = await db.update(gestionesCobranzaTable)
      .set({ proximaGestionCompletadaEn: new Date() })
      .where(and(eq(gestionesCobranzaTable.id, gestionId), isNull(gestionesCobranzaTable.proximaGestionCompletadaEn)))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Gestión no encontrada" });
    res.json({
      ...updated,
      proximaGestionEn: updated.proximaGestionEn?.toISOString() ?? null,
      proximaGestionCompletadaEn: updated.proximaGestionCompletadaEn?.toISOString() ?? null,
      creadoEn: updated.creadoEn.toISOString(),
    });
  } catch (err) { req.log.error({ err }, "Error completing agenda gestión"); res.status(500).json({ error: "Error interno del servidor" }); }
});

function chileDay(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function prioridadClientes(ctx: Awaited<ReturnType<typeof getOrgContext>>, userId: string) {
  const clientes = await db.select({ id: clientesTable.id, nombre: clientesTable.nombre }).from(clientesTable).where(
    clienteScopeCondition(ctx, userId),
  );
  const scope = cobroScopeCondition(ctx, userId);
  const [scores, abiertos] = await Promise.all([
    computeClienteScores(clientes.map((c) => c.id), scope),
    db.select({ id: cobrosTable.id, clienteId: cobrosTable.clienteId, fechaVencimiento: cobrosTable.fechaVencimiento })
      .from(cobrosTable).where(and(scope, inArray(cobrosTable.estado, ["pendiente", "parcial"]))),
  ]);
  const today = chileDay(new Date());
  const moraPorCliente = new Map<number, { diasMora: number; cobroId: number | null }>();
  for (const cobro of abiertos) {
    if (cobro.clienteId == null) continue;
    const diasMora = cobro.fechaVencimiento
      ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${cobro.fechaVencimiento}T12:00:00Z`)) / 86_400_000))
      : 0;
    const prior = moraPorCliente.get(cobro.clienteId);
    if (!prior || diasMora > prior.diasMora) moraPorCliente.set(cobro.clienteId, { diasMora, cobroId: cobro.id });
  }
  return clientes.map((cliente) => {
    const s = scores.get(cliente.id);
    const riesgo = s?.score == null ? (s?.cobrosVencidos ? 70 : 50) : 100 - s.score;
    const totalPendiente = s?.totalPendiente ?? 0;
    const mora = moraPorCliente.get(cliente.id) ?? { diasMora: 0, cobroId: null };
    return { clienteId: cliente.id, clienteNombre: cliente.nombre, totalPendiente, riesgo,
      prioridad: Math.round(totalPendiente * (riesgo / 100)), score: s?.score ?? null, categoria: s?.categoria ?? "sin_datos",
      diasMora: mora.diasMora, cobroId: mora.cobroId, probabilidadPago: s?.probabilidadPago ?? null,
      cobrosVencidos: s?.cobrosVencidos ?? 0,
      recomendacion: s?.recomendacion ? `${s.recomendacion.titulo}: ${s.recomendacion.detalle}` : null };
  }).filter((x) => x.totalPendiente > 0).sort((a, b) =>
    (a.score == null ? 1 : b.score == null ? -1 : a.score - b.score) || b.prioridad - a.prioridad);
}

gestionesRouter.get("/gestion/clientes-prioritarios", async (req, res) => {
  try {
    const userId = req.user!.id;
    res.json(await prioridadClientes(await getOrgContext(userId), userId));
  } catch (err) { req.log.error({ err }, "Error building priority clients"); res.status(500).json({ error: "Error interno del servidor" }); }
});

async function pendientesOperativos(ctx: Awaited<ReturnType<typeof getOrgContext>>, userId: string) {
  const scope = cobroScopeCondition(ctx, userId);
  const cobros = await db.select({ id: cobrosTable.id }).from(cobrosTable).where(and(scope, inArray(cobrosTable.estado, ["pendiente", "parcial"])));
  const cobroIds = cobros.map((c) => c.id);
  const gestiones = cobroIds.length ? await db.select().from(gestionesCobranzaTable)
    .where(inArray(gestionesCobranzaTable.cobroId, cobroIds)).orderBy(desc(gestionesCobranzaTable.creadoEn)) : [];
  const seen = new Set<number>();
  const agenda = gestiones.filter((g) => {
    if (seen.has(g.cobroId)) return false;
    seen.add(g.cobroId);
    return !!g.proximaGestionEn && !!g.proximaGestionTipo && !g.proximaGestionCompletadaEn;
  });
  const taskScope = ctx.isOrgAdmin && ctx.organizationId != null ? eq(tareasTable.organizationId, ctx.organizationId)
    : ctx.isSupervisor ? inArray(tareasTable.userId, ctx.teamMemberIds.length ? ctx.teamMemberIds : [userId])
    : eq(tareasTable.userId, userId);
  const tareas = await db.select().from(tareasTable).where(and(taskScope, eq(tareasTable.estado, "pendiente")));
  return { agenda, tareas };
}

async function sugerenciasOperativas(ctx: Awaited<ReturnType<typeof getOrgContext>>, userId: string) {
  return (await prioridadClientes(ctx, userId)).sort((a, b) => b.prioridad - a.prioridad).slice(0, 5).map((x) => ({
    clienteId: x.clienteId, clienteNombre: x.clienteNombre, cobroId: x.cobroId,
    prioridad: x.prioridad, totalPendiente: x.totalPendiente, diasMora: x.diasMora,
    probabilidadPago: x.probabilidadPago,
    texto: x.recomendacion ?? `Contactar al cliente por un saldo pendiente de ${x.totalPendiente}.`,
  }));
}

gestionesRouter.get("/gestion/resumen", async (req, res) => {
  try {
    const userId = req.user!.id, ctx = await getOrgContext(userId), today = chileDay(new Date());
    const { agenda } = await pendientesOperativos(ctx, userId);
    // The Tareas submenu badge is intentionally personal even when a supervisor
    // or admin can browse a wider scope in the page itself.
    const tareasPendientes = await db.$count(
      tareasTable,
      and(eq(tareasTable.userId, userId), eq(tareasTable.estado, "pendiente")),
    );
    const compromisosPendientes = agenda.filter((g) => chileDay(g.proximaGestionEn!) <= today).length;
    const sugerencias = (await sugerenciasOperativas(ctx, userId)).length;
    res.json({
      tareasPendientes,
      compromisosPendientes,
      sugerencias,
      total: tareasPendientes + compromisosPendientes,
    });
  } catch (err) { req.log.error({ err }, "Error building gestión resumen"); res.status(500).json({ error: "Error interno del servidor" }); }
});

gestionesRouter.get("/gestion/hoy", async (req, res) => {
  try {
    const userId = req.user!.id, ctx = await getOrgContext(userId), today = chileDay(new Date());
    const { agenda, tareas } = await pendientesOperativos(ctx, userId);
    const dueTaskRows = tareas.filter((t) => t.venceEn && chileDay(t.venceEn) <= today)
      .sort((a, b) => a.venceEn!.getTime() - b.venceEn!.getTime() || b.creadoEn.getTime() - a.creadoEn.getTime());
    const dueAgendaRows = agenda.filter((g) => chileDay(g.proximaGestionEn!) <= today)
      .sort((a, b) => a.proximaGestionEn!.getTime() - b.proximaGestionEn!.getTime());
    const linkedCobroIds = [...new Set([
      ...dueTaskRows.flatMap((t) => t.cobroId == null ? [] : [t.cobroId]),
      ...dueAgendaRows.map((g) => g.cobroId),
    ])];
    const responsibleIds = [...new Set(dueTaskRows.map((t) => t.userId))];
    const [linkedCobros, responsibleUsers, abonosRows] = await Promise.all([
      linkedCobroIds.length
        ? db.select({
            id: cobrosTable.id,
            clienteNombre: clientesTable.nombre,
            descripcion: cobrosTable.descripcion,
            estado: cobrosTable.estado,
            monto: cobrosTable.monto,
            montoDescuento: cobrosTable.montoDescuento,
            responsableId: cobrosTable.responsableId,
            respFirstName: usersTable.firstName,
            respLastName: usersTable.lastName,
            respEmail: usersTable.email,
          })
          .from(cobrosTable)
          .leftJoin(clientesTable, eq(clientesTable.id, cobrosTable.clienteId))
          .leftJoin(usersTable, eq(usersTable.id, cobrosTable.responsableId))
          .where(inArray(cobrosTable.id, linkedCobroIds))
        : [],
      responsibleIds.length
        ? db.select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
          }).from(usersTable).where(inArray(usersTable.id, responsibleIds))
        : [],
      linkedCobroIds.length
        ? db.select({
            cobroId: pagosParciales.cobroId,
            total: sql<string>`coalesce(sum(${pagosParciales.monto}), 0)`,
          })
          .from(pagosParciales)
          .where(and(inArray(pagosParciales.cobroId, linkedCobroIds), eq(pagosParciales.estado, "confirmado")))
          .groupBy(pagosParciales.cobroId)
        : [],
    ]);
    const cobroMap = new Map(linkedCobros.map((c) => [c.id, c]));
    const responsableMap = new Map(responsibleUsers.map((u) => [u.id, nombreDe(u)]));
    const abonadoMap = new Map(abonosRows.map((a) => [a.cobroId, Number(a.total)]));
    const dueTasks = dueTaskRows.map((t) => ({
      ...t,
      creadoEn: t.creadoEn.toISOString(),
      completadoEn: t.completadoEn?.toISOString() ?? null,
      venceEn: t.venceEn?.toISOString() ?? null,
      canceladoEn: t.canceladoEn?.toISOString() ?? null,
      clienteNombre: t.cobroId == null ? null : cobroMap.get(t.cobroId)?.clienteNombre ?? null,
      responsableNombre: responsableMap.get(t.userId) ?? null,
    }));
    const dueAgenda = dueAgendaRows.map((g) => {
      const cobro = cobroMap.get(g.cobroId);
      const total = cobro ? Number(cobro.monto) - Number(cobro.montoDescuento ?? 0) : 0;
      return {
        gestionId: g.id,
        cobroId: g.cobroId,
        cobroDescripcion: cobro?.descripcion ?? null,
        clienteNombre: cobro?.clienteNombre ?? null,
        saldo: Math.max(total - (abonadoMap.get(g.cobroId) ?? 0), 0),
        estado: cobro?.estado ?? "pendiente",
        responsableId: cobro?.responsableId ?? null,
        responsableNombre: cobro
          ? nombreDe({ firstName: cobro.respFirstName, lastName: cobro.respLastName, email: cobro.respEmail })
          : null,
        proximaGestionEn: g.proximaGestionEn!.toISOString(),
        proximaGestionTipo: g.proximaGestionTipo!,
        vencida: chileDay(g.proximaGestionEn!) < today,
      };
    });
    const sugerencias = await sugerenciasOperativas(ctx, userId);
    const recuperacionPotencialSemanal = sugerencias.reduce((total, s) => total + s.totalPendiente, 0);
    res.json({ tareas: dueTasks, agenda: dueAgenda, sugerencias, recuperacionPotencialSemanal, clientesSugeridos: sugerencias.length });
  } catch (err) { req.log.error({ err }, "Error building gestión hoy"); res.status(500).json({ error: "Error interno del servidor" }); }
});

// GET /gestiones/metricas — per-ejecutivo management metrics within the user's scope.
gestionesRouter.get("/gestiones/metricas", requirePlanFeature("informes_avanzados"), async (req, res) => {
  const userId = req.user!.id;
  const ctx = await getOrgContext(userId);
  const scope = cobroScopeCondition(ctx, userId);

  try {
    const rows = await db
      .select({
        usuarioId: gestionesCobranzaTable.usuarioId,
        resultado: gestionesCobranzaTable.resultado,
        cobroId: gestionesCobranzaTable.cobroId,
        estado: cobrosTable.estado,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(gestionesCobranzaTable)
      .innerJoin(cobrosTable, eq(cobrosTable.id, gestionesCobranzaTable.cobroId))
      .leftJoin(usersTable, eq(usersTable.id, gestionesCobranzaTable.usuarioId))
      .where(scope);

    interface Acc {
      usuarioId: string;
      usuarioNombre: string | null;
      gestionesRealizadas: number;
      contactados: number;
      cobrosGestionados: Set<number>;
      cobrosRecuperados: Set<number>;
    }
    const byUser = new Map<string, Acc>();
    for (const r of rows) {
      let acc = byUser.get(r.usuarioId);
      if (!acc) {
        acc = {
          usuarioId: r.usuarioId,
          usuarioNombre: nombreDe({
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
          }),
          gestionesRealizadas: 0,
          contactados: 0,
          cobrosGestionados: new Set(),
          cobrosRecuperados: new Set(),
        };
        byUser.set(r.usuarioId, acc);
      }
      acc.gestionesRealizadas += 1;
      if (RESULTADOS_CONTACTADO.has(r.resultado)) acc.contactados += 1;
      acc.cobrosGestionados.add(r.cobroId);
      if (r.estado === "pagado") acc.cobrosRecuperados.add(r.cobroId);
    }

    const metricas = Array.from(byUser.values())
      .map((a) => {
        const intentos = a.gestionesRealizadas;
        const cobrosGestionados = a.cobrosGestionados.size;
        const cobrosRecuperados = a.cobrosRecuperados.size;
        return {
          usuarioId: a.usuarioId,
          usuarioNombre: a.usuarioNombre,
          gestionesRealizadas: a.gestionesRealizadas,
          intentos,
          contactados: a.contactados,
          tasaContactoEfectivo: intentos > 0 ? a.contactados / intentos : 0,
          cobrosGestionados,
          cobrosRecuperados,
          tasaRecuperacion: cobrosGestionados > 0 ? cobrosRecuperados / cobrosGestionados : 0,
        };
      })
      .sort((a, b) => b.gestionesRealizadas - a.gestionesRealizadas);

    res.json(metricas);
  } catch (err) {
    req.log.error({ err }, "Error building gestiones metricas");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default gestionesRouter;
