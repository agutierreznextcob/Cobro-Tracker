/**
 * E2E public-routes guard: verifica que los endpoints públicos respondan SIN
 * sesión y que ningún guardia de autenticación "en blanco" (Router.use sin
 * path) los esté interceptando con 401/403.
 *
 * Contexto: gestionesRouter aplicó una vez un authGuard sin path y rompió con
 * 401 todas las rutas públicas montadas después (portal del deudor, leads,
 * chat público, webhooks). Este script detecta esa regresión.
 *
 * Requiere el API Server levantado (workflow "artifacts/api-server: API Server").
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/e2e-public-routes.ts
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:80/api";

let failures = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function req(method: string, path: string, opts: { json?: unknown; form?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  // Sin cookie de sesión, a propósito: estas rutas deben ser públicas.
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  let text = "";
  try { text = await res.text(); } catch { /* SSE / empty */ }
  return { status: res.status, text };
}

/**
 * Cada caso declara el/los status esperados. Todos comparten la invariante
 * dura: NUNCA 401 ni 403 — eso significa que un guard de auth mal ubicado
 * está interceptando la ruta pública.
 */
const cases: Array<{
  name: string;
  method: string;
  path: string;
  opts?: { json?: unknown; form?: Record<string, string> };
  expect: number[];
}> = [
  {
    name: "GET /public/portal/:token inválido → 404 (portal del deudor)",
    method: "GET",
    path: "/public/portal/token-invalido-e2e",
    expect: [404],
  },
  {
    name: "POST /public/leads body inválido → 400 (formulario landing)",
    method: "POST",
    path: "/public/leads",
    opts: { json: {} },
    expect: [400],
  },
  {
    name: "POST /public/landing-chat body inválido → 400 (chat público)",
    method: "POST",
    path: "/public/landing-chat",
    opts: { json: {} },
    expect: [400],
  },
  {
    name: "GET /encuestas/:token inválido → 404 (encuesta pública)",
    method: "GET",
    path: "/encuestas/token-invalido-e2e",
    expect: [404],
  },
  {
    name: "POST /webhooks/flow sin token → 200 (contrato Flow: siempre 200)",
    method: "POST",
    path: "/webhooks/flow",
    opts: { form: {} },
    expect: [200],
  },
  {
    name: "POST /webhooks/flow-subscription sin subscriptionId → 200",
    method: "POST",
    path: "/webhooks/flow-subscription",
    opts: { form: {} },
    expect: [200],
  },
  {
    name: "POST /webhooks/mercadopago sin paymentId → 200 (ignorado)",
    method: "POST",
    path: "/webhooks/mercadopago",
    opts: { json: {} },
    expect: [200],
  },
];

async function main() {
  console.log(`== Verificando rutas públicas sin sesión contra ${BASE} ==`);
  // Sanity: el server está arriba.
  const health = await fetch(BASE).catch(() => null);
  if (!health) {
    console.error("✗ API Server no responde. Levanta el workflow del API Server primero.");
    process.exit(1);
  }

  for (const c of cases) {
    const r = await req(c.method, c.path, c.opts);
    // Invariante dura: nunca 401/403 en rutas públicas.
    check(
      `${c.name} — sin 401/403`,
      r.status !== 401 && r.status !== 403,
      { status: r.status, body: r.text.slice(0, 200) },
    );
    // Contrato específico del endpoint.
    check(
      `${c.name} — status ${r.status} ∈ [${c.expect.join(", ")}]`,
      c.expect.includes(r.status),
      { status: r.status, body: r.text.slice(0, 200) },
    );
  }

  console.log(failures === 0 ? "\n✅ Todas las rutas públicas OK" : `\n❌ ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
