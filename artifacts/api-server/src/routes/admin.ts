import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { computeSubscriptionState } from "../lib/subscription";
import { sendRenovacionEmail } from "../lib/email";
import { getPublicBaseUrl } from "../lib/flow-api";

const adminRouter = Router();

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// All admin routes require an authenticated admin user.
adminRouter.use("/admin", (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});
adminRouter.use("/admin", requireAdmin);

function nombreDe(u: { firstName: string | null; lastName: string | null }): string | null {
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || null;
}

// Vencimiento (expiry) is the period end for active subs, otherwise the trial end.
function vencimientoDe(state: {
  status: "prueba" | "activa" | "vencida";
  periodEnd: string | null;
  trialEndsAt: string | null;
}): string | null {
  return state.status === "activa" ? state.periodEnd : state.trialEndsAt;
}

adminRouter.get("/admin/usuarios", async (req, res) => {
  try {
    const rows = await db.select().from(usersTable);

    const usuarios = rows
      .map((u) => {
        const state = computeSubscriptionState({
          subscriptionStatus: u.subscriptionStatus,
          trialEndsAt: u.trialEndsAt,
          subscriptionPeriodEnd: u.subscriptionPeriodEnd,
          flowSubscriptionId: u.flowSubscriptionId,
          role: u.role,
        });

        const vencimiento = vencimientoDe(state);
        let diasParaVencer: number | null = null;
        if (vencimiento) {
          const ms = new Date(vencimiento).getTime() - Date.now();
          diasParaVencer = Math.ceil(ms / MS_PER_DAY);
        }

        // Reminders apply to non-admins whose access ended or ends within 3 days.
        const requiereRecordatorio =
          !state.isAdmin &&
          (state.status === "vencida" ||
            (diasParaVencer !== null && diasParaVencer <= 3));

        return {
          id: u.id,
          nombre: nombreDe(u),
          email: u.email,
          role: u.role,
          subscriptionStatus: state.status,
          hasAccess: state.hasAccess,
          isAdmin: state.isAdmin,
          tieneSuscripcion: state.tieneSuscripcion,
          createdAt: u.createdAt ? u.createdAt.toISOString() : null,
          trialEndsAt: state.trialEndsAt,
          subscriptionPeriodEnd: state.periodEnd,
          vencimiento,
          diasParaVencer,
          requiereRecordatorio,
        };
      })
      .sort((a, b) => {
        // Most recently registered first.
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

    res.json(usuarios);
  } catch (err) {
    req.log.error({ err }, "Error listing admin usuarios");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

adminRouter.post("/admin/usuarios/:id/recordatorio-email", async (req, res) => {
  const { id } = req.params;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!u) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if (!u.email) {
      res.status(400).json({
        ok: false,
        message: "El usuario no tiene un email registrado.",
      });
      return;
    }

    const state = computeSubscriptionState({
      subscriptionStatus: u.subscriptionStatus,
      trialEndsAt: u.trialEndsAt,
      subscriptionPeriodEnd: u.subscriptionPeriodEnd,
      flowSubscriptionId: u.flowSubscriptionId,
      role: u.role,
    });

    const vencimiento = vencimientoDe(state);
    const vencido = state.status === "vencida" || !state.hasAccess;

    const result = await sendRenovacionEmail(
      {
        email: u.email,
        nombre: nombreDe(u),
        estado: state.status,
        vencido,
        vencimiento,
        precioMensual: state.precioMensual,
        ctaUrl: `${getPublicBaseUrl()}/perfil`,
      },
      req.log,
    );

    if (!result.ok) {
      res.status(502).json({
        ok: false,
        message: result.error ?? "No se pudo enviar el recordatorio.",
      });
      return;
    }

    res.json({ ok: true, message: "Recordatorio enviado correctamente." });
  } catch (err) {
    req.log.error({ err }, "Error sending admin recordatorio email");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export { adminRouter };
