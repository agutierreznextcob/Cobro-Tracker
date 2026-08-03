import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getPublicBaseUrl } from "../lib/flow-api";
import {
  getFlowAdminCreds,
  flowAdminConfigured,
  ensurePlan,
  createCustomer,
  registerCard,
  getRegisterStatus,
  createSubscription,
  mapSubscription,
} from "../lib/flow-subscriptions";
import { getSubscriptionState } from "../lib/subscription";
import { PLAN_NETO, PLAN_IVA } from "../lib/flow-subscriptions";
import {
  COSTO_USUARIO_ADICIONAL_NETO,
  COSTO_USUARIO_ADICIONAL_IVA,
} from "../lib/org";

const subscriptionRouter = Router();

// Where Flow returns the browser after the hosted card-registration page.
function registerReturnUrl(): string {
  return `${getPublicBaseUrl()}/api/subscription/register-return`;
}

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

subscriptionRouter.post("/subscription/subscribe", async (req, res) => {
  const userId = req.user!.id;

  if (!flowAdminConfigured()) {
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
    if (user.subscriptionStatus === "activa") {
      res.status(400).json({ error: "Ya tienes una suscripción activa." });
      return;
    }

    const creds = getFlowAdminCreds();
    await ensurePlan(creds);

    // Ensure a Flow customer exists for this user.
    let customerId = user.flowCustomerId;
    if (!customerId) {
      const nombre =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.email ||
        "Cliente NextCob";
      const email = user.email ?? `${userId}@cobrosimple.app`;
      const customer = await createCustomer(creds, { name: nombre, email, externalId: userId });
      customerId = customer.customerId;
      await db
        .update(usersTable)
        .set({ flowCustomerId: customerId })
        .where(eq(usersTable.id, userId));
    }

    // Start hosted card registration.
    const register = await registerCard(creds, {
      customerId,
      urlReturn: registerReturnUrl(),
    });

    await db
      .update(usersTable)
      .set({ flowRegisterToken: register.token })
      .where(eq(usersTable.id, userId));

    res.json({ url: register.url });
  } catch (err) {
    req.log.error({ err }, "Error starting subscription");
    res.status(500).json({ error: "No se pudo iniciar la suscripción. Intenta nuevamente." });
  }
});

export { subscriptionRouter };
