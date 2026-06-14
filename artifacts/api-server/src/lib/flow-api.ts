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

export interface FlowStatusResult {
  flowOrder: number;
  commerceOrder: string;
  requestDate: string;
  status: number; // 1=pending, 2=paid, 3=rejected, 4=cancelled
  subject: string;
  currency: string;
  amount: number;
  payer: string;
  paymentData?: { date: string; media: string; conversionDate: string; conversionRate: number; amount: number; currency: string; fee: number; balance: number; transferDate: string };
}

function buildSignature(params: Record<string, string | number>, secretKey: string): string {
  const sorted = Object.keys(params).sort();
  const toSign = sorted.map((k) => `${k}${params[k]}`).join("");
  return createHmac("sha256", secretKey).update(toSign).digest("hex");
}

function buildSignedBody(params: Record<string, string | number>, secretKey: string): string {
  const s = buildSignature(params, secretKey);
  const searchParams = new URLSearchParams();
  const sorted = Object.keys(params).sort();
  for (const k of sorted) {
    searchParams.set(k, String(params[k]));
  }
  searchParams.set("s", s);
  return searchParams.toString();
}

function buildSignedQuery(params: Record<string, string | number>, secretKey: string): string {
  const s = buildSignature(params, secretKey);
  const searchParams = new URLSearchParams();
  const sorted = Object.keys(params).sort();
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

  const body = buildSignedBody(payload, secretKey);

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
): Promise<FlowStatusResult> {
  const params: Record<string, string | number> = { apiKey, token };
  const qs = buildSignedQuery(params, secretKey);

  const res = await fetch(`${FLOW_API_URL}/payment/getStatus?${qs}`, {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Flow getStatus error ${res.status}: ${text}`);
  }

  return res.json() as Promise<FlowStatusResult>;
}

export function getPublicBaseUrl(): string {
  // APP_PUBLIC_URL is set in production env vars to the deployed domain
  if (process.env.APP_PUBLIC_URL) {
    return process.env.APP_PUBLIC_URL.replace(/\/$/, "");
  }
  // Fallback: use REPLIT_DOMAINS (first entry)
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}
