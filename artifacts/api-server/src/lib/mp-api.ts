// Base URL is resolved at call time so tests can point it at a local stub
// (MP_API_BASE_URL). Production/dev never set it, so the real API is used.
function mpApiUrl(): string {
  return process.env.MP_API_BASE_URL ?? "https://api.mercadopago.com";
}

export interface MpPreferenciaParams {
  title: string;
  quantity: number;
  unitPrice: number;
  externalReference: string;
  notificationUrl: string;
  backUrl: string;
}

export interface MpPreferenciaResult {
  preferenceId: string;
  initPoint: string;
}

export interface MpPaymentStatus {
  id: number;
  status: string;
  status_detail: string;
  external_reference: string;
  transaction_amount: number;
}

export async function crearPreferenciaMp(
  accessToken: string,
  params: MpPreferenciaParams,
): Promise<MpPreferenciaResult> {
  const body = {
    items: [
      {
        title: params.title.slice(0, 256),
        quantity: params.quantity,
        unit_price: params.unitPrice,
        currency_id: "CLP",
      },
    ],
    external_reference: params.externalReference,
    notification_url: params.notificationUrl,
    back_urls: {
      success: params.backUrl,
      failure: params.backUrl,
      pending: params.backUrl,
    },
    auto_return: "approved" as const,
  };

  const res = await fetch(`${mpApiUrl()}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MercadoPago preferences error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { id: string; init_point: string };
  return { preferenceId: data.id, initPoint: data.init_point };
}

export async function obtenerPagoMp(
  accessToken: string,
  paymentId: string,
): Promise<MpPaymentStatus> {
  const res = await fetch(`${mpApiUrl()}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MercadoPago payment status error ${res.status}: ${text}`);
  }

  return res.json() as Promise<MpPaymentStatus>;
}
