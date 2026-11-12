import { z } from "zod";
import { verificarEnvio } from "../../src/lib/cotizacion-conciliacion";

// Local evidence captured BEFORE sending the internal test message, not copied
// from the API under test. Strict schemas reject accidental credentials/URLs.
export const fixtureSchema = z.object({
  providerId: z.string().uuid(),
  preparedAt: z.string().datetime({ offset: true }),
  bytes: z.number().int().positive().max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  email: z.object({
    id: z.number().int(), version: z.string(), numero: z.string(),
    email: z.string().email(), cliente: z.string(), total: z.number(),
    moneda: z.string(), decimales: z.number().int(), vencimiento: z.string(),
    remitente: z.object({
      nombre: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    }).strict(),
  }).strict(),
  message: z.object({
    from: z.string().min(1), to: z.array(z.string().email()).length(1),
    subject: z.string(), html: z.string(),
    replyTo: z.string().email().optional(),
  }).strict(),
}).strict();

/** Standalone process only: guard every request, including future verifier changes. */
export async function checkResendContract(input: unknown, transport: typeof fetch = fetch) {
  let stage = "fixture";
  const originalFetch = globalThis.fetch;
  try {
    const fixture = fixtureSchema.parse(input);
    const emailPath = `/emails/${fixture.providerId}`;
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (request.method !== "GET" || url.username || url.password || url.port)
        throw new Error("Request blocked");
      requests++;
      if (requests === 1 || requests === 2) {
        stage = requests === 1 ? "GET email: formato, permisos y mensaje" : "GET adjuntos: formato y permisos";
        const path = requests === 1 ? emailPath : `${emailPath}/attachments`;
        if (url.origin !== "https://api.resend.com" || url.pathname !== path || url.search)
          throw new Error("Request blocked");
      } else {
        stage = "CDN: dominio, permisos, tamaño y SHA-256";
        if (requests !== 3 || url.origin !== "https://outbound-cdn.resend.com" ||
            request.headers.has("authorization")) throw new Error("Request blocked");
      }
      // Never follow API redirects with a credential, nor signed CDN redirects.
      const response = await transport(request, { redirect: "error" });
      if (!response.ok) {
        stage += ` (HTTP ${response.status}${response.status === 401 || response.status === 403 ? ": revisar permisos/equipo" : ""})`;
        throw new Error("HTTP failure");
      }
      return response;
    };
    await verificarEnvio({
      ...fixture, scope: "contract-test", path: "/unused-contract-fixture",
    }, fixture.providerId);
    if (requests !== 3) throw new Error("Incomplete verification");
  } catch {
    // Do not print provider bodies, Zod issues, identifiers, addresses or URLs.
    throw new Error(`FAIL contrato Resend — ${stage}. No prueba rechazo ni autoriza reenvío.`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
