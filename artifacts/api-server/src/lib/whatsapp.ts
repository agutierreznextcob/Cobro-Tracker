// WhatsApp Cloud API (Meta) sender for outbound reminders.
//
// Configuration (all via environment / secrets):
//   WHATSAPP_PHONE_NUMBER_ID  — the Cloud API phone number id (required)
//   WHATSAPP_ACCESS_TOKEN     — a permanent/system-user access token (required)
//   WHATSAPP_API_VERSION      — Graph API version (optional, default v21.0)
//   WHATSAPP_TEMPLATE_NAME    — approved template name for business-initiated
//                               messages (optional). When set, the reminder text
//                               is passed as the single {{1}} body parameter.
//   WHATSAPP_TEMPLATE_LANG    — template language code (optional, default es)
//
// When the provider is not configured, isWhatsAppConfigured() returns false and
// the reminder engine falls back to creating an in-app notification instead.

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

interface SendLogger {
  warn: (obj: object, msg: string) => void;
}

export interface WhatsAppResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

/** Normaliza un teléfono chileno a formato E.164 sin signo (p. ej. 56912345678). */
export function sanitizePhone(tel: string): string {
  let d = tel.replace(/\D/g, "");
  if (d.length === 9 && d.startsWith("9")) d = "56" + d;
  else if (d.length === 8) d = "569" + d;
  return d;
}

/** True cuando hay un proveedor de WhatsApp configurado para envío automático. */
export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/** Envía un mensaje de WhatsApp a través de la Cloud API de Meta. */
export async function sendWhatsAppMensaje(
  opts: { telefono: string; mensaje: string },
  log?: SendLogger,
): Promise<WhatsAppResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !token) {
    return { ok: false, error: "WhatsApp no está configurado." };
  }

  const to = sanitizePhone(opts.telefono);
  if (!to) {
    return { ok: false, error: "El cliente no tiene un teléfono válido." };
  }

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || "es";

  const payload = templateName
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: [
            { type: "body", parameters: [{ type: "text", text: opts.mensaje }] },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: true, body: opts.mensaje },
      };

  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
      | null;

    if (!res.ok) {
      const apiMsg = json?.error?.message ?? `HTTP ${res.status}`;
      log?.warn({ status: res.status, whatsappError: json?.error }, "Error sending WhatsApp via Cloud API");
      return { ok: false, error: `WhatsApp API: ${apiMsg}` };
    }

    const messageId = json?.messages?.[0]?.id;
    return { ok: true, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err }, "Network error sending WhatsApp via Cloud API");
    return { ok: false, error: `Error de red al enviar WhatsApp: ${msg}` };
  }
}
