import { db, cobrosTable, clientesTable, type Cobro } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getFlowCredentials, getMpCredentials } from "../routes/profile";
import { crearOrdenFlow, getPublicBaseUrl } from "./flow-api";
import { crearPreferenciaMp } from "./mp-api";

type Log = { warn: (obj: object, msg: string) => void };

export type CobroConLink = {
  cobro: Cobro;
  linkPago: string | null;
  // A portal is a real, safe payment destination even where the business has
  // not configured a processor. It is deliberately a fallback, not stored as a
  // processor link (a portal covers the customer's outstanding charges).
  portalUrl: string | null;
};

export async function portalUrlExistenteParaCobro(
  clienteId: number | null,
  cobroId: number,
): Promise<string | null> {
  if (!clienteId) return null;
  const [cliente] = await db.select({
    id: clientesTable.id,
    portalToken: clientesTable.portalToken,
  }).from(clientesTable).where(eq(clientesTable.id, clienteId));
  if (!cliente) return null;
  if (!cliente.portalToken) return null;
  return `${getPublicBaseUrl()}/portal/${cliente.portalToken}?cobro=${cobroId}`;
}

async function portalUrlParaCliente(clienteId: number | null, cobroId: number): Promise<string | null> {
  if (!clienteId) return null;
  const [cliente] = await db.select({
    id: clientesTable.id,
    portalToken: clientesTable.portalToken,
  }).from(clientesTable).where(eq(clientesTable.id, clienteId));
  if (!cliente) return null;
  let token = cliente.portalToken;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    // A competing delivery may have provisioned it meanwhile. In that case
    // read the canonical token rather than returning a dead, overwritten URL.
    const updated = await db.update(clientesTable)
      .set({ portalToken: token, portalTokenGeneradoEn: new Date(), actualizadoEn: new Date() })
      .where(and(eq(clientesTable.id, cliente.id), isNull(clientesTable.portalToken)))
      .returning({ portalToken: clientesTable.portalToken });
    if (updated[0]?.portalToken) token = updated[0].portalToken;
    else {
      const [current] = await db.select({ portalToken: clientesTable.portalToken })
        .from(clientesTable).where(eq(clientesTable.id, cliente.id));
      token = current?.portalToken ?? null;
      if (!token) return null;
    }
  }
  return `${getPublicBaseUrl()}/portal/${token}?cobro=${cobroId}`;
}

/**
 * Provision the same provider-backed, per-cobro link used by the normal link
 * endpoints. Provider failure is intentionally non-fatal: callers have
 * already committed their charge and can send the authenticated debtor portal
 * fallback instead.
 */
export async function asegurarLinkPagoCobro(
  cobro: Cobro,
  log: Log,
): Promise<CobroConLink> {
  // The existing Flow/MP integrations are CLP-only. Never silently convert.
  if (cobro.moneda !== "CLP" || cobro.decimales !== 0) {
    return { cobro, linkPago: null, portalUrl: null };
  }
  const existing = cobro.flowLinkPago ?? cobro.mpPaymentLinkUrl;
  if (existing) return { cobro, linkPago: existing, portalUrl: null };
  const baseUrl = getPublicBaseUrl();
  const amount = Math.round(Number(cobro.monto) - Number(cobro.montoDescuento ?? 0));

  if (cobro.emailPagador) {
    try {
      const flow = await getFlowCredentials(cobro.responsableId ?? "");
      if (flow) {
        const result = await crearOrdenFlow(flow.apiKey, flow.secretKey, {
          commerceOrder: `cobro-${cobro.id}`,
          subject: cobro.descripcion.slice(0, 200),
          currency: "CLP",
          amount,
          email: cobro.emailPagador,
          urlConfirmation: `${baseUrl}/api/webhooks/flow`,
          urlReturn: `${baseUrl}/cobros/${cobro.id}`,
        });
        const [updated] = await db.update(cobrosTable).set({
          flowOrdenId: String(result.flowOrder), flowToken: result.token,
          flowLinkPago: result.url, actualizadoEn: new Date(),
        }).where(eq(cobrosTable.id, cobro.id)).returning();
        if (updated) return { cobro: updated, linkPago: updated.flowLinkPago, portalUrl: null };
      }
    } catch (err) {
      log.warn({ err, cobroId: cobro.id }, "No se pudo crear link Flow para cobro avanzado");
    }
  }

  try {
    const accessToken = await getMpCredentials(cobro.responsableId ?? "");
    if (accessToken) {
      const result = await crearPreferenciaMp(accessToken, {
        title: cobro.descripcion.slice(0, 256), quantity: 1, unitPrice: amount,
        externalReference: `cobro-${cobro.id}`,
        notificationUrl: `${baseUrl}/api/webhooks/mercadopago`,
        backUrl: `${baseUrl}/cobros/${cobro.id}`,
      });
      const [updated] = await db.update(cobrosTable).set({
        mpPreferenceId: result.preferenceId, mpPaymentLinkUrl: result.initPoint,
        actualizadoEn: new Date(),
      }).where(eq(cobrosTable.id, cobro.id)).returning();
      if (updated) return { cobro: updated, linkPago: updated.mpPaymentLinkUrl, portalUrl: null };
    }
  } catch (err) {
    log.warn({ err, cobroId: cobro.id }, "No se pudo crear link Mercado Pago para cobro avanzado");
  }
  return { cobro, linkPago: null, portalUrl: await portalUrlParaCliente(cobro.clienteId, cobro.id) };
}