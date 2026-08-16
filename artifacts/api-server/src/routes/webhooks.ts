import { createHmac, timingSafeEqual } from "crypto";
import { Router } from "express";
import { db, cobrosTable, webhookEventosTable, pagosParciales, usersTable, mpCredencialesTable, pagosSuscripcionTable } from "@workspace/db";
import { computePricing } from "../lib/org";
import { eq, desc, and, sql } from "drizzle-orm";
import { ReceiveCobroWebhookBody } from "@workspace/api-zod";
import { verificarPagoFlow } from "../lib/flow-api";
import { obtenerPagoMp } from "../lib/mp-api";
import { getFlowCredentials, getMpCredentials } from "./profile";
import {
  getFlowAdminCreds,
  flowAdminConfigured,
  getSubscription,
  mapSubscription,
} from "../lib/flow-subscriptions";
import { requireSubscription } from "../middlewares/requireSubscription";
import { emitirComprobante } from "../lib/comprobante-service";
import { reveniuWebhookSecret, reveniuConfigured, getReveniuSubscription } from "../lib/reveniu";

// Comparación en tiempo constante entre strings de largo posiblemente distinto.
function safeEquals(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const webhooksRouter = Router();

// Dispara la emisión del comprobante (PDF + email) cuando un cobro llega a
// `pagado`. Es fire-and-forget e idempotente (gate por comprobantes.cobro_id),
// así que llamarlo varias veces para el mismo cobro produce un solo comprobante.
function emitirComprobanteSiPagado(
  estado: string,
  cobroId: number,
  metodo: string,
  referencia: string | null,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void },
): void {
  if (estado !== "pagado") return;
  void emitirComprobante(cobroId, { metodo, referencia }, log);
}

const EVENTO_A_ESTADO: Record<string, "pagado" | "fallido" | "cancelado" | "pendiente"> = {
  "pago.completado": "pagado",
  "pago.fallido": "fallido",
  "pago.cancelado": "cancelado",
  "pago.pendiente": "pendiente",
};

type CobroEstado = "pendiente" | "pagado" | "parcial" | "fallido" | "cancelado";

// Estados que representan dinero efectivamente recibido. Una vez que un cobro
// llega a uno de estos, el estado real del dinero tiene prioridad.
const ESTADOS_CON_DINERO: ReadonlySet<CobroEstado> = new Set(["pagado", "parcial"]);

/**
 * Aplica un estado proveniente de un webhook respetando la prioridad del estado
 * real del dinero. La protección es ATÓMICA en SQL (no select-then-update) para
 * evitar condiciones de carrera entre webhooks concurrentes/fuera de orden.
 *
 * Reglas:
 *  - Una confirmación de pago real (pagado/parcial) SIEMPRE se aplica, aunque el
 *    cobro haya sido marcado manualmente como fallido/cancelado/pendiente antes.
 *  - Un estado sin dinero (pendiente/fallido/cancelado) NO degrada un cobro que
 *    ya refleja dinero recibido (pagado/parcial), salvo que sea un reembolso real
 *    confirmado por el proveedor (esReembolso).
 *
 * Devuelve true si la fila fue actualizada, false si la actualización fue
 * ignorada por precedencia (el cobro ya reflejaba un pago confirmado).
 */
async function aplicarEstadoCobro(
  cobroId: number,
  nuevoEstado: CobroEstado,
  opts?: { esReembolso?: boolean; extra?: Record<string, unknown> },
): Promise<boolean> {
  const protegerDinero = !ESTADOS_CON_DINERO.has(nuevoEstado) && !opts?.esReembolso;
  const where = protegerDinero
    ? and(
        eq(cobrosTable.id, cobroId),
        sql`${cobrosTable.estado} not in ('pagado', 'parcial')`,
      )
    : eq(cobrosTable.id, cobroId);

  const filas = await db
    .update(cobrosTable)
    .set({
      estado: nuevoEstado,
      actualizadoEn: new Date(),
      // Track the payment confirmation timestamp for accurate revenue reporting.
      pagadoEn:
        nuevoEstado === "pagado"
          ? sql`coalesce(${cobrosTable.pagadoEn}, now())`
          : nuevoEstado === "parcial"
            ? sql`${cobrosTable.pagadoEn}`
            : null,
      ...(opts?.extra ?? {}),
    })
    .where(where)
    .returning({ id: cobrosTable.id });

  return filas.length > 0;
}

/**
 * Recalcula el estado de un cobro a partir de sus abonos confirmados, usando el
 * monto neto (monto - descuento) y manteniendo pagadoEn consistente:
 * se fija al primer paso a "pagado" y se conserva si ya existía.
 * Compartido por los webhooks de Flow y MercadoPago para abonos.
 */
async function recalcularCobroDesdeAbonos(
  cobroId: number,
): Promise<"pagado" | "parcial" | "pendiente"> {
  const [sumResult] = await db
    .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
    .from(pagosParciales)
    .where(and(eq(pagosParciales.cobroId, cobroId), eq(pagosParciales.estado, "confirmado")));
  const [cobro] = await db
    .select({ monto: cobrosTable.monto, montoDescuento: cobrosTable.montoDescuento })
    .from(cobrosTable)
    .where(eq(cobrosTable.id, cobroId));
  const totalPagado = sumResult?.total ?? 0;
  const montoTotal = Math.max(
    Number(cobro?.monto ?? 0) - Number(cobro?.montoDescuento ?? 0),
    0,
  );
  const nuevoEstado: "pagado" | "parcial" | "pendiente" =
    totalPagado >= montoTotal && montoTotal > 0
      ? "pagado"
      : totalPagado > 0
        ? "parcial"
        : "pendiente";
  await db
    .update(cobrosTable)
    .set({
      estado: nuevoEstado,
      actualizadoEn: new Date(),
      pagadoEn:
        nuevoEstado === "pagado"
          ? sql`coalesce(${cobrosTable.pagadoEn}, now())`
          : nuevoEstado === "parcial"
            ? sql`${cobrosTable.pagadoEn}`
            : null,
    })
    .where(eq(cobrosTable.id, cobroId));
  return nuevoEstado;
}

function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(`sha256=${expected}`, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

async function logEvento({
  evento,
  cobroId,
  ipOrigen,
  exitoso,
  detalle,
}: {
  evento: string;
  cobroId?: number | null;
  ipOrigen?: string | null;
  exitoso: boolean;
  detalle?: string | null;
}) {
  await db.insert(webhookEventosTable).values({
    evento,
    cobroId: cobroId ?? null,
    ipOrigen: ipOrigen ?? null,
    resultado: exitoso ? "exitoso" : "fallido",
    exitoso,
    detalle: detalle ?? null,
  });
}

function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first?.trim() ?? null;
  }
  return req.socket.remoteAddress ?? null;
}

// Flow sends POST (form-urlencoded) with just `token` to urlConfirmation.
// We must call back to Flow API with getStatus to verify the real payment status.
// Security: trust only comes from calling Flow's API, not from the body content.
webhooksRouter.post("/webhooks/flow", async (req, res) => {
  const ip = getClientIp(req as Parameters<typeof getClientIp>[0]);

  // Flow sends token via form-urlencoded body
  const token = (req.body?.token ?? req.query?.token) as string | undefined;

  req.log.info({ token, body: req.body, query: req.query }, "Flow webhook received");

  if (!token || typeof token !== "string" || token.trim() === "") {
    req.log.warn({ body: req.body }, "Flow webhook: missing token");
    await logEvento({ evento: "flow.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: "Falta token en la notificación de Flow" });
    // Flow requires 200 OK even on errors, otherwise it retries
    res.status(200).json({ ok: false, error: "Falta token" });
    return;
  }

  try {
    // 1a. Find a pagosParciales by flowToken (abono payment)
    const [abono] = await db
      .select()
      .from(pagosParciales)
      .where(eq(pagosParciales.flowToken, token.trim()));

    if (abono) {
      // It's a partial payment — find its parent cobro
      const [cobroParcial] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, abono.cobroId));
      if (!cobroParcial?.responsableId) {
        res.status(200).json({ ok: false, error: "Cobro sin responsable" });
        return;
      }
      const creds = await getFlowCredentials(cobroParcial.responsableId);
      if (!creds) { res.status(200).json({ ok: false }); return; }
      const pagoStatus = await verificarPagoFlow(creds.apiKey, creds.secretKey, token);
      req.log.info({ abonoId: abono.id, cobroId: abono.cobroId, flowStatus: pagoStatus.status }, "Flow abono payment verified");
      if (pagoStatus.status === 2) {
        await db.update(pagosParciales).set({ estado: "confirmado", confirmadoEn: new Date() }).where(eq(pagosParciales.id, abono.id));
        // Recalculate cobro estado from confirmed abonos (net of discounts, keeps pagadoEn consistent)
        const nuevoEstadoCobro = await recalcularCobroDesdeAbonos(abono.cobroId);
        await logEvento({ evento: "flow.abono.confirmado", cobroId: abono.cobroId, ipOrigen: ip, exitoso: true, detalle: `Abono #${abono.id} confirmado, cobro ahora ${nuevoEstadoCobro}` });
        emitirComprobanteSiPagado(nuevoEstadoCobro, abono.cobroId, "flow", token.trim(), req.log);
      } else if (pagoStatus.status === 3 || pagoStatus.status === 4) {
        await db.update(pagosParciales).set({ estado: "fallido" }).where(eq(pagosParciales.id, abono.id));
        await logEvento({ evento: "flow.abono.fallido", cobroId: abono.cobroId, ipOrigen: ip, exitoso: true, detalle: `Abono #${abono.id} fallido (status ${pagoStatus.status})` });
      }
      res.status(200).json({ ok: true });
      return;
    }

    // 1b. Find the cobro by the stored token (set when creating the Flow order)
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.flowToken, token.trim()));

    if (!cobro) {
      req.log.warn({ token }, "Flow webhook: no cobro found for token");
      await logEvento({ evento: "flow.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Token desconocido: ${token}` });
      res.status(200).json({ ok: false, error: "Token no reconocido" });
      return;
    }

    req.log.info({ cobroId: cobro.id, token }, "Found cobro for Flow token");

    // 2. Get the credentials of the user who created this cobro
    if (!cobro.responsableId) {
      req.log.error({ cobroId: cobro.id }, "Cobro has no responsableId, cannot verify Flow payment");
      await logEvento({ evento: "flow.webhook.error", cobroId: cobro.id, ipOrigen: ip, exitoso: false, detalle: "Cobro sin responsableId — no se pueden obtener credenciales" });
      res.status(200).json({ ok: false });
      return;
    }

    const creds = await getFlowCredentials(cobro.responsableId);
    if (!creds) {
      req.log.error({ cobroId: cobro.id, responsableId: cobro.responsableId }, "No Flow credentials found for cobro owner");
      await logEvento({ evento: "flow.webhook.error", cobroId: cobro.id, ipOrigen: ip, exitoso: false, detalle: "No hay credenciales Flow del responsable del cobro" });
      res.status(200).json({ ok: false });
      return;
    }

    // 3. Call Flow API to get the REAL payment status (this is the actual verification)
    const pagoStatus = await verificarPagoFlow(creds.apiKey, creds.secretKey, token);

    req.log.info({ cobroId: cobro.id, flowStatus: pagoStatus.status, flowOrder: pagoStatus.flowOrder }, "Flow payment status verified");

    // Flow status: 1=pending, 2=paid, 3=rejected/failed, 4=cancelled
    const estadoMap: Record<number, "pagado" | "fallido" | "cancelado" | "pendiente"> = {
      1: "pendiente",
      2: "pagado",
      3: "fallido",
      4: "cancelado",
    };
    const nuevoEstado = estadoMap[pagoStatus.status];

    if (!nuevoEstado || nuevoEstado === "pendiente") {
      // Still pending — don't update, just acknowledge
      await logEvento({
        evento: "flow.pago.pendiente",
        cobroId: cobro.id,
        ipOrigen: ip,
        exitoso: true,
        detalle: `Flow status ${pagoStatus.status} — pago aún pendiente`,
      });
      res.status(200).json({ ok: true });
      return;
    }

    // 4. Update cobro with the verified status — el estado real del dinero
    // siempre tiene prioridad: nunca degradamos un cobro ya pagado/parcial por
    // una notificación de rechazo/cancelación tardía (protección atómica en SQL).
    const aplicado = await aplicarEstadoCobro(cobro.id, nuevoEstado);

    if (!aplicado) {
      await logEvento({
        evento: "flow.pago.ignorado",
        cobroId: cobro.id,
        ipOrigen: ip,
        exitoso: true,
        detalle: `Flow status ${pagoStatus.status} → ${nuevoEstado} ignorado: el cobro ya refleja un pago confirmado (pagado/parcial tiene prioridad). Token: ${token}`,
      });
      req.log.info({ cobroId: cobro.id, propuesto: nuevoEstado }, "Flow webhook: estado ignorado para proteger pago confirmado");
      res.status(200).json({ ok: true });
      return;
    }

    await logEvento({
      evento: `flow.pago.${nuevoEstado}`,
      cobroId: cobro.id,
      ipOrigen: ip,
      exitoso: true,
      detalle: `Flow status ${pagoStatus.status} → ${nuevoEstado}. FlowOrder: ${pagoStatus.flowOrder}. Token: ${token}`,
    });

    req.log.info({ cobroId: cobro.id, nuevoEstado }, "Cobro updated via Flow webhook (verified)");
    emitirComprobanteSiPagado(nuevoEstado, cobro.id, "flow", pagoStatus.flowOrder != null ? String(pagoStatus.flowOrder) : token.trim(), req.log);
    res.status(200).json({ ok: true });
  } catch (err) {
    req.log.error({ err, token }, "Error processing Flow webhook");
    await logEvento({ evento: "flow.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Error interno: ${String(err)}` });
    // Return 200 so Flow doesn't retry infinitely — the error is on our side
    res.status(200).json({ ok: false, error: "Error interno" });
  }
});

// MercadoPago sends POST to notification_url with ?topic=payment&id=PAYMENT_ID
// or ?type=payment&data.id=PAYMENT_ID (newer IPN format).
// We verify the real payment status by calling the MP Payments API.
webhooksRouter.post("/webhooks/mercadopago", async (req, res) => {
  const ip = getClientIp(req as Parameters<typeof getClientIp>[0]);

  // Support both IPN formats
  const paymentId = (req.query.id ?? req.query["data.id"] ?? req.body?.data?.id) as string | undefined;
  const topic = (req.query.topic ?? req.query.type ?? req.body?.type) as string | undefined;

  req.log.info({ paymentId, topic, body: req.body, query: req.query }, "MercadoPago webhook received");

  if (!paymentId || (topic && topic !== "payment" && topic !== "merchant_order")) {
    await logEvento({ evento: "mp.webhook.ignorado", cobroId: null, ipOrigen: ip, exitoso: true, detalle: `topic=${topic}, id=${paymentId}` });
    res.status(200).json({ ok: true });
    return;
  }

  try {
    // Find cobro by externalReference: `cobro-{id}`
    // But we need the MP access token first — we'll search by mpPreferenceId approach:
    // MP sends data.id (paymentId), we call GET /v1/payments/{id} to get external_reference
    // external_reference = "cobro-{cobroId}"
    // We need any valid MP access token — use the cobro owner's token

    // First, do a quick DB lookup by approximating — we'll look at all cobros with mpPreferenceId set
    // and find the one whose external_reference matches.
    // More efficient: decode external_reference from payment after fetching with any user's token.
    // Since we don't know whose token to use upfront, we try the cobro's responsableId after lookup.

    // Strategy: find cobro using external_reference from the payment.
    // We need a token to call MP API. We'll look up cobros with mpPreferenceId set first,
    // then match by external_reference "cobro-{id}".

    // Candidate tokens: the global MP_ACCESS_TOKEN (if configured) plus every
    // merchant's stored OAuth token. Payments created with a user-specific token
    // may not be visible to the global token, so we try each until one works.
    const candidateTokens: string[] = [];
    if (process.env.MP_ACCESS_TOKEN) candidateTokens.push(process.env.MP_ACCESS_TOKEN);
    const credRows = await db
      .select({ userId: mpCredencialesTable.userId })
      .from(mpCredencialesTable);
    for (const row of credRows) {
      try {
        const tok = await getMpCredentials(row.userId);
        if (tok && !candidateTokens.includes(tok)) candidateTokens.push(tok);
      } catch {
        // Skip tokens that fail to decrypt; others may still work.
      }
    }
    if (candidateTokens.length === 0) {
      req.log.warn("No MercadoPago tokens available — cannot verify payment");
      await logEvento({ evento: "mp.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: "Sin tokens de MercadoPago configurados" });
      res.status(200).json({ ok: false, error: "Token MP no configurado" });
      return;
    }

    let payment: Awaited<ReturnType<typeof obtenerPagoMp>> | null = null;
    let lastErr: unknown = null;
    for (const tok of candidateTokens) {
      try {
        payment = await obtenerPagoMp(tok, paymentId);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!payment) {
      throw lastErr ?? new Error("No se pudo verificar el pago de MercadoPago con ningún token");
    }
    req.log.info({ paymentId, status: payment.status, externalRef: payment.external_reference }, "MercadoPago payment verified");

    // Map MP status
    const estadoMap: Record<string, "pagado" | "fallido" | "cancelado" | "pendiente"> = {
      approved: "pagado", rejected: "fallido", cancelled: "cancelado", refunded: "cancelado",
      in_process: "pendiente", pending: "pendiente", authorized: "pendiente",
    };

    const ref = payment.external_reference ?? "";

    // Seguridad: la verificación inicial pudo hacerse con el token de cualquier
    // comercio; antes de aplicar cambios, re-verificamos el pago con el token del
    // dueño del cobro (o el token global de plataforma). Así un comercio no puede
    // forzar cambios de estado en cobros de otra organización usando un
    // external_reference ajeno.
    const verificarConTokenPropietario = async (
      responsableId: string | null,
    ): Promise<typeof payment | null> => {
      const ownerToken = responsableId ? await getMpCredentials(responsableId) : null;
      const trusted = ownerToken ?? process.env.MP_ACCESS_TOKEN ?? null;
      if (!trusted) return null;
      try {
        const verificado = await obtenerPagoMp(trusted, paymentId);
        // El external_reference debe coincidir con el que motivó la búsqueda.
        if ((verificado.external_reference ?? "") !== ref) return null;
        return verificado;
      } catch {
        return null;
      }
    };

    // Check if this is an abono payment "abono-{id}"
    const abonoMatch = ref.match(/^abono-(\d+)$/);
    if (abonoMatch) {
      const abonoId = parseInt(abonoMatch[1], 10);
      const [abono] = await db.select().from(pagosParciales).where(eq(pagosParciales.id, abonoId));
      if (!abono) {
        await logEvento({ evento: "mp.webhook.ignorado", cobroId: null, ipOrigen: ip, exitoso: true, detalle: `Abono #${abonoId} no encontrado` });
        res.status(200).json({ ok: true });
        return;
      }
      const [cobroPadre] = await db
        .select({ responsableId: cobrosTable.responsableId })
        .from(cobrosTable)
        .where(eq(cobrosTable.id, abono.cobroId));
      const pagoVerificado = await verificarConTokenPropietario(cobroPadre?.responsableId ?? null);
      if (!pagoVerificado) {
        await logEvento({ evento: "mp.webhook.error", cobroId: abono.cobroId, ipOrigen: ip, exitoso: false, detalle: `Abono #${abonoId}: no se pudo verificar el pago ${paymentId} con el token del propietario` });
        res.status(200).json({ ok: false, error: "Verificación de propietario fallida" });
        return;
      }
      payment = pagoVerificado;
      if (payment.status === "approved") {
        await db.update(pagosParciales).set({ estado: "confirmado", mpPaymentId: String(paymentId), confirmadoEn: new Date() }).where(eq(pagosParciales.id, abonoId));
        const nuevoEstadoCobro = await recalcularCobroDesdeAbonos(abono.cobroId);
        await logEvento({ evento: "mp.abono.confirmado", cobroId: abono.cobroId, ipOrigen: ip, exitoso: true, detalle: `Abono #${abonoId} confirmado, cobro ahora ${nuevoEstadoCobro}` });
        emitirComprobanteSiPagado(nuevoEstadoCobro, abono.cobroId, "mp", String(paymentId), req.log);
      } else if (["rejected", "cancelled", "refunded"].includes(payment.status)) {
        await db.update(pagosParciales).set({ estado: "fallido", mpPaymentId: String(paymentId) }).where(eq(pagosParciales.id, abonoId));
        await logEvento({ evento: "mp.abono.fallido", cobroId: abono.cobroId, ipOrigen: ip, exitoso: true, detalle: `Abono #${abonoId} fallido (${payment.status})` });
      }
      res.status(200).json({ ok: true });
      return;
    }

    // Parse cobro ID from external_reference "cobro-{id}"
    const match = ref.match(/^cobro-(\d+)$/);
    if (!match) {
      await logEvento({ evento: "mp.webhook.ignorado", cobroId: null, ipOrigen: ip, exitoso: true, detalle: `external_reference desconocida: ${ref}` });
      res.status(200).json({ ok: true });
      return;
    }

    const cobroId = parseInt(match[1], 10);
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));

    if (!cobro) {
      await logEvento({ evento: "mp.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Cobro #${cobroId} no encontrado` });
      res.status(200).json({ ok: false, error: "Cobro no encontrado" });
      return;
    }

    const pagoVerificado = await verificarConTokenPropietario(cobro.responsableId ?? null);
    if (!pagoVerificado) {
      await logEvento({ evento: "mp.webhook.error", cobroId: cobro.id, ipOrigen: ip, exitoso: false, detalle: `No se pudo verificar el pago ${paymentId} con el token del propietario del cobro` });
      res.status(200).json({ ok: false, error: "Verificación de propietario fallida" });
      return;
    }
    payment = pagoVerificado;

    const nuevoEstado = estadoMap[payment.status];
    if (!nuevoEstado || nuevoEstado === "pendiente") {
      await logEvento({ evento: `mp.pago.${payment.status}`, cobroId: cobro.id, ipOrigen: ip, exitoso: true, detalle: `MP status ${payment.status} — sin cambio de estado` });
      res.status(200).json({ ok: true });
      return;
    }

    // El estado real del dinero siempre tiene prioridad: una confirmación de pago
    // (approved) gana sobre cualquier estado manual previo, y un rechazo/cancelación
    // no degrada un cobro ya pagado/parcial — salvo un reembolso real (refunded).
    // La protección es atómica en SQL para soportar webhooks concurrentes.
    const esReembolso = payment.status === "refunded";
    const aplicado = await aplicarEstadoCobro(cobro.id, nuevoEstado, { esReembolso });

    if (!aplicado) {
      await logEvento({
        evento: "mp.pago.ignorado",
        cobroId: cobro.id,
        ipOrigen: ip,
        exitoso: true,
        detalle: `MP payment ${paymentId} status=${payment.status} → ${nuevoEstado} ignorado: el cobro ya refleja un pago confirmado (pagado/parcial tiene prioridad)`,
      });
      req.log.info({ cobroId: cobro.id, propuesto: nuevoEstado }, "MercadoPago webhook: estado ignorado para proteger pago confirmado");
      res.status(200).json({ ok: true });
      return;
    }

    await logEvento({
      evento: `mp.pago.${nuevoEstado}`,
      cobroId: cobro.id,
      ipOrigen: ip,
      exitoso: true,
      detalle: `MP payment ${paymentId} status=${payment.status} → ${nuevoEstado}`,
    });

    req.log.info({ cobroId: cobro.id, nuevoEstado, paymentId }, "Cobro updated via MercadoPago webhook");
    emitirComprobanteSiPagado(nuevoEstado, cobro.id, "mp", String(paymentId), req.log);
    res.status(200).json({ ok: true });
  } catch (err) {
    req.log.error({ err, paymentId }, "Error processing MercadoPago webhook");
    await logEvento({ evento: "mp.webhook.error", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Error interno: ${String(err)}` });
    res.status(200).json({ ok: false, error: "Error interno" });
  }
});

webhooksRouter.post("/webhooks/cobro", async (req, res) => {
  const secret = process.env.WEBHOOK_SECRET;
  const signatureHeader = req.headers["x-webhook-signature"];
  const ip = getClientIp(req as Parameters<typeof getClientIp>[0]);

  if (secret) {
    if (!signatureHeader || typeof signatureHeader !== "string") {
      await logEvento({ evento: "desconocido", cobroId: null, ipOrigen: ip, exitoso: false, detalle: "Falta header X-Webhook-Signature" });
      req.log.warn("Webhook rejected: missing X-Webhook-Signature header");
      res.status(401).json({ error: "Falta la firma del webhook (X-Webhook-Signature)" });
      return;
    }

    if (!req.rawBody) {
      req.log.error("rawBody not available for signature verification");
      res.status(500).json({ error: "Error interno del servidor" });
      return;
    }

    if (!verifySignature(req.rawBody, signatureHeader, secret)) {
      await logEvento({ evento: "desconocido", cobroId: null, ipOrigen: ip, exitoso: false, detalle: "Firma HMAC inválida" });
      req.log.warn({ signatureHeader }, "Webhook rejected: invalid signature");
      res.status(401).json({ error: "Firma inválida" });
      return;
    }
  }

  const parsed = ReceiveCobroWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    await logEvento({ evento: "desconocido", cobroId: null, ipOrigen: ip, exitoso: false, detalle: `Payload inválido: ${parsed.error.message}` });
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { evento, cobroId, referencia } = parsed.data;

  req.log.info({ evento, cobroId }, "Webhook received and verified");

  const nuevoEstado = EVENTO_A_ESTADO[evento];

  if (!nuevoEstado) {
    await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: true, detalle: `Evento no mapeado a estado: ${evento}` });
    res.json({ recibido: true, cobroActualizado: false });
    return;
  }

  try {
    const [existente] = await db.select({ id: cobrosTable.id }).from(cobrosTable).where(eq(cobrosTable.id, cobroId));

    if (!existente) {
      await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: false, detalle: `Cobro #${cobroId} no encontrado` });
      res.status(400).json({ error: "Cobro no encontrado" });
      return;
    }

    // El estado real del dinero siempre tiene prioridad: no degradamos un cobro
    // ya pagado/parcial por un evento de fallo/cancelación/pendiente posterior
    // (protección atómica en SQL frente a webhooks concurrentes).
    const aplicado = await aplicarEstadoCobro(cobroId, nuevoEstado, {
      extra: referencia ? { referencia } : undefined,
    });

    if (!aplicado) {
      await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: true, detalle: `Evento ${evento} → ${nuevoEstado} ignorado: el cobro ya refleja un pago confirmado (pagado/parcial tiene prioridad)` });
      req.log.info({ cobroId, propuesto: nuevoEstado }, "Webhook: estado ignorado para proteger pago confirmado");
      res.json({ recibido: true, cobroActualizado: false });
      return;
    }

    await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: true, detalle: `Estado actualizado a: ${nuevoEstado}` });
    req.log.info({ cobroId, nuevoEstado }, "Cobro updated via webhook");
    emitirComprobanteSiPagado(nuevoEstado, cobroId, "manual", referencia ?? null, req.log);
    res.json({ recibido: true, cobroActualizado: true });
  } catch (err) {
    await logEvento({ evento, cobroId, ipOrigen: ip, exitoso: false, detalle: `Error interno: ${String(err)}` });
    req.log.error({ err }, "Error processing webhook");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

webhooksRouter.get("/webhooks/eventos", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const resultado = req.query.resultado as "exitoso" | "fallido" | undefined;
  const evento = req.query.evento as string | undefined;

  try {
    const conditions = [];
    if (resultado === "exitoso") conditions.push(eq(webhookEventosTable.exitoso, true));
    else if (resultado === "fallido") conditions.push(eq(webhookEventosTable.exitoso, false));
    if (evento) conditions.push(eq(webhookEventosTable.evento, evento));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [eventosRows, countRows, eventosUnicosRows] = await Promise.all([
      db
        .select()
        .from(webhookEventosTable)
        .where(where)
        .orderBy(desc(webhookEventosTable.creadoEn))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(webhookEventosTable)
        .where(where),
      db
        .selectDistinct({ evento: webhookEventosTable.evento })
        .from(webhookEventosTable)
        .orderBy(webhookEventosTable.evento),
    ]);

    res.json({
      items: eventosRows.map((e) => ({
        ...e,
        creadoEn: e.creadoEn.toISOString(),
      })),
      total: countRows[0]?.count ?? 0,
      limit,
      offset,
      eventosUnicos: eventosUnicosRows.map((r) => r.evento),
    });
  } catch (err) {
    req.log.error({ err }, "Error listing webhook eventos");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

webhooksRouter.get("/webhooks/eventos/export", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription, async (req, res) => {
  const resultado = req.query.resultado as "exitoso" | "fallido" | undefined;
  const evento = req.query.evento as string | undefined;

  try {
    const conditions = [];
    if (resultado === "exitoso") conditions.push(eq(webhookEventosTable.exitoso, true));
    else if (resultado === "fallido") conditions.push(eq(webhookEventosTable.exitoso, false));
    if (evento) conditions.push(eq(webhookEventosTable.evento, evento));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(webhookEventosTable)
      .where(where)
      .orderBy(desc(webhookEventosTable.creadoEn));

    const escape = (v: string | number | boolean | null | undefined): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = ["id", "evento", "cobro_id", "ip_origen", "resultado", "exitoso", "detalle", "creado_en"].join(",");
    const lines = rows.map((r) =>
      [
        escape(r.id),
        escape(r.evento),
        escape(r.cobroId),
        escape(r.ipOrigen),
        escape(r.resultado),
        escape(r.exitoso),
        escape(r.detalle),
        escape(r.creadoEn.toISOString()),
      ].join(","),
    );

    const csv = [header, ...lines].join("\n");
    const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `webhook-eventos-${now}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + csv); // UTF-8 BOM for Excel compatibility
  } catch (err) {
    req.log.error({ err }, "Error exporting webhook eventos");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Flow calls this URL (the plan's urlCallback) on each recurring charge of a
// platform subscription. We re-fetch the authoritative subscription state from
// Flow and update the user's subscription_status accordingly. Security: we
// trust only Flow's API response, never the raw posted body.
webhooksRouter.post("/webhooks/flow-subscription", async (req, res) => {
  const ip = getClientIp(req as Parameters<typeof getClientIp>[0]);

  const subscriptionId = (req.body?.subscriptionId ??
    req.query?.subscriptionId) as string | undefined;

  req.log.info(
    { subscriptionId, body: req.body, query: req.query },
    "Flow subscription webhook received",
  );

  // Always answer 200 so Flow does not keep retrying for unrecoverable cases.
  if (!subscriptionId || typeof subscriptionId !== "string") {
    await logEvento({
      evento: "suscripcion.webhook",
      exitoso: false,
      ipOrigen: ip,
      detalle: "Webhook sin subscriptionId",
    });
    res.json({ ok: true });
    return;
  }

  if (!flowAdminConfigured()) {
    req.log.error("Flow admin creds not configured; cannot process subscription webhook");
    res.json({ ok: true });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.flowSubscriptionId, subscriptionId));

    if (!user) {
      await logEvento({
        evento: "suscripcion.webhook",
        exitoso: false,
        ipOrigen: ip,
        detalle: `Sin usuario para subscriptionId ${subscriptionId}`,
      });
      res.json({ ok: true });
      return;
    }

    const creds = getFlowAdminCreds();
    const sub = await getSubscription(creds, subscriptionId);
    const mapped = mapSubscription(sub);

    await db
      .update(usersTable)
      .set({
        subscriptionStatus: mapped.status,
        subscriptionPeriodEnd: mapped.periodEnd,
      })
      .where(eq(usersTable.id, user.id));

    await logEvento({
      evento: mapped.status === "activa" ? "suscripcion.activa" : "suscripcion.vencida",
      exitoso: true,
      ipOrigen: ip,
      detalle: `Usuario ${user.id} → ${mapped.status}`,
    });

    // Libro de ingresos: registra el cargo de suscripción (una fila por
    // usuario+período; idempotente frente a reintentos del webhook).
    if (mapped.status === "activa" && mapped.periodEnd) {
      try {
        let miembrosActivos = 1;
        if (user.organizationId != null) {
          const [cnt] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(usersTable)
            .where(
              and(
                eq(usersTable.organizationId, user.organizationId),
                eq(usersTable.activo, true),
              ),
            );
          miembrosActivos = cnt?.count ?? 1;
        }
        const pricing = computePricing(miembrosActivos, user.plan ?? "nextcob");
        const neto =
          pricing.planBaseNeto +
          pricing.usuariosAdicionales * pricing.costoUsuarioAdicionalNeto;
        const iva =
          pricing.planBaseIva +
          pricing.usuariosAdicionales * pricing.costoUsuarioAdicionalIva;
        // Idempotente frente a reintentos/concurrencia: la unicidad
        // (user_id, periodo_hasta) vive en la BD; un conflicto es éxito.
        await db
          .insert(pagosSuscripcionTable)
          .values({
            userId: user.id,
            fecha: new Date(),
            usuariosAdicionales: pricing.usuariosAdicionales,
            montoNeto: neto,
            montoIva: iva,
            montoTotal: neto + iva,
            estado: "pagado",
            metodo: "flow",
            periodoHasta: mapped.periodEnd,
          })
          .onConflictDoNothing({
            target: [pagosSuscripcionTable.userId, pagosSuscripcionTable.periodoHasta],
          });
      } catch (err) {
        req.log.error({ err }, "No se pudo registrar el pago de suscripción");
      }
    }

    req.log.info({ userId: user.id, status: mapped.status }, "Subscription status updated via webhook");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error processing subscription webhook");
    await logEvento({
      evento: "suscripcion.webhook",
      exitoso: false,
      ipOrigen: ip,
      detalle: err instanceof Error ? err.message : "Error desconocido",
    });
    res.json({ ok: true });
  }
});

// ── Reveniu (suscripción de la plataforma) ───────────────────────────────────
// Reveniu autentica sus webhooks reenviando el secret en el header
// Reveniu-Secret-Key. Payload: { event, data: { subscription_id,
// subscription_external_id, ... } }. external_id = users.id (lo enviamos al
// crear la suscripción). Siempre respondemos 200 para casos irrecuperables,
// pero 401 si el header no coincide (origen no confiable).
webhooksRouter.post("/webhooks/reveniu", async (req, res) => {
  const ip = getClientIp(req as Parameters<typeof getClientIp>[0]);
  const secret = reveniuWebhookSecret();
  const header = req.headers["reveniu-secret-key"];
  const provided = Array.isArray(header) ? header[0] : header;

  if (!secret || !provided || !safeEquals(provided, secret)) {
    await logEvento({
      evento: "reveniu.webhook",
      exitoso: false,
      ipOrigen: ip,
      detalle: "Header Reveniu-Secret-Key inválido o ausente",
    });
    res.status(401).json({ error: "No autorizado" });
    return;
  }

  const event = String(req.body?.event ?? req.body?.type ?? "");
  const data = (req.body?.data ?? req.body ?? {}) as Record<string, unknown>;
  const subscriptionId = Number(data.subscription_id ?? data.id ?? NaN);
  const externalId =
    typeof data.subscription_external_id === "string" && data.subscription_external_id
      ? data.subscription_external_id
      : typeof data.external_id === "string" && data.external_id
        ? data.external_id
        : null;

  req.log.info({ event, subscriptionId, externalId }, "Reveniu webhook received");

  try {
    // Localiza al usuario: por external_id (users.id), por suscripción activa o
    // por la suscripción pendiente creada en el checkout.
    let user = null as typeof usersTable.$inferSelect | null;
    if (externalId) {
      const [byExternal] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, externalId));
      user = byExternal ?? null;
    }
    if (!user && Number.isFinite(subscriptionId)) {
      const [bySub] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.reveniuSubscriptionId, subscriptionId));
      user = bySub ?? null;
      if (!user) {
        const [byPending] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.reveniuPendingSubscriptionId, subscriptionId));
        user = byPending ?? null;
      }
    }

    if (!user) {
      await logEvento({
        evento: "reveniu.webhook",
        exitoso: false,
        ipOrigen: ip,
        detalle: `Sin usuario para evento ${event} (sub ${subscriptionId})`,
      });
      res.json({ ok: true });
      return;
    }

    // Anti-spoofing: si el evento trae un subscription_id que no corresponde al
    // usuario resuelto por external_id, lo ignoramos.
    if (
      Number.isFinite(subscriptionId) &&
      user.reveniuSubscriptionId != null &&
      user.reveniuSubscriptionId !== subscriptionId &&
      user.reveniuPendingSubscriptionId !== subscriptionId
    ) {
      await logEvento({
        evento: "reveniu.webhook",
        exitoso: false,
        ipOrigen: ip,
        detalle: `subscription_id ${subscriptionId} no coincide con el usuario ${user.id}`,
      });
      res.json({ ok: true });
      return;
    }

    const ahora = new Date();
    // Fin de período autoritativo: next_due desde la API de Reveniu. Es estable
    // frente a reintentos del webhook, así el UNIQUE (user_id, periodo_hasta)
    // del libro de ingresos deduplica de verdad y el período nunca se
    // sobre-extiende por replays.
    const resolvedSubId = Number.isFinite(subscriptionId)
      ? subscriptionId
      : (user.reveniuSubscriptionId ?? user.reveniuPendingSubscriptionId);
    async function fetchNextDue(): Promise<Date | null> {
      if (!reveniuConfigured() || resolvedSubId == null) return null;
      try {
        const detail = await getReveniuSubscription(resolvedSubId);
        return detail.nextDue;
      } catch (err) {
        req.log.error({ err, subscriptionId: resolvedSubId }, "No se pudo consultar la suscripción en Reveniu");
        return null;
      }
    }

    switch (event) {
      case "subscription_activated": {
        // Tarjeta registrada y suscripción activa en Reveniu. Promueve la
        // suscripción pendiente y activa el acceso. El período viene del
        // next_due autoritativo; si no está disponible, solo se activa el
        // acceso y subscription_payment_succeeded fijará el período.
        const nextDue = await fetchNextDue();
        await db
          .update(usersTable)
          .set({
            reveniuSubscriptionId: resolvedSubId,
            reveniuPendingSubscriptionId: null,
            // Una suscripción cancelada no se reactiva por eventos rezagados.
            subscriptionStatus: sql`case when ${usersTable.subscriptionStatus} = 'cancelada' then ${usersTable.subscriptionStatus} else 'activa'::subscription_status end`,
            ...(nextDue
              ? {
                  subscriptionPeriodEnd: sql`greatest(coalesce(${usersTable.subscriptionPeriodEnd}, ${nextDue}), ${nextDue})`,
                }
              : {}),
            avisoPagoFallidoEn: null,
          })
          .where(eq(usersTable.id, user.id));
        await logEvento({
          evento: "reveniu.suscripcion.activada",
          exitoso: true,
          ipOrigen: ip,
          detalle: `Usuario ${user.id} → activa (sub ${resolvedSubId})`,
        });
        break;
      }

      case "subscription_payment_succeeded": {
        // Cobro mensual exitoso. El período se extiende hasta el next_due
        // autoritativo (nunca se acorta: greatest en SQL). Una suscripción
        // cancelada NO vuelve a 'activa' (puede ser el último cargo del
        // período), pero su período sí se registra/extiende. trial_ends_at se
        // empuja también para que lógica legada de trial no interfiera.
        const nextDue = await fetchNextDue();
        await db
          .update(usersTable)
          .set({
            reveniuSubscriptionId: resolvedSubId,
            reveniuPendingSubscriptionId: null,
            subscriptionStatus: sql`case when ${usersTable.subscriptionStatus} = 'cancelada' then ${usersTable.subscriptionStatus} else 'activa'::subscription_status end`,
            ...(nextDue
              ? {
                  subscriptionPeriodEnd: sql`greatest(coalesce(${usersTable.subscriptionPeriodEnd}, ${nextDue}), ${nextDue})`,
                  trialEndsAt: sql`greatest(${usersTable.trialEndsAt}, ${nextDue})`,
                }
              : {}),
            avisoPagoFallidoEn: null,
          })
          .where(eq(usersTable.id, user.id));

        // Libro de ingresos: una fila por usuario+período. periodoHasta =
        // next_due (estable), así los reintentos del webhook chocan con el
        // UNIQUE y no duplican ingresos. Sin next_due no se registra (mejor
        // omitir que duplicar; el superadmin puede conciliar con Reveniu).
        if (nextDue) {
          try {
            let miembrosActivos = 1;
            if (user.organizationId != null) {
              const [cnt] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(usersTable)
                .where(
                  and(
                    eq(usersTable.organizationId, user.organizationId),
                    eq(usersTable.activo, true),
                  ),
                );
              miembrosActivos = cnt?.count ?? 1;
            }
            const pricing = computePricing(miembrosActivos, user.plan ?? "nextcob");
            const neto =
              pricing.planBaseNeto +
              pricing.usuariosAdicionales * pricing.costoUsuarioAdicionalNeto;
            const iva =
              pricing.planBaseIva +
              pricing.usuariosAdicionales * pricing.costoUsuarioAdicionalIva;
            await db
              .insert(pagosSuscripcionTable)
              .values({
                userId: user.id,
                fecha: ahora,
                usuariosAdicionales: pricing.usuariosAdicionales,
                montoNeto: neto,
                montoIva: iva,
                montoTotal: neto + iva,
                estado: "pagado",
                metodo: "reveniu",
                periodoHasta: nextDue,
              })
              .onConflictDoNothing({
                target: [pagosSuscripcionTable.userId, pagosSuscripcionTable.periodoHasta],
              });
          } catch (err) {
            req.log.error({ err }, "No se pudo registrar el pago de suscripción Reveniu");
          }
        } else {
          req.log.warn(
            { userId: user.id, subscriptionId: resolvedSubId },
            "Pago Reveniu sin next_due: no se registró en el libro de ingresos",
          );
        }

        await logEvento({
          evento: "reveniu.pago.exitoso",
          exitoso: true,
          ipOrigen: ip,
          detalle: `Usuario ${user.id}: pago mensual OK${nextDue ? `, período hasta ${nextDue.toISOString()}` : " (sin next_due)"}`,
        });
        break;
      }

      case "subscription_renewal_cancelled": {
        // Cancelación de la renovación (por el cliente o el comercio): conserva
        // el acceso hasta el fin del período pagado; no degrada 'vencida'.
        await db
          .update(usersTable)
          .set({ subscriptionStatus: "cancelada" })
          .where(
            and(eq(usersTable.id, user.id), eq(usersTable.subscriptionStatus, "activa")),
          );
        await logEvento({
          evento: "reveniu.suscripcion.cancelada",
          exitoso: true,
          ipOrigen: ip,
          detalle: `Usuario ${user.id} → cancelada (${String(data.cancel_reason ?? "")})`,
        });
        break;
      }

      case "subscription_deactivated": {
        // Baja definitiva en Reveniu (p. ej. tras agotar reintentos de cobro):
        // suspende el acceso salvo que el período pagado siga vigente. La
        // decisión se toma en SQL sobre el estado actual de la fila (no sobre
        // una lectura potencialmente obsoleta) para no pisar un webhook de
        // pago concurrente.
        const [updated] = await db
          .update(usersTable)
          .set({
            subscriptionStatus: sql`case when ${usersTable.subscriptionPeriodEnd} is not null and ${usersTable.subscriptionPeriodEnd} > now() then 'cancelada'::subscription_status else 'vencida'::subscription_status end`,
          })
          .where(eq(usersTable.id, user.id))
          .returning({ subscriptionStatus: usersTable.subscriptionStatus });
        await logEvento({
          evento: "reveniu.suscripcion.desactivada",
          exitoso: true,
          ipOrigen: ip,
          detalle: `Usuario ${user.id} → ${updated?.subscriptionStatus ?? "?"}`,
        });
        break;
      }

      default: {
        req.log.info({ event }, "Reveniu webhook: evento no manejado");
        break;
      }
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error processing Reveniu webhook");
    await logEvento({
      evento: "reveniu.webhook",
      exitoso: false,
      ipOrigen: ip,
      detalle: err instanceof Error ? err.message : "Error desconocido",
    });
    res.json({ ok: true });
  }
});

export default webhooksRouter;
