import { buildSignedBody, buildSignedQuery, getPublicBaseUrl } from "./flow-api";

const FLOW_API_URL = "https://www.flow.cl/api";

// Platform plan: monthly recurring charge to the platform's own Flow account.
// NOTE: Flow does not let `ensurePlan` change the price of an EXISTING planId
// (it swallows the "already exists" error). To roll out a new price you MUST bump
// this id so a fresh plan is created at the new PLAN_AMOUNT. The "_iva19" suffix
// corresponds to the IVA-inclusive price (neto + IVA). Existing subscribers stay
// on their original plan until they re-subscribe.
export const PLAN_ID = "cobrosimple_mensual_2499_iva19";
export const PLAN_NAME = "Cobro Simple - Plan Mensual";
// Pricing is IVA-inclusive (Chilean VAT 19%): the customer is charged PLAN_AMOUNT
// (neto + IVA). PLAN_NETO/PLAN_IVA are exposed so the UI can show a transparent
// breakdown ("Neto $24.990 + IVA $4.748 = Total $29.738").
export const IVA_RATE = 0.19;
export const PLAN_NETO = 24990; // CLP, neto (sin IVA)
export const PLAN_IVA = Math.round(PLAN_NETO * IVA_RATE); // CLP, 4748
export const PLAN_AMOUNT = PLAN_NETO + PLAN_IVA; // CLP, 29738 (total cobrado, IVA incl.)
export const PLAN_CURRENCY = "CLP";
// Flow plan interval: 1=Diario, 2=Semanal, 3=Mensual, 4=Anual
const PLAN_INTERVAL_MONTHLY = 3;

export interface FlowAdminCreds {
  apiKey: string;
  secretKey: string;
}

export function getFlowAdminCreds(): FlowAdminCreds {
  const apiKey = process.env.FLOW_ADMIN_API_KEY;
  const secretKey = process.env.FLOW_ADMIN_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error(
      "Credenciales de Flow del administrador no configuradas (FLOW_ADMIN_API_KEY / FLOW_ADMIN_SECRET_KEY)",
    );
  }
  return { apiKey, secretKey };
}

export function flowAdminConfigured(): boolean {
  return Boolean(process.env.FLOW_ADMIN_API_KEY && process.env.FLOW_ADMIN_SECRET_KEY);
}

async function flowPost<T>(path: string, params: Record<string, string | number>, secretKey: string): Promise<T> {
  const body = buildSignedBody(params, secretKey);
  const res = await fetch(`${FLOW_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Flow ${path} error ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function flowGet<T>(path: string, params: Record<string, string | number>, secretKey: string): Promise<T> {
  const qs = buildSignedQuery(params, secretKey);
  const res = await fetch(`${FLOW_API_URL}${path}?${qs}`, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Flow ${path} error ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

// Subscription webhook callback URL (Flow calls this on each recurring charge).
function subscriptionCallbackUrl(): string {
  return `${getPublicBaseUrl()}/api/webhooks/flow-subscription`;
}

// Idempotently ensure the monthly plan exists in Flow. Safe to call repeatedly:
// if the plan already exists, Flow returns an error which we swallow.
export async function ensurePlan(creds: FlowAdminCreds): Promise<void> {
  const params: Record<string, string | number> = {
    apiKey: creds.apiKey,
    planId: PLAN_ID,
    name: PLAN_NAME,
    currency: PLAN_CURRENCY,
    amount: PLAN_AMOUNT,
    interval: PLAN_INTERVAL_MONTHLY,
    urlCallback: subscriptionCallbackUrl(),
  };
  try {
    await flowPost("/plans/create", params, creds.secretKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Flow returns an error when the planId already exists — that's fine.
    if (/exist|ya existe|1820|already/i.test(msg)) return;
    throw err;
  }
}

export interface FlowCustomer {
  customerId: string;
  name: string;
  email: string;
}

export async function createCustomer(
  creds: FlowAdminCreds,
  input: { name: string; email: string; externalId: string },
): Promise<FlowCustomer> {
  const params: Record<string, string | number> = {
    apiKey: creds.apiKey,
    name: input.name,
    email: input.email,
    externalId: input.externalId,
  };
  return flowPost<FlowCustomer>("/customer/create", params, creds.secretKey);
}

export interface FlowRegisterResult {
  url: string;
  token: string;
}

// Starts the hosted card-registration flow. Returns the URL the user must visit
// to enter their card. After registering, Flow redirects the browser to url_return.
export async function registerCard(
  creds: FlowAdminCreds,
  input: { customerId: string; urlReturn: string },
): Promise<FlowRegisterResult> {
  const params: Record<string, string | number> = {
    apiKey: creds.apiKey,
    customerId: input.customerId,
    url_return: input.urlReturn,
  };
  const data = await flowPost<{ url: string; token: string }>(
    "/customer/register",
    params,
    creds.secretKey,
  );
  return { url: `${data.url}?token=${data.token}`, token: data.token };
}

export interface FlowRegisterStatus {
  status: number; // 1 = card registered successfully
  customerId: string;
  creditCardType?: string;
  last4CardDigits?: string;
}

export async function getRegisterStatus(
  creds: FlowAdminCreds,
  token: string,
): Promise<FlowRegisterStatus> {
  const params: Record<string, string | number> = { apiKey: creds.apiKey, token };
  return flowGet<FlowRegisterStatus>("/customer/getRegisterStatus", params, creds.secretKey);
}

export interface FlowSubscription {
  subscriptionId: string;
  planId: string;
  customerId: string;
  status: number; // 0=inactive, 1=active, 4=canceled
  morose?: number; // 1 if the customer is behind on payment
  period_end?: string;
  next_invoice_date?: string;
  cancel_at_period_end?: number;
}

export async function createSubscription(
  creds: FlowAdminCreds,
  input: { customerId: string },
): Promise<FlowSubscription> {
  const params: Record<string, string | number> = {
    apiKey: creds.apiKey,
    planId: PLAN_ID,
    customerId: input.customerId,
  };
  return flowPost<FlowSubscription>("/subscription/create", params, creds.secretKey);
}

export async function getSubscription(
  creds: FlowAdminCreds,
  subscriptionId: string,
): Promise<FlowSubscription> {
  const params: Record<string, string | number> = { apiKey: creds.apiKey, subscriptionId };
  return flowGet<FlowSubscription>("/subscription/get", params, creds.secretKey);
}

// Maps a Flow subscription object to our internal subscription state.
export function mapSubscription(sub: FlowSubscription): {
  status: "activa" | "vencida";
  periodEnd: Date | null;
} {
  const periodEndStr = sub.period_end ?? sub.next_invoice_date ?? null;
  const periodEnd = periodEndStr ? new Date(periodEndStr) : null;

  // Behind on payment (morose) or canceled/inactive => access blocked.
  const isMorose = Boolean(sub.morose);
  const isActive = sub.status === 1 && !isMorose;

  return { status: isActive ? "activa" : "vencida", periodEnd };
}
