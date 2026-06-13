import { createHmac } from "crypto";

const FLOW_API_URL = "https://www.flow.cl/api";

export interface FlowOrdenParams {
  commerceOrder: string;
  subject: string;
  currency: string;
  amount: number;
  email: string;
  urlConfirmation: string;
  urlReturn: string;
}

export interface FlowOrdenResult {
  url: string;
  token: string;
  flowOrder: number;
}

function buildSignedParams(params: Record<string, string | number>, secretKey: string): string {
  const sorted = Object.keys(params).sort();
  const toSign = sorted.map((k) => `${k}${params[k]}`).join("");
  const s = createHmac("sha256", secretKey).update(toSign).digest("hex");
  const searchParams = new URLSearchParams();
  for (const k of sorted) {
    searchParams.set(k, String(params[k]));
  }
  searchParams.set("s", s);
  return searchParams.toString();
}

export async function crearOrdenFlow(
  apiKey: string,
  secretKey: string,
  params: FlowOrdenParams
): Promise<FlowOrdenResult> {
  const payload: Record<string, string | number> = {
    apiKey,
    commerceOrder: params.commerceOrder,
    subject: params.subject,
    currency: params.currency,
    amount: params.amount,
    email: params.email,
    urlConfirmation: params.urlConfirmation,
    urlReturn: params.urlReturn,
    paymentMethod: 9,
  };

  const body = buildSignedParams(payload, secretKey);

  const res = await fetch(`${FLOW_API_URL}/payment/create`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Flow API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { url: string; token: string; flowOrder: number };
  return {
    url: `${data.url}?token=${data.token}`,
    token: data.token,
    flowOrder: data.flowOrder,
  };
}

export async function verificarPagoFlow(
  apiKey: string,
  secretKey: string,
  token: string
): Promise<{ status: number; commerceOrder: string; flowOrder: number }> {
  const params: Record<string, string | number> = { apiKey, token };
  const body = buildSignedParams(params, secretKey);

  const res = await fetch(`${FLOW_API_URL}/payment/getStatus`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Flow API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<{ status: number; commerceOrder: string; flowOrder: number }>;
}
