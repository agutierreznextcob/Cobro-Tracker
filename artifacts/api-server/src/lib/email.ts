import { Resend } from "resend";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

function formatCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function buildEmailHtml(opts: {
  title: string;
  previewText: string;
  heading: string;
  bodyLines: string[];
  ctaText: string;
  ctaUrl: string;
  footerNote?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${opts.previewText}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;" align="center">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2563eb;border-radius:10px;padding:8px 10px;vertical-align:middle;">
                    <span style="color:#fff;font-size:16px;font-weight:700;letter-spacing:-0.5px;">⚡ Cobro Simple</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;border:1px solid #e4e4e7;padding:40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#09090b;letter-spacing:-0.3px;">${opts.heading}</h1>
              ${opts.bodyLines.map((line) => `<p style="margin:0 0 14px;font-size:15px;color:#52525b;line-height:1.6;">${line}</p>`).join("")}
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td align="center">
                    <a href="${opts.ctaUrl}" target="_blank"
                      style="display:inline-block;background:#2563eb;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 32px;letter-spacing:-0.2px;">
                      ${opts.ctaText}
                    </a>
                  </td>
                </tr>
              </table>
              ${opts.footerNote ? `<p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;text-align:center;">${opts.footerNote}</p>` : ""}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                Cobro Simple · Santiago, Chile<br/>
                Si tienes dudas, responde este correo o escríbenos a hola@cobrosimple.cl
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface CobrosEmailData {
  emailPagador: string;
  clienteNombre: string | null;
  descripcion: string;
  monto: number;
  linkPago: string;
  comercioNombre: string;
}

export interface EmailResult {
  ok: boolean;
  error?: string;
}

export async function sendPaymentLinkEmail(data: CobrosEmailData, log?: { warn: (obj: object, msg: string) => void }): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping payment link email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const montoFormato = formatCLP(data.monto);
  const nombre = data.clienteNombre || "cliente";

  const { error } = await client.emails.send({
    from: FROM,
    to: [data.emailPagador],
    subject: `Tienes un cobro pendiente de ${montoFormato} — ${data.comercioNombre}`,
    html: buildEmailHtml({
      title: `Cobro pendiente — ${montoFormato}`,
      previewText: `${data.comercioNombre} te envió un cobro de ${montoFormato} por ${data.descripcion}.`,
      heading: `Hola ${nombre}, tienes un cobro pendiente 👋`,
      bodyLines: [
        `<strong>${data.comercioNombre}</strong> te ha enviado un cobro por el siguiente concepto:`,
        `<span style="display:block;background:#f4f4f5;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;">
          <strong>Concepto:</strong> ${data.descripcion}<br/>
          <strong>Monto:</strong> <span style="font-family:monospace;font-weight:700;color:#2563eb;">${montoFormato}</span>
        </span>`,
        `Puedes pagar de forma segura con tarjeta de crédito, débito o transferencia a través de Webpay.`,
      ],
      ctaText: `Pagar ${montoFormato}`,
      ctaUrl: data.linkPago,
      footerNote: `Si no reconoces este cobro, ignora este correo. El link de pago es seguro y procesado por Webpay/Flow.`,
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending payment link email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function sendRecordatorioEmail(data: CobrosEmailData, log?: { warn: (obj: object, msg: string) => void }): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping reminder email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const montoFormato = formatCLP(data.monto);
  const nombre = data.clienteNombre || "cliente";

  const { error } = await client.emails.send({
    from: FROM,
    to: [data.emailPagador],
    subject: `Recordatorio: Cobro pendiente de ${montoFormato} — ${data.comercioNombre}`,
    html: buildEmailHtml({
      title: `Recordatorio de pago — ${montoFormato}`,
      previewText: `Recordatorio: tienes un cobro pendiente de ${montoFormato} por ${data.descripcion}.`,
      heading: `Recordatorio de pago, ${nombre} 🔔`,
      bodyLines: [
        `Este es un recordatorio amistoso de <strong>${data.comercioNombre}</strong>. Tu cobro aún está pendiente de pago:`,
        `<span style="display:block;background:#fef9c3;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;border-left:3px solid #eab308;">
          <strong>Concepto:</strong> ${data.descripcion}<br/>
          <strong>Monto:</strong> <span style="font-family:monospace;font-weight:700;color:#2563eb;">${montoFormato}</span>
        </span>`,
        `Puedes pagar de forma rápida y segura haciendo clic en el botón a continuación.`,
      ],
      ctaText: `Pagar ahora ${montoFormato}`,
      ctaUrl: data.linkPago,
      footerNote: `Si ya realizaste el pago, ignora este mensaje. El link es seguro y procesado por Webpay/Flow.`,
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending reminder email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}
