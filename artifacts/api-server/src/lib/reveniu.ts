import { db, appConfigTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { computePricing } from "./org";
import { normalizarPacks } from "./plans";
import { logger } from "./logger";
import { sendPagoFallidoEmail } from "./email";

// ── Reveniu API client ────────────────────────────────────────────────────────
// Cobro recurrente de la suscripción de la plataforma NextCob vía Reveniu
// (https://docs.reveniu.com). Autenticación por header Reveniu-Secret-Key.
// El plan es de monto variable (is_custom_amount): el monto mensual de cada
// suscripción se define al crearla (base + usuarios extra) y se ajusta con
// POST /subscriptions/{id}/amount/ cuando cambian los seats.

const BASE_URL = (process.env.REVENIU_BASE_URL || "https://api.reveniu.com").replace(/\/+$/, "");
const APP_BASE_URL = (process.env.REVENIU_APP_URL || "https://app.reveniu.com").replace(/\/+$/, "");

const PLAN_CONFIG_KEY = "reveniu_plan_id";
const MONTHLY_FREQUENCY = 3; // docs: intervalos de un plan — "3" = Monthly

export function reveniuConfigured(): boolean {
  return Boolean(process.env.REVENIU_SECRET_KEY);
}

export function reveniuWebhookSecret(): string | null {
  // Reveniu firma sus webhooks reenviando el secret en el header
  // Reveniu-Secret-Key. Permitimos un secreto dedicado si el comercio lo
  // configuró distinto; si no, validamos contra la API secret key.
  return process.env.REVENIU_WEBHOOK_SECRET || process.env.REVENIU_SECRET_KEY || null;
}

async function reveniuFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const secret = process.env.REVENIU_SECRET_KEY;
  if (!secret) throw new Error("REVENIU_SECRET_KEY no configurado");
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Reveniu-Secret-Key": secret,
      "Content-Type": "application/json",
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Reveniu ${init?.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Reveniu ${path}: respuesta no-JSON (${text.slice(0, 120)})`);
  }
}

// ── Plan ──────────────────────────────────────────────────────────────────────
// El plan mensual de monto variable se crea una sola vez y su id se persiste en
// app_config. También se puede fijar por env REVENIU_PLAN_ID (tiene prioridad).
export async function ensureReveniuPlanId(): Promise<number> {
  const fromEnv = process.env.REVENIU_PLAN_ID?.trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);

  const [row] = await db
    .select()
    .from(appConfigTable)
    .where(eq(appConfigTable.clave, PLAN_CONFIG_KEY));
  if (row && /^\d+$/.test(row.valor)) return Number(row.valor);

  const created = await reveniuFetch<{ id: number }>("/api/v1/plans/", {
    method: "POST",
    body: {
      frequency: MONTHLY_FREQUENCY,
      title: "NextCob — Suscripción mensual",
      description:
        "Suscripción mensual a NextCob (plan base + usuarios adicionales, IVA incluido).",
      is_custom_amount: true,
      is_auto_renew: true,
      auto_renew: true,
      cicles: 1,
    },
  });
  if (!created?.id) throw new Error("Reveniu no devolvió id al crear el plan");

  await db
    .insert(appConfigTable)
    .values({ clave: PLAN_CONFIG_KEY, valor: String(created.id) })
    .onConflictDoUpdate({
      target: appConfigTable.clave,
      set: { valor: String(created.id) },
    });
  return created.id;
}

// ── Checkout ──────────────────────────────────────────────────────────────────
export interface ReveniuCheckout {
  subscriptionId: number;
  completionUrl: string;
  securityToken: string;
}

export async function createReveniuCheckout(params: {
  userId: string;
  email: string;
  nombre: string;
  rut?: string | null;
  amount: number; // CLP total mensual (IVA incluido)
}): Promise<ReveniuCheckout> {
  const planId = await ensureReveniuPlanId();
  const fieldValues: Record<string, unknown> = {
    email: params.email,
    name: params.nombre,
    amount: params.amount,
  };
  if (params.rut) fieldValues.rut = params.rut.replace(/\./g, "");
  const res = await reveniuFetch<{
    id: number;
    completion_url: string;
    security_token: string;
  }>("/api/v1/subscriptions/", {
    method: "POST",
    body: {
      plan_id: planId,
      external_id: params.userId,
      field_values: fieldValues,
    },
  });
  if (!res?.id || !res.completion_url || !res.security_token) {
    throw new Error("Reveniu no devolvió los datos completos del checkout (id/completion_url/security_token)");
  }
  return {
    subscriptionId: res.id,
    completionUrl: res.completion_url,
    securityToken: res.security_token,
  };
}

// Detalle de una suscripción en Reveniu. next_due es la fecha autoritativa del
// próximo cobro: la usamos como fin del período pagado (estable frente a
// reintentos de webhooks, lo que hace idempotente el registro de pagos).
export interface ReveniuSubscriptionDetail {
  id: number;
  status?: string | number;
  nextDue: Date | null;
}

export async function getReveniuSubscription(
  subscriptionId: number,
): Promise<ReveniuSubscriptionDetail> {
  const res = await reveniuFetch<Record<string, unknown>>(
    `/api/v1/subscriptions/${subscriptionId}`,
  );
  const rawNextDue = (res.next_due ?? res.next_payment_date ?? null) as
    | string
    | null;
  let nextDue: Date | null = null;
  if (rawNextDue) {
    const parsed = new Date(rawNextDue);
    if (!Number.isNaN(parsed.getTime())) nextDue = parsed;
  }
  return {
    id: Number(res.id ?? subscriptionId),
    status: res.status as string | number | undefined,
    nextDue,
  };
}

// ── Gestión de una suscripción existente ─────────────────────────────────────
export async function setReveniuAmount(subscriptionId: number, amount: number): Promise<void> {
  await reveniuFetch(`/api/v1/subscriptions/${subscriptionId}/amount/`, {
    method: "POST",
    body: { amount },
  });
}

// Desactiva la renovación: el cliente conserva el acceso hasta el fin del
// período ya pagado y no se le vuelve a cobrar.
export async function disableReveniuRenewal(subscriptionId: number): Promise<void> {
  await reveniuFetch(`/api/v1/subscriptions/${subscriptionId}/disablerenew/`, {
    method: "POST",
  });
}

// Link hospedado por Reveniu para actualizar el método de pago de una
// suscripción (misma URL que Reveniu envía por correo con change_method).
export function reveniuPaymentMethodUrl(subscriptionId: number): string {
  return `${APP_BASE_URL}/renew/${subscriptionId}`;
}

// ── Sincronización mensual de montos (base + usuarios extra activos) ─────────
// Recalcula el total mensual de cada suscripción Reveniu activa y, si difiere
// del último monto sincronizado, lo actualiza en Reveniu. Así el próximo cobro
// mensual refleja los usuarios extra activos ese mes. Idempotente y seguro de
// correr en paralelo (el peor caso es repetir un POST con el mismo monto).
export async function sincronizarMontosReveniu(log = logger): Promise<void> {
  if (!reveniuConfigured()) return;
  const rows = await db
    .select({
      id: usersTable.id,
      reveniuSubscriptionId: usersTable.reveniuSubscriptionId,
      reveniuMontoSync: usersTable.reveniuMontoSync,
      organizationId: usersTable.organizationId,
      plan: usersTable.plan,
      packsUsuarios: usersTable.packsUsuarios,
    })
    .from(usersTable)
    .where(
      and(
        isNotNull(usersTable.reveniuSubscriptionId),
        or(
          eq(usersTable.subscriptionStatus, "activa"),
          eq(usersTable.subscriptionStatus, "cancelada"),
        ),
      ),
    );

  for (const row of rows) {
    try {
      const total = computePricing(
        row.plan ?? "nextcob",
        normalizarPacks(row.packsUsuarios),
      ).totalMensual;
      if (row.reveniuMontoSync === total) continue;
      // GRANDFATHERING: si ya hay un monto sincronizado con Reveniu que difiere
      // del modelo actual (p. ej. clientes antiguos con cobro per-seat), NO se
      // pisa: reveniuMontoSync es lo que Reveniu cobra hoy y sólo cambia cuando
      // el cliente modifica su plan o packs (push transaccional en las rutas).
      // El barrido sólo repara filas nunca sincronizadas (NULL).
      if (row.reveniuMontoSync != null) {
        log.warn(
          { userId: row.id, montoSync: row.reveniuMontoSync, montoModelo: total },
          "Monto Reveniu difiere del modelo de packs (cliente grandfathered); no se modifica",
        );
        continue;
      }
      await setReveniuAmount(row.reveniuSubscriptionId!, total);
      await db
        .update(usersTable)
        .set({ reveniuMontoSync: total })
        .where(eq(usersTable.id, row.id));
      log.info(
        { userId: row.id, subscriptionId: row.reveniuSubscriptionId, total },
        "Monto de suscripción Reveniu sincronizado",
      );
    } catch (err) {
      log.error({ err, userId: row.id }, "No se pudo sincronizar el monto Reveniu");
    }
  }
}

// ── Gracia por pago fallido (3 días) ─────────────────────────────────────────
// Reveniu no envía un webhook explícito de "pago fallido": reintenta el cobro
// por su cuenta y sólo notifica el éxito (subscription_payment_succeeded) o la
// baja definitiva (subscription_deactivated). Detectamos el fallo cuando el
// período pagado venció sin que llegara el pago del siguiente mes:
//   1) primer barrido tras el vencimiento → email de aviso + inicio de gracia;
//   2) 3 días después sin pago → subscription_status = 'vencida' (suspensión).
// Un pago exitoso posterior (webhook) limpia avisoPagoFallidoEn y reactiva.
const GRACIA_MS = 3 * 24 * 60 * 60 * 1000;

export async function procesarGraciaPagosFallidos(log = logger): Promise<void> {
  const now = new Date();
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      and(
        isNotNull(usersTable.reveniuSubscriptionId),
        eq(usersTable.subscriptionStatus, "activa"),
        isNotNull(usersTable.subscriptionPeriodEnd),
        lt(usersTable.subscriptionPeriodEnd, now),
        eq(usersTable.activo, true),
        eq(usersTable.esDemo, false),
      ),
    );

  for (const user of rows) {
    try {
      if (!user.avisoPagoFallidoEn) {
        // Claim atómico del aviso: sólo el proceso que setea el timestamp envía
        // el email (evita duplicados si corren dos barridos a la vez).
        const claimed = await db
          .update(usersTable)
          .set({ avisoPagoFallidoEn: now })
          .where(
            and(
              eq(usersTable.id, user.id),
              sql`${usersTable.avisoPagoFallidoEn} IS NULL`,
              eq(usersTable.subscriptionStatus, "activa"),
            ),
          )
          .returning({ id: usersTable.id });
        if (claimed.length > 0 && user.email) {
          await sendPagoFallidoEmail(
            {
              email: user.email,
              nombre: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
              montoMensual:
                user.reveniuMontoSync ??
                computePricing(user.plan ?? "nextcob", normalizarPacks(user.packsUsuarios)).totalMensual,
              graciaHasta: new Date(now.getTime() + GRACIA_MS),
              actualizarMetodoUrl: user.reveniuSubscriptionId
                ? reveniuPaymentMethodUrl(user.reveniuSubscriptionId)
                : null,
            },
            { warn: (obj, msg) => log.warn(obj, msg) },
          );
          log.info({ userId: user.id }, "Aviso de pago fallido enviado (gracia 3 días)");
        }
        continue;
      }

      if (now.getTime() - user.avisoPagoFallidoEn.getTime() >= GRACIA_MS) {
        // Sólo suspende si sigue activa y el período no fue extendido por un
        // pago posterior (condición en SQL para no pisar un webhook concurrente).
        await db
          .update(usersTable)
          .set({ subscriptionStatus: "vencida" })
          .where(
            and(
              eq(usersTable.id, user.id),
              eq(usersTable.subscriptionStatus, "activa"),
              lt(usersTable.subscriptionPeriodEnd, now),
              isNotNull(usersTable.avisoPagoFallidoEn),
            ),
          );
        log.info({ userId: user.id }, "Suscripción suspendida tras gracia de 3 días");
      }
    } catch (err) {
      log.error({ err, userId: user.id }, "Error procesando gracia de pago fallido");
    }
  }
}
