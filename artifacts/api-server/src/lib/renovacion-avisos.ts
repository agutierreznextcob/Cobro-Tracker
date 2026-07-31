import { db, usersTable } from "@workspace/db";
import { and, eq, gt, isNotNull, lte, or, isNull, ne, sql } from "drizzle-orm";
import { sendRenovacionEmail } from "./email";
import { getPublicBaseUrl } from "./flow-api";
import { PLAN_AMOUNT } from "./flow-subscriptions";

interface Logger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

const DIAS_AVISO = 7;

// Emails a renewal notice ~7 days before an active subscription period ends
// (mainly for prepaid periods, which do not auto-renew). Idempotent per period:
// renovacionAvisoParaEl records the periodEnd already notified, so each period
// is warned exactly once even across restarts. Demo accounts are excluded.
// Runs from the daily scheduler tick; never throws.
export async function procesarAvisosRenovacion(log?: Logger): Promise<void> {
  try {
    const limite = new Date(Date.now() + DIAS_AVISO * 24 * 60 * 60 * 1000);
    const candidatos = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.subscriptionStatus, "activa"),
          eq(usersTable.activo, true),
          eq(usersTable.esDemo, false),
          isNotNull(usersTable.subscriptionPeriodEnd),
          lte(usersTable.subscriptionPeriodEnd, limite),
          gt(usersTable.subscriptionPeriodEnd, sql`now()`),
          or(
            isNull(usersTable.renovacionAvisoParaEl),
            ne(usersTable.renovacionAvisoParaEl, usersTable.subscriptionPeriodEnd),
          ),
        ),
      );

    for (const user of candidatos) {
      if (!user.email) continue;
      try {
        // Claim first (idempotent even if the email then fails; a failed send
        // for a notice is acceptable — better than duplicate notices).
        const [claimed] = await db
          .update(usersTable)
          .set({ renovacionAvisoParaEl: user.subscriptionPeriodEnd })
          .where(
            and(
              eq(usersTable.id, user.id),
              or(
                isNull(usersTable.renovacionAvisoParaEl),
                ne(usersTable.renovacionAvisoParaEl, usersTable.subscriptionPeriodEnd),
              ),
            ),
          )
          .returning({ id: usersTable.id });
        if (!claimed) continue;

        const result = await sendRenovacionEmail(
          {
            email: user.email,
            nombre: user.firstName,
            estado: "activa",
            vencido: false,
            vencimiento: user.subscriptionPeriodEnd?.toISOString() ?? null,
            precioMensual: PLAN_AMOUNT,
            ctaUrl: `${getPublicBaseUrl()}/perfil`,
          },
          log,
        );
        if (result.ok) {
          log?.info({ userId: user.id }, "Aviso de renovación enviado (7 días antes)");
        } else {
          log?.warn({ userId: user.id, error: result.error }, "No se pudo enviar aviso de renovación");
        }
      } catch (err) {
        log?.error({ err, userId: user.id }, "Error enviando aviso de renovación");
      }
    }
  } catch (err) {
    log?.error({ err }, "procesarAvisosRenovacion failed");
  }
}
