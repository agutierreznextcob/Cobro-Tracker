import { createHash } from "node:crypto";
import type { ArchivoCotizacion } from "./cotizacion-archivo";
import { cotizacionEmailMessage } from "./email";
import { z } from "zod";

const providerEmailSchema = z.object({
  id: z.string(), created_at: z.string(), to: z.array(z.string()),
  subject: z.string(), html: z.string(), from: z.string(),
  reply_to: z.array(z.string()).optional(), last_event: z.string(),
});
const attachmentSchema = z.object({
  has_more: z.boolean(),
  data: z.array(z.object({ download_url: z.string().url(), size: z.number(), filename: z.string() })),
});

export const envioKey = (a: ArchivoCotizacion) => a.retry?.key ?? `cotizacion-${a.email.id}-${a.email.version}`;
export const envioWindowStart = (a: ArchivoCotizacion) => a.retry?.authorizedAt ?? a.preparedAt;

// Never interpret a missing email, an empty search, or any provider error as
// evidence of non-acceptance. The API only provides positive evidence.
export async function verificarEnvio(a: ArchivoCotizacion, providerId: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Servicio de correo no configurado.");
  const get = async (path: string) => {
    const response = await fetch(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("No se pudo verificar el envío en Resend. No autoriza un reenvío.");
    return response.json();
  };
  const email = providerEmailSchema.parse(await get(`/emails/${encodeURIComponent(providerId)}`));
  const expected = a.message ?? cotizacionEmailMessage(a.email);
  const created = Date.parse(email.created_at);
  if (email.id !== providerId || !Number.isFinite(created) ||
      created < Date.parse(envioWindowStart(a)) - 60_000 || created > Date.now() + 60_000 ||
      JSON.stringify(email.to) !== JSON.stringify(expected.to) ||
      email.subject !== expected.subject || email.html !== expected.html ||
      (a.message && (email.from !== expected.from ||
        JSON.stringify(email.reply_to ?? []) !== JSON.stringify(expected.replyTo ? [expected.replyTo] : [])))) {
    throw new Error("El mensaje del proveedor no coincide con el envío conservado.");
  }
  const attachments = attachmentSchema.parse(await get(`/emails/${encodeURIComponent(providerId)}/attachments`));
  if (attachments.has_more !== false || attachments.data?.length !== 1)
    throw new Error("No se pudo verificar el adjunto único del envío.");
  const attachment = attachments.data[0];
  const url = new URL(attachment.download_url);
  if (url.protocol !== "https:" || url.hostname !== "outbound-cdn.resend.com" || url.username || url.password ||
      attachment.size !== a.bytes || attachment.filename !== `${a.email.numero.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`)
    throw new Error("El adjunto del proveedor no coincide.");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error("No se pudo descargar el adjunto del proveedor.");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    bytes += chunk.length;
    if (bytes > a.bytes) { await response.body.cancel().catch(() => {}); throw new Error("Adjunto demasiado grande."); }
    hash.update(chunk);
  }
  if (bytes !== a.bytes || hash.digest("hex") !== a.sha256)
    throw new Error("La huella del PDF del proveedor no coincide.");
  return { providerId, createdAt: new Date(created).toISOString(), lastEvent: String(email.last_event ?? "unknown"), sha256: a.sha256 };
}
