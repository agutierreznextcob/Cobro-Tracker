import { Router, type Request, type Response, type NextFunction } from "express";
import {
  db,
  cobrosTable,
  clientesTable,
  gestionesCobranzaTable,
  pagosParciales,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, isNotNull } from "drizzle-orm";
import { CrearGestionBody } from "@workspace/api-zod";
import { z } from "zod";
import {
  getOrgContext,
  cobroScopeCondition,
  userCanAccessCobro,
} from "../lib/org";
import { requireSubscription } from "../middlewares/requireSubscription";
import { requirePlanFeature } from "../middlewares/requirePlanFeature";

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

    // Most recent gestión per cobro that actually scheduled a próxima gestión
    // (both fecha and tipo present, so the agenda item is contract-complete).
    const ultimaPorCobro = new Map<
      number,
      { gestionId: number; proximaGestionEn: Date; proximaGestionTipo: string }
    >();
    const gestiones = await db
      .select({
        id: gestionesCobranzaTable.id,
        cobroId: gestionesCobranzaTable.cobroId,
        proximaGestionEn: gestionesCobranzaTable.proximaGestionEn,
        proximaGestionTipo: gestionesCobranzaTable.proximaGestionTipo,
        creadoEn: gestionesCobranzaTable.creadoEn,
      })
      .from(gestionesCobranzaTable)
      .where(
        and(
          inArray(gestionesCobranzaTable.cobroId, cobroIds),
          isNotNull(gestionesCobranzaTable.proximaGestionEn),
          isNotNull(gestionesCobranzaTable.proximaGestionTipo),
        ),
      )
      .orderBy(desc(gestionesCobranzaTable.creadoEn));
    for (const g of gestiones) {
      if (
        !ultimaPorCobro.has(g.cobroId) &&
        g.proximaGestionEn &&
        g.proximaGestionTipo
      ) {
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
