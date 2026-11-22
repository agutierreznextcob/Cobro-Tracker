import { type Request, type Response, type NextFunction } from "express";
import { userHasAccess } from "../lib/subscription";

// Blocks access to feature routes when the user's trial has ended and there is
// no active subscription (or a recurring charge failed). Must run AFTER the
// auth middleware that populates req.user.
export async function requireSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }

  try {
    const ok = await userHasAccess(userId);
    if (!ok) {
      res.status(402).json({
        error: "Tu prueba terminó. Suscríbete para continuar.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }
    next();
  } catch (err) {
    console.error("[requireSubscription] Error checking subscription access:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
}
