import { Router } from "express";
import { db, usersTable, proWaitlistTable, organizacionesTable, invitacionesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { PLANES, cupoDePacks, normalizarPacks, planEfectivo } from "../lib/plans";
import { z } from "zod";
import { getPublicBaseUrl } from "../lib/flow-api";
import {
  getFlowAdminCreds,
  getRegisterStatus,
  createSubscription,
  mapSubscription,
} from "../lib/flow-subscriptions";
import { getSubscriptionState, contarUsuariosAdicionales } from "../lib/subscription";
import { PLAN_NETO, PLAN_IVA } from "../lib/flow-subscriptions";
import {
  COSTO_USUARIO_ADICIONAL_NETO,
  COSTO_USUARIO_ADICIONAL_IVA,
  computePricing,
} from "../lib/org";
import {
  reveniuConfigured,
  createReveniuCheckout,
  disableReveniuRenewal,
  reveniuPaymentMethodUrl,
  setReveniuAmount,
} from "../lib/reveniu";

const subscriptionRouter = Router();

// Where to send the user (frontend) once registration finishes.
function profileUrl(result: "exito" | "error"): string {
  return `${getPublicBaseUrl()}/perfil?suscripcion=${result}`;
}

// ── Flow card-registration return (PUBLIC: browser redirect from Flow) ────────
// Defined BEFORE the auth gate. We identify the user by the register token we
// stored when starting the flow, so this works even if the session cookie is
// not present on the redirect.
subscriptionRouter.get("/subscription/register-return", async (req, res) => {
  const token = (req.query?.token as string | undefined)?.trim();
  if (!token) {
    res.redirect(profileUrl("error"));
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.flowRegisterToken, token));

    if (!user || !user.flowCustomerId) {
      req.log.warn({ token }, "Subscription register-return: no user for token");
      res.redirect(profileUrl("error"));
      return;
    }

    const creds = getFlowAdminCreds();
    const status = await getRegisterStatus(creds, token);

    if (status.status !== 1) {
      req.log.warn({ userId: user.id, status: status.status }, "Card registration not completed");
      await db
        .update(usersTable)
        .set({ flowRegisterToken: null })
        .where(eq(usersTable.id, user.id));
      res.redirect(profileUrl("error"));
      return;
    }

    // Card registered — create the recurring subscription.
    const sub = await createSubscription(creds, { customerId: user.flowCustomerId });
    const mapped = mapSubscription(sub);

    await db
      .update(usersTable)
      .set({
        flowSubscriptionId: sub.subscriptionId,
        subscriptionStatus: mapped.status === "activa" ? "activa" : "vencida",
        subscriptionPeriodEnd: mapped.periodEnd,
        flowRegisterToken: null,
      })
      .where(eq(usersTable.id, user.id));

    req.log.info({ userId: user.id, subscriptionId: sub.subscriptionId }, "Subscription created");
    res.redirect(profileUrl(mapped.status === "activa" ? "exito" : "error"));
  } catch (err) {
    req.log.error({ err }, "Error finalizing subscription");
    res.redirect(profileUrl("error"));
  }
});

// ── Authenticated subscription routes ─────────────────────────────────────────
subscriptionRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

// La suscripción la administra el DUEÑO de la organización (quien paga). Un
// miembro invitado no debe crear ni cambiar su propia suscripción Reveniu.
async function esOwnerDeSuOrg(userId: string, organizationId: number | null): Promise<boolean> {
  if (organizationId == null) return true;
  const [org] = await db
    .select({ ownerId: organizacionesTable.ownerId })
    .from(organizacionesTable)
    .where(eq(organizacionesTable.id, organizationId));
  return !org || org.ownerId === userId;
}

subscriptionRouter.get("/subscription/status", async (req, res) => {
  const userId = req.user!.id;
  try {
    const state = await getSubscriptionState(userId);
    if (!state) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    // Invitaciones pendientes no expiradas: reservan cupo al invitar, así el
    // frontend calcula asientos realmente libres (mensajes y gating de packs).
    const [me] = await db
      .select({ organizationId: usersTable.organizationId })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    let invitacionesPendientes = 0;
    let esOwner = true; // sin org, el usuario es dueño de su propia suscripción
    if (me?.organizationId != null) {
      const [org] = await db
        .select({ ownerId: organizacionesTable.ownerId })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, me.organizationId));
      esOwner = !org || org.ownerId === userId;
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invitacionesTable)
        .where(
          and(
            eq(invitacionesTable.organizationId, me.organizationId),
            eq(invitacionesTable.estado, "pendiente"),
            sql`(${invitacionesTable.expiraEn} is null or ${invitacionesTable.expiraEn} > now())`,
          ),
        );
      invitacionesPendientes = row?.count ?? 0;
    }
    res.json({ ...state, invitacionesPendientes, esOwner });
  } catch (err) {
    req.log.error({ err }, "Error getting subscription status");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Inicia el checkout de suscripción en Reveniu. Devuelve la completion_url y el
// security_token: el frontend hace un POST de formulario a completion_url con
// el input oculto TBK_TOKEN=<security_token> (Transbank OneClick) para que el
// cliente registre su tarjeta una sola vez.
subscriptionRouter.post("/subscription/subscribe", async (req, res) => {
  const userId = req.user!.id;

  if (!reveniuConfigured()) {
    res.status(503).json({
      error: "La suscripción no está disponible en este momento. Intenta más tarde.",
    });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if (!(await esOwnerDeSuOrg(userId, user.organizationId))) {
      res.status(403).json({
        error: "Solo el dueño de la organización puede administrar la suscripción.",
      });
      return;
    }
    if (user.subscriptionStatus === "activa" && user.reveniuSubscriptionId) {
      res.status(400).json({ error: "Ya tienes una suscripción activa." });
      return;
    }
    if (!user.email) {
      res.status(400).json({ error: "Tu cuenta no tiene un email configurado." });
      return;
    }

    // Plan elegido en la pantalla de selección (default: NextCob).
    const parsedPlan = z.enum(["starter", "nextcob"]).safeParse(req.body?.plan ?? "nextcob");
    if (!parsedPlan.success) {
      res.status(400).json({ error: "Plan inválido." });
      return;
    }
    const plan = parsedPlan.data;

    const miembrosActivos = (await contarUsuariosAdicionales(user.organizationId)) + 1;
    if (plan === "starter" && miembrosActivos > PLANES.starter.usuariosIncluidos) {
      res.status(400).json({
        error:
          "El plan Starter incluye 1 usuario y tu equipo tiene más miembros activos. Desactiva a los demás miembros o elige el plan NextCob.",
      });
      return;
    }

    // Starter no admite packs de usuarios: se descartan al contratar Starter.
    const packs = plan === "starter" ? {} : normalizarPacks(user.packsUsuarios);
    const pricing = computePricing(plan, packs);

    const nombre =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.email;

    const checkout = await createReveniuCheckout({
      userId,
      email: user.email,
      nombre,
      rut: user.rut,
      amount: pricing.totalMensual,
    });

    await db
      .update(usersTable)
      .set({
        plan,
        packsUsuarios: packs,
        reveniuPendingSubscriptionId: checkout.subscriptionId,
        reveniuMontoSync: pricing.totalMensual,
      })
      .where(eq(usersTable.id, userId));

    res.json({
      completionUrl: checkout.completionUrl,
      securityToken: checkout.securityToken,
    });
  } catch (err) {
    req.log.error({ err }, "Error starting Reveniu subscription");
    res.status(500).json({ error: "No se pudo iniciar la suscripción. Intenta nuevamente." });
  }
});

// Cambia el plan de una suscripción ya activa (upgrade Starter → NextCob o
// downgrade). El nuevo monto se empuja a Reveniu de inmediato; el próximo
// cobro usará el monto del nuevo plan.
subscriptionRouter.post("/subscription/cambiar-plan", async (req, res) => {
  const userId = req.user!.id;
  try {
    const parsedPlan = z.enum(["starter", "nextcob"]).safeParse(req.body?.plan);
    if (!parsedPlan.success) {
      res.status(400).json({ error: "Plan inválido." });
      return;
    }
    const plan = parsedPlan.data;

    // Transacción con lock de la fila del usuario: evita que dos cambios de
    // plan concurrentes empujen montos distintos a Reveniu y dejen la BD
    // divergente del cobro real.
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      if (!user) return { status: 404 as const, error: "Usuario no encontrado" };
      if (!(await esOwnerDeSuOrg(userId, user.organizationId))) {
        return {
          status: 403 as const,
          error: "Solo el dueño de la organización puede administrar la suscripción.",
        };
      }
      if (user.subscriptionStatus !== "activa" || !user.reveniuSubscriptionId) {
        return { status: 400 as const, error: "Necesitas una suscripción activa para cambiar de plan." };
      }
      if (user.plan === plan) {
        return { status: 400 as const, error: "Ya estás en ese plan." };
      }

      const miembrosActivos = (await contarUsuariosAdicionales(user.organizationId)) + 1;
      if (plan === "starter" && miembrosActivos > PLANES.starter.usuariosIncluidos) {
        return {
          status: 400 as const,
          error:
            "El plan Starter incluye 1 usuario y tu equipo tiene más miembros activos. Desactiva a los demás miembros primero.",
        };
      }

      // Starter no admite packs: al bajar a Starter se eliminan (el próximo
      // cobro deja de incluirlos). El check de miembros de arriba garantiza
      // que no queda gente ocupando asientos de packs.
      const packs = plan === "starter" ? {} : normalizarPacks(user.packsUsuarios);
      const pricing = computePricing(plan, packs);
      // Llamada externa dentro del lock: si Reveniu falla, la transacción se
      // revierte y el plan en BD no cambia (billing y entitlements coherentes).
      await setReveniuAmount(user.reveniuSubscriptionId, pricing.totalMensual);
      await tx
        .update(usersTable)
        .set({ plan, packsUsuarios: packs, reveniuMontoSync: pricing.totalMensual })
        .where(eq(usersTable.id, userId));
      return { status: 200 as const, plan, totalMensual: pricing.totalMensual };
    });

    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    req.log.info({ userId, plan, total: result.totalMensual }, "Plan de suscripción cambiado");
    res.json({ ok: true, plan: result.plan, totalMensual: result.totalMensual });
  } catch (err) {
    req.log.error({ err }, "Error changing subscription plan");
    res.status(500).json({ error: "No se pudo cambiar el plan. Intenta nuevamente." });
  }
});

// Agrega o quita un pack de usuarios adicionales. Los packs se ACUMULAN
// (p. ej. 2× pack5) y se suman al cobro mensual base; al quitar uno, el
// próximo cobro deja de incluirlo. Solo el dueño de la org, transaccional con
// lock de fila (igual que cambiar-plan) para no divergir de Reveniu.
subscriptionRouter.post("/subscription/packs", async (req, res) => {
  const userId = req.user!.id;
  try {
    const parsed = z
      .object({
        pack: z.enum(["individual", "pack5", "pack10", "pack20"]),
        accion: z.enum(["agregar", "quitar"]),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Pack inválido." });
      return;
    }
    const { pack, accion } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      if (!user) return { status: 404 as const, error: "Usuario no encontrado" };
      if (!(await esOwnerDeSuOrg(userId, user.organizationId))) {
        return {
          status: 403 as const,
          error: "Solo el dueño de la organización puede administrar los packs de usuarios.",
        };
      }
      const plan = planEfectivo(user);
      if (!PLANES[plan].permiteUsuariosExtra) {
        return {
          status: 403 as const,
          error: "El plan Starter no admite usuarios adicionales. Mejora al plan NextCob.",
          code: "plan_upgrade",
        };
      }

      const packs = normalizarPacks(user.packsUsuarios);
      if (accion === "agregar") {
        packs[pack] = (packs[pack] ?? 0) + 1;
      } else {
        if ((packs[pack] ?? 0) < 1) {
          return { status: 400 as const, error: "No tienes ese pack contratado." };
        }
        packs[pack] = (packs[pack] ?? 0) - 1;
        if (packs[pack] === 0) delete packs[pack];
        // No permitir quitar un pack si dejaría a miembros activos sin asiento.
        const activos = (await contarUsuariosAdicionales(user.organizationId)) + 1;
        const cupo = PLANES[plan].usuariosIncluidos + cupoDePacks(packs);
        if (activos > cupo) {
          return {
            status: 400 as const,
            error:
              "No puedes quitar este pack: tienes miembros activos ocupando esos asientos. Desactiva miembros primero.",
          };
        }
      }

      const pricing = computePricing(user.plan ?? plan, packs);
      // Con suscripción activa, el nuevo total se empuja a Reveniu de inmediato
      // (si falla, rollback). En trial solo se guarda: se cobra al suscribirse.
      if (user.subscriptionStatus === "activa" && user.reveniuSubscriptionId) {
        await setReveniuAmount(user.reveniuSubscriptionId, pricing.totalMensual);
        await tx
          .update(usersTable)
          .set({ packsUsuarios: packs, reveniuMontoSync: pricing.totalMensual })
          .where(eq(usersTable.id, userId));
      } else {
        await tx
          .update(usersTable)
          .set({ packsUsuarios: packs })
          .where(eq(usersTable.id, userId));
      }
      return { status: 200 as const, packs, totalMensual: pricing.totalMensual };
    });

    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error, code: (result as { code?: string }).code });
      return;
    }
    req.log.info({ userId, pack, accion, total: result.totalMensual }, "Packs de usuarios actualizados");
    res.json({ ok: true, packs: result.packs, totalMensual: result.totalMensual });
  } catch (err) {
    req.log.error({ err }, "Error updating user packs");
    res.status(500).json({ error: "No se pudo actualizar el pack. Intenta nuevamente." });
  }
});

// Lista de espera del plan Pro ("Próximamente"). Idempotente por email.
subscriptionRouter.post("/subscription/pro-waitlist", async (req, res) => {
  const userId = req.user!.id;
  try {
    const parsed = z.string().trim().email().max(320).safeParse(
      req.body?.email ?? req.user!.email ?? "",
    );
    if (!parsed.success) {
      res.status(400).json({ error: "Email inválido." });
      return;
    }
    await db
      .insert(proWaitlistTable)
      .values({ email: parsed.data.toLowerCase(), userId })
      .onConflictDoNothing({ target: proWaitlistTable.email });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error joining Pro waitlist");
    res.status(500).json({ error: "No se pudo guardar tu email. Intenta nuevamente." });
  }
});

// Cancela la renovación de la suscripción: Reveniu deja de cobrar y el cliente
// conserva el acceso hasta el fin del período ya pagado.
subscriptionRouter.post("/subscription/cancel", async (req, res) => {
  const userId = req.user!.id;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if (!user.reveniuSubscriptionId) {
      res.status(400).json({ error: "No tienes una suscripción activa que cancelar." });
      return;
    }
    if (user.subscriptionStatus === "cancelada") {
      res.status(400).json({ error: "Tu suscripción ya está cancelada." });
      return;
    }
    if (!reveniuConfigured()) {
      res.status(503).json({ error: "El servicio de suscripciones no está disponible." });
      return;
    }

    await disableReveniuRenewal(user.reveniuSubscriptionId);
    await db
      .update(usersTable)
      .set({ subscriptionStatus: "cancelada" })
      .where(eq(usersTable.id, userId));

    req.log.info({ userId }, "Suscripción Reveniu cancelada por el usuario");
    res.json({
      ok: true,
      accesoHasta: user.subscriptionPeriodEnd
        ? user.subscriptionPeriodEnd.toISOString()
        : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error cancelling Reveniu subscription");
    res.status(500).json({ error: "No se pudo cancelar la suscripción. Intenta nuevamente." });
  }
});

// Devuelve el link hospedado por Reveniu para actualizar el método de pago.
subscriptionRouter.post("/subscription/payment-method", async (req, res) => {
  const userId = req.user!.id;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if (!user.reveniuSubscriptionId) {
      res.status(400).json({ error: "No tienes una suscripción con método de pago registrado." });
      return;
    }
    res.json({ url: reveniuPaymentMethodUrl(user.reveniuSubscriptionId) });
  } catch (err) {
    req.log.error({ err }, "Error getting payment-method URL");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export { subscriptionRouter };
