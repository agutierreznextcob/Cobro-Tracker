import { Resend } from "resend";

// Escapes HTML-special characters so untrusted text can be safely interpolated
// into email HTML bodies without injecting markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

// Builds the "De:" (From) header and optional Reply-To for outbound emails.
// The display name reads "<Nombre del remitente> via NextCob" so the
// recipient sees who sent it, while the address stays on the platform domain.
// Reply-To is set to the sender's own email so replies reach them directly,
// not NextCob. Header values are sanitized against CRLF/quote injection.
function buildRemitente(remitente?: {
  nombre?: string | null;
  email?: string | null;
}): { from: string; replyTo?: string } {
  const nombre = remitente?.nombre?.replace(/[\r\n]/g, "").trim();
  const displayName = nombre ? `${nombre} via NextCob` : "NextCob";
  const safeName = displayName.replace(/"/g, "").trim();
  const from = `"${safeName}" <${FROM_EMAIL}>`;

  const email = remitente?.email?.replace(/[\r\n]/g, "").trim();
  const replyTo =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;

  return replyTo ? { from, replyTo } : { from };
}

// Builds the "Responder al cobro" CTA as a mailto: link that opens the debtor's
// mail client addressed directly to the ejecutivo/usuario who issued the cobro,
// with a prefilled subject "Re: Cobro pendiente - <concepto>" and an empty body.
// Returns null when the sender's email is missing/invalid so the caller can omit
// the button entirely — the reply must never be routed to NextCob.
function buildResponderCobroMailto(
  remitenteEmail: string | null | undefined,
  concepto: string,
): string | null {
  const email = remitenteEmail?.replace(/[\r\n]/g, "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const asunto = encodeURIComponent(`Re: Cobro pendiente - ${concepto}`);
  return `mailto:${encodeURIComponent(email)}?subject=${asunto}`;
}

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
  ctaText?: string;
  ctaUrl?: string;
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
                    <span style="color:#fff;font-size:16px;font-weight:700;letter-spacing:-0.5px;">⚡ NextCob</span>
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
              ${
                opts.ctaUrl && opts.ctaText
                  ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td align="center">
                    <a href="${opts.ctaUrl}" target="_blank"
                      style="display:inline-block;background:#2563eb;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 32px;letter-spacing:-0.2px;">
                      ${opts.ctaText}
                    </a>
                  </td>
                </tr>
              </table>`
                  : ""
              }
              ${opts.footerNote ? `<p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;text-align:center;">${opts.footerNote}</p>` : ""}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                NextCob · Santiago, Chile<br/>
                Si tienes dudas, responde este correo o escríbenos a contacto@nextcob.com
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
  remitenteNombre?: string | null;
  remitenteEmail?: string | null;
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
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
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

export interface AvisoManualEmailData {
  emailPagador: string;
  clienteNombre: string | null;
  descripcion: string;
  monto: number;
  comercioNombre: string;
  remitenteNombre?: string | null;
  remitenteEmail?: string | null;
  /** Bloque HTML con datos bancarios para transferencia (cobros manuales). */
  datosBancariosHtml?: string | null;
}

export async function sendAvisoManualEmail(
  data: AvisoManualEmailData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping aviso manual email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const montoFormato = formatCLP(data.monto);
  const nombre = data.clienteNombre || "cliente";

  const responderUrl = buildResponderCobroMailto(data.remitenteEmail, data.descripcion);

  const { error } = await client.emails.send({
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
    to: [data.emailPagador],
    subject: `Cobro pendiente de ${montoFormato} — ${data.comercioNombre}`,
    html: buildEmailHtml({
      title: `Cobro pendiente — ${montoFormato}`,
      previewText: `${data.comercioNombre} te informa de un cobro pendiente de ${montoFormato} por ${data.descripcion}.`,
      heading: `Hola ${nombre}, tienes un cobro pendiente 👋`,
      bodyLines: [
        `<strong>${data.comercioNombre}</strong> te informa del siguiente cobro pendiente:`,
        `<span style="display:block;background:#f4f4f5;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;">
          <strong>Concepto:</strong> ${data.descripcion}<br/>
          <strong>Monto:</strong> <span style="font-family:monospace;font-weight:700;color:#2563eb;">${montoFormato}</span>
        </span>`,
        ...(data.datosBancariosHtml ? [data.datosBancariosHtml] : []),
        data.datosBancariosHtml
          ? `Una vez realizada la transferencia, responde este correo adjuntando el comprobante, o envíalo al email indicado arriba.`
          : `Para coordinar el pago, responde este correo o contacta directamente con <strong>${data.comercioNombre}</strong>.`,
      ],
      ctaText: responderUrl ? `Responder al cobro` : undefined,
      ctaUrl: responderUrl ?? undefined,
      footerNote: `Si no reconoces este cobro, ignora este correo.`,
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending aviso manual email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface RenovacionEmailData {
  email: string;
  nombre: string | null;
  estado: "prueba" | "activa" | "vencida" | "cancelada";
  vencido: boolean;
  vencimiento: string | null;
  precioMensual: number;
  ctaUrl: string;
}

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

export async function sendRenovacionEmail(
  data: RenovacionEmailData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping renewal reminder email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const nombre = data.nombre || "";
  const saludo = nombre ? `Hola ${nombre}` : "Hola";
  const precioFormato = formatCLP(data.precioMensual);
  const fechaFormato = formatFecha(data.vencimiento);

  const heading = data.vencido
    ? `${saludo}, tu acceso a NextCob venció ⏰`
    : `${saludo}, tu acceso a NextCob está por vencer ⏰`;

  const detalle = data.vencido
    ? `Tu ${data.estado === "activa" ? "suscripción" : "período de prueba"} venció el <strong>${fechaFormato}</strong>. Renueva para seguir usando todas las funciones de NextCob.`
    : `Tu ${data.estado === "activa" ? "suscripción" : "período de prueba"} vence el <strong>${fechaFormato}</strong>. Renueva ahora para no perder el acceso.`;

  const { error } = await client.emails.send({
    ...buildRemitente(),
    to: [data.email],
    subject: data.vencido
      ? "Tu acceso a NextCob venció — renueva tu suscripción"
      : "Tu acceso a NextCob está por vencer",
    html: buildEmailHtml({
      title: "Renovación de NextCob",
      previewText: data.vencido
        ? "Tu acceso venció. Renueva tu suscripción para continuar."
        : "Tu acceso está por vencer. Renueva tu suscripción.",
      heading,
      bodyLines: [
        detalle,
        `<span style="display:block;background:#fef9c3;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;border-left:3px solid #eab308;">
          <strong>Plan mensual:</strong> <span style="font-family:monospace;font-weight:700;color:#2563eb;">${precioFormato}</span> / mes
        </span>`,
        `Activa o renueva tu suscripción en segundos haciendo clic en el botón a continuación.`,
      ],
      ctaText: "Renovar suscripción",
      ctaUrl: data.ctaUrl,
      footerNote: "Si ya renovaste, ignora este mensaje. ¡Gracias por usar NextCob!",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending renewal reminder email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

// Aviso de pago de suscripción fallido: Reveniu no pudo cobrar la tarjeta. El
// cliente tiene 3 días de gracia para regularizar antes de la suspensión.
export async function sendPagoFallidoEmail(
  data: {
    email: string;
    nombre?: string | null;
    montoMensual: number;
    graciaHasta: Date;
    actualizarMetodoUrl?: string | null;
  },
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping failed-payment email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const saludo = data.nombre ? `Hola ${escapeHtml(data.nombre)}` : "Hola";
  const fechaGracia = formatFecha(data.graciaHasta.toISOString());

  const { error } = await client.emails.send({
    ...buildRemitente(),
    to: [data.email],
    subject: "No pudimos procesar el pago de tu suscripción a NextCob",
    html: buildEmailHtml({
      title: "Pago de suscripción fallido",
      previewText: "No pudimos cobrar tu suscripción. Tienes 3 días para regularizar.",
      heading: `${saludo}, no pudimos procesar tu pago ⚠️`,
      bodyLines: [
        `Intentamos cobrar tu suscripción mensual de <strong>${formatCLP(data.montoMensual)}</strong> pero el cargo fue rechazado.`,
        `Tu cuenta seguirá activa hasta el <strong>${fechaGracia}</strong>. Si no recibimos el pago antes de esa fecha, tu acceso quedará suspendido.`,
        `Revisa que tu tarjeta tenga fondos disponibles o actualiza tu método de pago para que el próximo intento sea exitoso.`,
      ],
      ...(data.actualizarMetodoUrl
        ? { ctaText: "Actualizar método de pago", ctaUrl: data.actualizarMetodoUrl }
        : {}),
      footerNote: "Si ya regularizaste el pago, ignora este mensaje.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending failed-payment email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function sendVerificacionEmail(
  data: {
    email: string;
    nombre?: string | null;
    ctaUrl: string;
    accountId?: string | null;
  },
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping verification email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const saludo = data.nombre ? `Hola ${data.nombre}` : "Hola";
  const { error } = await client.emails.send({
    ...buildRemitente(),
    to: [data.email],
    subject: "Confirma tu correo — NextCob",
    html: buildEmailHtml({
      title: "Confirma tu correo",
      previewText: "Confirma tu correo para activar tu cuenta en NextCob.",
      heading: `${saludo}, confirma tu correo 👋`,
      bodyLines: [
        `Gracias por registrarte en <strong>NextCob</strong>. Para activar tu cuenta y comenzar tu prueba gratuita, confirma tu dirección de correo haciendo clic en el botón.`,
        ...(data.accountId
          ? [
              `Tu ID de cuenta es <strong>${data.accountId}</strong>. Guárdalo para cualquier consulta de soporte.`,
            ]
          : []),
        `Si no creaste esta cuenta, puedes ignorar este mensaje.`,
      ],
      ctaText: "Confirmar mi correo",
      ctaUrl: data.ctaUrl,
      footerNote: "Este enlace es válido por 24 horas.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending verification email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function sendWelcomeEmail(
  data: {
    email: string;
    nombre?: string | null;
    accountId?: string | null;
    ctaUrl: string;
  },
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping welcome email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const saludo = data.nombre ? `Hola ${data.nombre}` : "Hola";
  const { error } = await client.emails.send({
    ...buildRemitente(),
    to: [data.email],
    subject: "¡Bienvenido a NextCob! Tu cuenta está activa",
    html: buildEmailHtml({
      title: "Bienvenido a NextCob",
      previewText: "Tu cuenta está activa. Comienza a gestionar tus cobros hoy.",
      heading: `${saludo}, ¡bienvenido a NextCob! 🎉`,
      bodyLines: [
        `Tu correo fue confirmado y tu cuenta ya está activa. Desde hoy puedes crear cobros, generar links de pago, programar recordatorios automáticos y hacer seguimiento de tus clientes.`,
        ...(data.accountId
          ? [
              `Tu ID de cuenta es <strong>${data.accountId}</strong>. Guárdalo para cualquier consulta de soporte.`,
            ]
          : []),
        `Si tienes dudas, responde este correo y te ayudaremos.`,
      ],
      ctaText: "Ir a mi panel",
      ctaUrl: data.ctaUrl,
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending welcome email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function sendResetPasswordEmail(
  data: { email: string; nombre?: string | null; ctaUrl: string },
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping password reset email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const saludo = data.nombre ? `Hola ${data.nombre}` : "Hola";
  const { error } = await client.emails.send({
    ...buildRemitente(),
    to: [data.email],
    subject: "Recupera tu contraseña — NextCob",
    html: buildEmailHtml({
      title: "Recupera tu contraseña",
      previewText: "Restablece tu contraseña de NextCob.",
      heading: `${saludo}, recupera tu contraseña 🔑`,
      bodyLines: [
        `Recibimos una solicitud para restablecer la contraseña de tu cuenta de <strong>NextCob</strong>. Haz clic en el botón para crear una nueva contraseña.`,
        `Si no solicitaste este cambio, puedes ignorar este mensaje; tu contraseña no se modificará.`,
      ],
      ctaText: "Restablecer contraseña",
      ctaUrl: data.ctaUrl,
      footerNote: "Este enlace es válido por 1 hora.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending password reset email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface SecuenciaRecordatorioData {
  emailPagador: string;
  clienteNombre: string | null;
  descripcion: string;
  monto: number;
  comercioNombre: string;
  linkPago?: string | null;
  /** Días respecto al vencimiento: negativo = antes, 0 = vence hoy, positivo = vencido hace N días */
  diasVencido: number;
  remitenteNombre?: string | null;
  remitenteEmail?: string | null;
  /** Bloque HTML con datos bancarios para transferencia (cobros manuales). */
  datosBancariosHtml?: string | null;
}

export async function sendSecuenciaRecordatorioEmail(
  data: SecuenciaRecordatorioData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping sequence reminder email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const montoFormato = formatCLP(data.monto);
  const nombre = data.clienteNombre || "cliente";
  const d = data.diasVencido;

  let subject: string;
  let heading: string;
  let intro: string;
  if (d < 0) {
    const dias = Math.abs(d);
    subject = `Tu pago de ${montoFormato} vence ${dias === 1 ? "mañana" : `en ${dias} días`} — ${data.comercioNombre}`;
    heading = `Recordatorio: tu pago vence pronto ⏰`;
    intro = `Te recordamos que tienes un cobro de <strong>${data.comercioNombre}</strong> que vence ${dias === 1 ? "<strong>mañana</strong>" : `en <strong>${dias} días</strong>`}:`;
  } else if (d === 0) {
    subject = `Tu pago de ${montoFormato} vence hoy — ${data.comercioNombre}`;
    heading = `Tu pago vence hoy, ${nombre} 🔔`;
    intro = `Hoy es el último día para pagar tu cobro de <strong>${data.comercioNombre}</strong>:`;
  } else {
    subject = `Pago vencido de ${montoFormato} — ${data.comercioNombre}`;
    heading = `Tu pago está vencido, ${nombre}`;
    intro = `Tu cobro de <strong>${data.comercioNombre}</strong> venció hace <strong>${d} ${d === 1 ? "día" : "días"}</strong>. Te pedimos regularizarlo a la brevedad:`;
  }

  const tieneLink = !!data.linkPago;
  const responderUrl = tieneLink
    ? null
    : buildResponderCobroMailto(data.remitenteEmail, data.descripcion);

  const { error } = await client.emails.send({
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
    to: [data.emailPagador],
    subject,
    html: buildEmailHtml({
      title: subject,
      previewText: `${intro.replace(/<[^>]+>/g, "")}`,
      heading,
      bodyLines: [
        intro,
        `<span style="display:block;background:#fef9c3;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;border-left:3px solid #eab308;">
          <strong>Concepto:</strong> ${data.descripcion}<br/>
          <strong>Monto:</strong> <span style="font-family:monospace;font-weight:700;color:#2563eb;">${montoFormato}</span>
        </span>`,
        ...(!tieneLink && data.datosBancariosHtml ? [data.datosBancariosHtml] : []),
        tieneLink
          ? `Puedes pagar de forma rápida y segura haciendo clic en el botón a continuación.`
          : data.datosBancariosHtml
            ? `Una vez realizada la transferencia, responde este correo adjuntando el comprobante, o envíalo al email indicado arriba.`
            : `Para coordinar el pago, responde este correo o contacta directamente con <strong>${data.comercioNombre}</strong>.`,
      ],
      ctaText: tieneLink
        ? `Pagar ${montoFormato}`
        : responderUrl
          ? `Responder al cobro`
          : undefined,
      ctaUrl: tieneLink ? data.linkPago! : (responderUrl ?? undefined),
      footerNote: `Si ya realizaste el pago, ignora este mensaje.`,
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending sequence reminder email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface InvitacionEmailData {
  email: string;
  organizacionNombre: string;
  invitadoPorNombre: string | null;
  invitadoPorEmail?: string | null;
  orgRole: "admin_org" | "supervisor" | "ejecutivo";
  ctaUrl: string;
}

export async function sendInvitacionEmail(
  data: InvitacionEmailData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping invitation email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const invitador = data.invitadoPorNombre || "El equipo";
  const rolTexto =
    data.orgRole === "admin_org"
      ? "administrador"
      : data.orgRole === "supervisor"
        ? "supervisor"
        : "ejecutivo";

  const { error } = await client.emails.send({
    ...buildRemitente({ nombre: data.invitadoPorNombre, email: data.invitadoPorEmail }),
    to: [data.email],
    subject: `Te invitaron a unirte a ${data.organizacionNombre} en NextCob`,
    html: buildEmailHtml({
      title: `Invitación a ${data.organizacionNombre}`,
      previewText: `${invitador} te invitó a unirte a ${data.organizacionNombre} en NextCob.`,
      heading: `Te invitaron a ${data.organizacionNombre} 👋`,
      bodyLines: [
        `<strong>${invitador}</strong> te invitó a unirte a <strong>${data.organizacionNombre}</strong> en NextCob como <strong>${rolTexto}</strong>.`,
        `Para aceptar la invitación, inicia sesión con este mismo correo (<strong>${data.email}</strong>) haciendo clic en el botón a continuación.`,
      ],
      ctaText: "Aceptar invitación",
      ctaUrl: data.ctaUrl,
      footerNote:
        "Si no esperabas esta invitación, puedes ignorar este correo.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending invitation email via Resend");
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
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
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
      footerNote: `Si ya realizaste el pago, ignora este mensaje. El link es seguro y procesado por ${data.linkPago.includes("mercadopago") ? "MercadoPago" : "Webpay/Flow"}.`,
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending reminder email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface LeadNotificationData {
  nombre: string;
  telefono: string;
  email: string;
  mensaje?: string | null;
}

// Notifies the NextCob sales inbox when a new lead arrives from the public
// landing-page form. Recipient is configurable via LEADS_NOTIFICATION_EMAIL,
// defaulting to the public contact address.
export async function sendLeadNotificationEmail(
  data: LeadNotificationData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping lead notification email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const destino = process.env.LEADS_NOTIFICATION_EMAIL || "contacto@nextcob.com";
  // Lead fields come from an unauthenticated public form, so escape them before
  // interpolating into HTML to prevent content/HTML injection in the inbox.
  const nombre = escapeHtml(data.nombre);
  const telefono = escapeHtml(data.telefono);
  const email = escapeHtml(data.email);
  const mensajeHtml = data.mensaje
    ? `<strong>Mensaje:</strong> ${escapeHtml(data.mensaje)}`
    : `<strong>Mensaje:</strong> <em>(sin mensaje)</em>`;

  const { error } = await client.emails.send({
    ...buildRemitente(),
    to: [destino],
    replyTo: data.email,
    subject: `Nuevo lead: ${data.nombre}`,
    html: buildEmailHtml({
      title: "Nuevo lead desde la landing",
      previewText: `${nombre} solicitó que lo contacten (${email}).`,
      heading: "Tienes un nuevo lead 🎯",
      bodyLines: [
        `Un visitante completó el formulario de contacto en la landing de NextCob:`,
        `<span style="display:block;background:#f4f4f5;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;border-left:3px solid #6C5CE7;">
          <strong>Nombre:</strong> ${nombre}<br/>
          <strong>Teléfono:</strong> ${telefono}<br/>
          <strong>Correo:</strong> ${email}<br/>
          ${mensajeHtml}
        </span>`,
        `Responde este correo para contactarlo directamente, o gestiónalo desde la sección <strong>Leads</strong> del panel.`,
      ],
      ctaText: "Escribir al lead",
      ctaUrl: `mailto:${encodeURIComponent(data.email)}`,
      footerNote: "Lead generado automáticamente desde el formulario público.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending lead notification email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface ComprobanteEmailData {
  emailDestino: string;
  clienteNombre: string;
  empresa: string;
  numero: string;
  montoTotal: number;
  descripcion: string;
  metodoPago: string;
  pdf: Buffer;
  remitenteNombre?: string | null;
  remitenteEmail?: string | null;
}

// Sends the auto-generated payment receipt (comprobante) PDF to the payer.
export async function sendComprobanteEmail(
  data: ComprobanteEmailData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping comprobante email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const montoFormato = formatCLP(data.montoTotal);
  const nombre = data.clienteNombre || "cliente";

  const { error } = await client.emails.send({
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
    to: [data.emailDestino],
    subject: `Comprobante de pago ${data.numero} — ${montoFormato}`,
    html: buildEmailHtml({
      title: `Comprobante de pago — ${montoFormato}`,
      previewText: `Tu pago de ${montoFormato} a ${data.empresa} fue registrado. Comprobante ${data.numero}.`,
      heading: `Gracias ${escapeHtml(nombre)}, recibimos tu pago ✅`,
      bodyLines: [
        `<strong>${escapeHtml(data.empresa)}</strong> ha registrado tu pago correctamente. Adjuntamos el comprobante en PDF.`,
        `<span style="display:block;background:#f4f4f5;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;border-left:3px solid #6C5CE7;">
          <strong>Comprobante:</strong> ${escapeHtml(data.numero)}<br/>
          <strong>Concepto:</strong> ${escapeHtml(data.descripcion)}<br/>
          <strong>Monto pagado:</strong> <span style="font-family:monospace;font-weight:700;color:#6C5CE7;">${montoFormato}</span><br/>
          <strong>Método:</strong> ${escapeHtml(data.metodoPago)}
        </span>`,
        `Conserva este comprobante como respaldo de tu pago.`,
      ],
      ctaText: "Ver NextCob",
      ctaUrl: "https://nextcob.com",
      footerNote: "Comprobante generado automáticamente al confirmarse el pago.",
    }),
    attachments: [
      {
        filename: `comprobante-${data.numero}.pdf`,
        content: data.pdf.toString("base64"),
      },
    ],
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending comprobante email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface PortalEmailData {
  emailDestino: string;
  clienteNombre: string;
  empresa: string;
  url: string;
  remitenteNombre?: string | null;
  remitenteEmail?: string | null;
}

// Sends the debtor portal magic link to a cliente.
export async function sendPortalEmail(
  data: PortalEmailData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping portal email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const nombre = data.clienteNombre || "cliente";

  const { error } = await client.emails.send({
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
    to: [data.emailDestino],
    subject: `Tu portal de pagos con ${data.empresa}`,
    html: buildEmailHtml({
      title: `Portal de pagos — ${data.empresa}`,
      previewText: `Revisa y paga tus cobros pendientes con ${data.empresa}.`,
      heading: `Hola ${escapeHtml(nombre)} 👋`,
      bodyLines: [
        `<strong>${escapeHtml(data.empresa)}</strong> habilitó un portal privado donde puedes ver tus cobros pendientes, revisar tu historial y pagar en línea de forma segura.`,
        `Ingresa con el botón de abajo. Este enlace es personal — no lo compartas.`,
      ],
      ctaText: "Ver mi portal de pagos",
      ctaUrl: data.url,
      footerNote: "Si no esperabas este correo, puedes ignorarlo.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending portal email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface WorkflowEmailData {
  emailPagador: string;
  clienteNombre: string | null;
  asunto: string;
  mensaje: string;
  monto: number;
  descripcion: string;
  comercioNombre: string;
  linkPago?: string | null;
  remitenteNombre?: string | null;
  remitenteEmail?: string | null;
}

// Sends a workflow-step email with an org-authored subject/body. The message is
// HTML-escaped (newlines → <br/>) so untrusted client data can't inject markup.
// A payment CTA is shown when a link exists, otherwise a "responder al cobro"
// mailto is offered (never routed to NextCob).
export async function sendWorkflowEmail(
  data: WorkflowEmailData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping workflow email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const montoFormato = formatCLP(data.monto);
  const nombre = data.clienteNombre || "cliente";
  const tieneLink = !!data.linkPago;
  const responderUrl = tieneLink
    ? null
    : buildResponderCobroMailto(data.remitenteEmail, data.descripcion);
  const cuerpo = escapeHtml(data.mensaje).replace(/\r?\n/g, "<br/>");
  const asunto = data.asunto?.replace(/[\r\n]/g, " ").trim() || `Cobro pendiente — ${data.comercioNombre}`;

  const { error } = await client.emails.send({
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
    to: [data.emailPagador],
    subject: asunto,
    html: buildEmailHtml({
      title: asunto,
      previewText: data.mensaje.replace(/\s+/g, " ").slice(0, 140),
      heading: `Hola ${escapeHtml(nombre)} 👋`,
      bodyLines: [
        cuerpo,
        `<span style="display:block;background:#f4f4f5;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;">
          <strong>Concepto:</strong> ${escapeHtml(data.descripcion)}<br/>
          <strong>Monto:</strong> <span style="font-family:monospace;font-weight:700;color:#2563eb;">${montoFormato}</span>
        </span>`,
      ],
      ctaText: tieneLink ? `Pagar ${montoFormato}` : responderUrl ? "Responder al cobro" : undefined,
      ctaUrl: tieneLink ? data.linkPago! : (responderUrl ?? undefined),
      footerNote: "Si ya realizaste el pago, ignora este mensaje.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending workflow email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export interface EncuestaEmailData {
  emailDestino: string;
  clienteNombre: string | null;
  empresa: string;
  descripcion: string;
  ctaUrl: string;
  /** Base URL for one-click answers; `?calificacion=N` is appended per option. */
  respuestaBaseUrl?: string;
  remitenteNombre?: string | null;
  remitenteEmail?: string | null;
}

// One-click survey options: each is a unique link that records the answer
// directly (calificacion 1..5) without any extra form.
const ENCUESTA_OPCIONES: { calificacion: number; emoji: string; label: string; color: string }[] = [
  { calificacion: 5, emoji: "👍", label: "Excelente", color: "#059669" },
  { calificacion: 4, emoji: "😊", label: "Buena", color: "#2563eb" },
  { calificacion: 3, emoji: "😐", label: "Regular", color: "#d97706" },
  { calificacion: 1, emoji: "👎", label: "Mala", color: "#dc2626" },
];

// Invites the client to rate their payment experience via a public 1-question survey.
export async function sendEncuestaEmail(
  data: EncuestaEmailData,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<EmailResult> {
  const client = getResend();
  if (!client) {
    log?.warn({}, "RESEND_API_KEY not set — skipping survey email");
    return { ok: false, error: "RESEND_API_KEY no está configurado." };
  }

  const nombre = data.clienteNombre || "cliente";
  const { error } = await client.emails.send({
    ...buildRemitente({ nombre: data.remitenteNombre, email: data.remitenteEmail }),
    to: [data.emailDestino],
    subject: `¿Cómo fue tu experiencia con ${data.empresa}?`,
    html: buildEmailHtml({
      title: `Tu opinión — ${data.empresa}`,
      previewText: `Cuéntanos cómo fue tu experiencia de pago con ${data.empresa}.`,
      heading: `Gracias por tu pago, ${escapeHtml(nombre)} 🙏`,
      bodyLines: [
        `<strong>${escapeHtml(data.empresa)}</strong> agradece tu pago del cobro por <strong>${escapeHtml(data.descripcion)}</strong>.`,
        `<strong>¿Cómo fue tu experiencia de pago?</strong> Haz clic en una opción — un solo clic registra tu respuesta:`,
        ...(data.respuestaBaseUrl
          ? [
              `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr>${ENCUESTA_OPCIONES.map(
                (o) =>
                  `<td align="center" style="padding:4px;"><a href="${data.respuestaBaseUrl}?calificacion=${o.calificacion}" target="_blank" style="display:inline-block;background:${o.color};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;padding:10px 12px;white-space:nowrap;">${o.emoji} ${o.label}</a></td>`,
              ).join("")}</tr></table>`,
            ]
          : [`Nos ayudaría mucho conocer tu opinión. Solo te tomará unos segundos calificar tu experiencia.`]),
      ],
      ...(data.respuestaBaseUrl
        ? {}
        : { ctaText: "Calificar mi experiencia", ctaUrl: data.ctaUrl }),
      footerNote: "Tu opinión es anónima para el equipo de cobranza y nos ayuda a mejorar.",
    }),
  });

  if (error) {
    const msg = `Resend error: ${error.name} — ${error.message}`;
    log?.warn({ resendError: error }, "Error sending survey email via Resend");
    return { ok: false, error: msg };
  }
  return { ok: true };
}
