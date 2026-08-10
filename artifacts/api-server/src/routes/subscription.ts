import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

subscriptionRouter.get("/subscription/status", async (req, res) => {
  const userId = req.user!.id;
  try {
    const state = await getSubscriptionState(userId);
    if (!state) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.json(state);
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
    if (user.subscriptionStatus === "activa" && user.reveniuSubscriptionId) {
      res.status(400).json({ error: "Ya tienes una suscripción activa." });
      return;
    }
    if (!user.email) {
      res.status(400).json({ error: "Tu cuenta no tiene un email configurado." });
      return;
    }

    const usuariosAdicionales = await contarUsuariosAdicionales(user.organizationId);
    const pricing = computePricing(usuariosAdicionales + 1);

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
