import { randomBytes } from "crypto";
import { Router } from "express";
import { db, usersTable, prepagosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { crearOrdenFlow, getPublicBaseUrl } from "../lib/flow-api";
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
import { contarUsuariosAdicionales, getSubscriptionState } from "../lib/subscription";
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

// ── Prepago: pay N months upfront via a one-off Flow payment ─────────────────
const PrepagoBody = z.object({ meses: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]) });

// Computes the prepaid charge for N months including extra active seats.
// All amounts CLP; IVA computed on the full neto to avoid rounding drift.
export function computePrepagoMonto(meses: number, usuariosAdicionales: number) {
  const netoMensual = PLAN_NETO + usuariosAdicionales * COSTO_USUARIO_ADICIONAL_NETO;
  const ivaMensual = PLAN_IVA + usuariosAdicionales * COSTO_USUARIO_ADICIONAL_IVA;
  const neto = netoMensual * meses;
  const iva = ivaMensual * meses;
  return { neto, iva, total: neto + iva };
}
subscriptionRouter.post("/subscription/prepago", async (req, res) => {
  const userId = req.user!.id;
  const parsed = PrepagoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Cantidad de meses inválida (1, 3, 6 o 12)" });
    return;
  }
  if (!flowAdminConfigured()) {
    res.status(503).json({ error: "El pago anticipado no está disponible en este momento." });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const meses = parsed.data.meses;
    const usuariosAdicionales = await contarUsuariosAdicionales(user.organizationId);
    const { neto, iva, total } = computePrepagoMonto(meses, usuariosAdicionales);

    const commerceOrder = `prepago-${randomBytes(8).toString("hex")}`;
    const [prepago] = await db
      .insert(prepagosTable)
      .values({
        userId,
        meses,
        usuariosAdicionales,
        montoNeto: neto,
        montoIva: iva,
        montoTotal: total,
        commerceOrder,
      })
      .returning();

    const creds = getFlowAdminCreds();
    const orden = await crearOrdenFlow(creds.apiKey, creds.secretKey, {
      commerceOrder,
      subject: `NextCob - Pago anticipado ${meses} ${meses === 1 ? "mes" : "meses"}`,
      currency: "CLP",
      amount: total,
      email: user.email ?? `${userId}@cobrosimple.app`,
      urlConfirmation: `${getPublicBaseUrl()}/api/webhooks/flow-prepago`,
      urlReturn: `${getPublicBaseUrl()}/perfil?prepago=retorno`,
    });

    await db
      .update(prepagosTable)
      .set({ flowToken: orden.token })
      .where(eq(prepagosTable.id, prepago.id));

    req.log.info({ userId, meses, total, commerceOrder }, "Prepago iniciado");
    res.json({ url: orden.url, meses, neto, iva, total });
  } catch (err) {
    req.log.error({ err }, "Error starting prepago");
    res.status(500).json({ error: "No se pudo iniciar el pago anticipado. Intenta nuevamente." });
  }
});

export { subscriptionRouter };
