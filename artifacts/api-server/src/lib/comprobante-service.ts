import {
  db,
  cobrosTable,
  clientesTable,
  comprobantesTable,
  organizacionesTable,
} from "@workspace/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { generarComprobantePdf } from "./comprobante";
import { sendComprobanteEmail } from "./email";
import { getRemitenteContacto } from "./org";
import { crearYEnviarEncuesta } from "./encuestas-service";
import { crearNotificacion } from "./notificaciones-service";

interface Logger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

// How long a send-claim is considered active. A claim older than this is treated
// as orphaned (e.g. the worker crashed mid-send) and may be reclaimed for retry.
const CLAIM_TTL_MS = 5 * 60 * 1000;

const METODO_LABEL: Record<string, string> = {
  flow: "Flow (Webpay)",
  mp: "MercadoPago",
  mercadopago: "MercadoPago",
  manual: "Pago manual",
};

function metodoLabel(metodo: string): string {
  return METODO_LABEL[metodo.toLowerCase()] ?? metodo;
}

// Generates and emails the payment receipt (comprobante) for a cobro that just
// transitioned to `pagado`. Idempotent on cobroId: the unique constraint on
// comprobantes.cobro_id plus onConflictDoNothing means concurrent callers (e.g.
// a webhook and a manual PATCH) produce at most one receipt and one email.
// Designed to be called fire-and-forget; it never throws.
export async function emitirComprobante(
  cobroId: number,
  opts: { metodo: string; referencia?: string | null },
  log?: Logger,
): Promise<void> {
  try {
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.id, cobroId));
    if (!cobro) {
      log?.warn({ cobroId }, "emitirComprobante: cobro not found");
      return;
    }

    // Hard guard: the comprobante (and its companion satisfaction survey) are
    // strictly "al pagar" actions. Never emit a receipt or survey for a cobro that
    // is not fully paid — doing so for a pendiente/parcial cobro is a financial
    // correctness bug. This also makes the fire-and-forget callers (webhooks,
    // manual mark-paid, workflow cambiar_estado→pagado) safe by construction.
    if (cobro.estado !== "pagado") {
      log?.warn({ cobroId, estado: cobro.estado }, "emitirComprobante: cobro no está pagado, se omite");
      return;
    }

    // A paid cobro also triggers the post-payment satisfaction survey. Fire-and-
    // forget and idempotent (unique on encuestas.cobroId), so it runs at most once
    // per cobro across every paid path (manual, abono, webhook, workflow).
    void crearYEnviarEncuesta(cobro.id, log);

    const montoDescuento = Number(cobro.montoDescuento ?? 0);
    const montoTotal = Number(cobro.monto) - montoDescuento;
    // Only show the neto/IVA breakdown when there is no discount, otherwise the
    // stored breakdown would not add up to the actually-paid amount.
    const sinDescuento = montoDescuento === 0;
    const montoNeto =
      cobro.incluyeIva && sinDescuento && cobro.montoNeto != null
        ? Number(cobro.montoNeto)
        : null;
    const montoIva =
      cobro.incluyeIva && sinDescuento && cobro.montoIva != null
        ? Number(cobro.montoIva)
        : null;

    // Resolve the payer email and cliente name.
    let clienteNombre = cobro.clienteNombre ?? "";
    let clienteEmail: string | null = null;
    if (cobro.clienteId != null) {
      const [cliente] = await db
        .select({ nombre: clientesTable.nombre, email: clientesTable.email })
        .from(clientesTable)
        .where(eq(clientesTable.id, cobro.clienteId));
      if (cliente) {
        clienteNombre = cliente.nombre || clienteNombre;
        clienteEmail = cliente.email ?? null;
      }
    }
    const emailDestino = cobro.emailPagador || clienteEmail;

    // Resolve the collecting business (organization) name.
    let empresa = cobro.responsableNombre ?? "NextCob";
    if (cobro.organizationId != null) {
      const [org] = await db
        .select({ nombre: organizacionesTable.nombre })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, cobro.organizationId));
      if (org?.nombre) empresa = org.nombre;
    }

    const numeroNuevo = `CMP-${new Date().getFullYear()}-${String(cobro.id).padStart(6, "0")}`;

    // Ensure the receipt row exists (idempotency anchor). The unique constraint on
    // cobro_id means at most one row per cobro; concurrent callers converge here.
    await db
      .insert(comprobantesTable)
      .values({
        cobroId: cobro.id,
        numero: numeroNuevo,
        metodoPago: metodoLabel(opts.metodo),
        montoPagado: String(montoTotal),
        montoNeto: montoNeto != null ? String(montoNeto) : null,
        montoIva: montoIva != null ? String(montoIva) : null,
        emailDestino: emailDestino ?? null,
        emailEnviado: false,
      })
      .onConflictDoNothing({ target: comprobantesTable.cobroId });

    // Without a deliverable address there is nothing to send. Leave the row with
    // emailEnviado=false so a later trigger (once the cliente has an email) retries.
    if (!emailDestino) {
      log?.warn({ cobroId }, "Comprobante created but no email destino — not sent");
      return;
    }

    // Atomically claim the send by stamping emailIntentoEn in a single UPDATE.
    // A caller wins only when the receipt is not yet sent AND no fresh attempt is
    // in flight (emailIntentoEn null or older than the TTL). This both prevents
    // duplicate emails from near-simultaneous triggers (retried webhooks + manual
    // mark-paid) and lets a later trigger reclaim an orphaned attempt left behind
    // by a crash/exception after a claim. emailEnviado=true is the final success
    // state set only after the email is actually delivered.
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
    const claim = await db
      .update(comprobantesTable)
      .set({ emailIntentoEn: new Date() })
      .where(
        and(
          eq(comprobantesTable.cobroId, cobro.id),
          eq(comprobantesTable.emailEnviado, false),
          or(
            isNull(comprobantesTable.emailIntentoEn),
            lt(comprobantesTable.emailIntentoEn, staleBefore),
          ),
        ),
      )
      .returning({ numero: comprobantesTable.numero });

    if (claim.length === 0) {
      log?.info({ cobroId }, "Comprobante already sent or send in progress, skipping");
      return;
    }
    const numero = claim[0]!.numero;

    const remitente = await getRemitenteContacto(cobro.responsableId);
    const quienCobra = cobro.responsableNombre || remitente.nombre || empresa;

    const pdf = await generarComprobantePdf({
      moneda: cobro.moneda, decimales: cobro.decimales, porcentajeIva: Number(cobro.porcentajeIva),
      numero,
      fecha: new Date(),
      clienteNombre: clienteNombre || "Cliente",
      quienCobra,
      empresa,
      descripcion: cobro.descripcion,
      metodoPago: metodoLabel(opts.metodo),
      referencia: opts.referencia ?? cobro.referencia ?? null,
      montoTotal,
      montoNeto,
      montoIva,
    });

    const result = await sendComprobanteEmail(
      {
        moneda: cobro.moneda, decimales: cobro.decimales,
        emailDestino,
        clienteNombre: clienteNombre || "Cliente",
        empresa,
        numero,
        montoTotal,
        descripcion: cobro.descripcion,
        metodoPago: metodoLabel(opts.metodo),
        pdf,
        remitenteNombre: remitente.nombre,
        remitenteEmail: remitente.email,
      },
      log,
    );

    if (result.ok) {
      // Mark the final success state. The claim (emailIntentoEn) stays set.
      const emailEnviadoEn = new Date();
      await db
        .update(comprobantesTable)
        .set({ emailEnviado: true, emailEnviadoEn })
        .where(eq(comprobantesTable.cobroId, cobro.id));
      if (cobro.responsableId) {
        await crearNotificacion({
          eventKey: `comprobante:${cobro.id}:email`,
          userId: cobro.responsableId,
          cobroId: cobro.id,
          tipo: "comprobante",
          titulo: `📄 Comprobante enviado a ${cobro.clienteNombre || "Cliente"}`,
          mensaje: `El comprobante ${numero} fue enviado por email.`,
          creadoEn: emailEnviadoEn,
        });
      }
      log?.info({ cobroId, numero }, "Comprobante sent");
    } else {
      // Release the claim immediately so a subsequent trigger (or webhook retry)
      // can re-send without waiting for the TTL to expire.
      await db
        .update(comprobantesTable)
        .set({ emailIntentoEn: null })
        .where(eq(comprobantesTable.cobroId, cobro.id));
      log?.warn({ cobroId, error: result.error }, "Comprobante email failed — claim released for retry");
    }
  } catch (err) {
    log?.error({ err, cobroId }, "emitirComprobante failed");
  }
}
