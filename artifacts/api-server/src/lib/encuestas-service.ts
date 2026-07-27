import crypto from "node:crypto";
import {
  db,
  cobrosTable,
  clientesTable,
  organizacionesTable,
  encuestasTable,
} from "@workspace/db";
import { and, eq, isNull, lte, or, lt, sql } from "drizzle-orm";
import { sendEncuestaEmail } from "./email";
import { getRemitenteContacto } from "./org";
import { getPublicBaseUrl } from "./flow-api";

interface Logger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

// The survey email goes out ~1 hour after payment so the client is not hit with
// the receipt and the survey at the same time.
const ENVIO_DELAY_MS = 60 * 60 * 1000;
// A send-claim older than this is treated as orphaned and may be retried.
const CLAIM_TTL_MS = 5 * 60 * 1000;
// Give up after this many failed send attempts (permanent failures like an
// invalid address would otherwise retry forever).
const MAX_INTENTOS = 5;
// Terminal marker: the survey should never be sent (e.g. cobro no longer paid).
const INTENTOS_TERMINAL = 999;

// Creates (idempotently) a post-payment satisfaction survey for a cobro, scheduled
// to be emailed ~1h later by procesarEncuestasPendientes. Called fire-and-forget
// when a cobro is paid; safe to call multiple times — the unique constraint on
// encuestas.cobroId plus onConflictDoNothing means at most one survey per cobro.
// Never throws.
export async function crearYEnviarEncuesta(cobroId: number, log?: Logger): Promise<void> {
  try {
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));
    if (!cobro) {
      log?.warn({ cobroId }, "crearYEnviarEncuesta: cobro not found");
      return;
    }

    let clienteNombre = cobro.clienteNombre ?? "";
    if (cobro.clienteId != null) {
      const [cliente] = await db
        .select({ nombre: clientesTable.nombre })
        .from(clientesTable)
        .where(eq(clientesTable.id, cobro.clienteId));
      if (cliente?.nombre) clienteNombre = cliente.nombre;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const inserted = await db
      .insert(encuestasTable)
      .values({
        cobroId: cobro.id,
        organizationId: cobro.organizationId ?? null,
        userId: cobro.responsableId ?? null,
        clienteId: cobro.clienteId ?? null,
        clienteNombre: clienteNombre || null,
        token,
        enviarEn: new Date(Date.now() + ENVIO_DELAY_MS),
      })
      .onConflictDoNothing({ target: encuestasTable.cobroId })
      .returning({ id: encuestasTable.id });

    if (inserted.length === 0) {
      log?.info({ cobroId }, "Encuesta ya existía para el cobro, se omite");
      return;
    }
    log?.info({ cobroId }, "Encuesta de satisfacción programada (envío en ~1 hora)");
  } catch (err) {
    log?.error({ err, cobroId }, "crearYEnviarEncuesta failed");
  }
}

// Sends the survey emails whose scheduled time has arrived. Idempotent and
// retry-safe: emailEnviadoEn is set only on success; emailIntentoEn is a claim
// with a TTL so concurrent sweeps (or a crash mid-send) don't duplicate emails.
// Designed to run periodically from the scheduler; never throws.
export async function procesarEncuestasPendientes(log?: Logger): Promise<void> {
  try {
    const now = new Date();
    const staleClaim = new Date(now.getTime() - CLAIM_TTL_MS);
    // Claim due surveys atomically.
    const claimed = await db
      .update(encuestasTable)
      .set({ emailIntentoEn: now })
      .where(
        and(
          isNull(encuestasTable.emailEnviadoEn),
          isNull(encuestasTable.respondidoEn),
          lte(encuestasTable.enviarEn, now),
          lt(encuestasTable.emailIntentos, MAX_INTENTOS),
          or(isNull(encuestasTable.emailIntentoEn), lt(encuestasTable.emailIntentoEn, staleClaim)),
        ),
      )
      .returning();

    for (const encuesta of claimed) {
      try {
        const [cobro] = await db
          .select()
          .from(cobrosTable)
          .where(eq(cobrosTable.id, encuesta.cobroId));
        // Solo se encuesta a cobros que siguen pagados (p. ej. no reembolsados).
        if (!cobro || cobro.estado !== "pagado") {
          // Terminal: never send a survey for a cobro that is no longer paid.
          await db
            .update(encuestasTable)
            .set({ emailIntentos: INTENTOS_TERMINAL })
            .where(eq(encuestasTable.id, encuesta.id));
          log?.info({ cobroId: encuesta.cobroId }, "Encuesta cerrada: cobro ya no está pagado");
          continue;
        }

        let clienteEmail: string | null = null;
        if (cobro.clienteId != null) {
          const [cliente] = await db
            .select({ email: clientesTable.email })
            .from(clientesTable)
            .where(eq(clientesTable.id, cobro.clienteId));
          clienteEmail = cliente?.email ?? null;
        }
        const emailDestino = cobro.emailPagador || clienteEmail;
        if (!emailDestino) {
          await db
            .update(encuestasTable)
            .set({ emailIntentos: INTENTOS_TERMINAL })
            .where(eq(encuestasTable.id, encuesta.id));
          log?.warn({ cobroId: cobro.id }, "Encuesta cerrada: sin email destino");
          continue;
        }

        let empresa = cobro.responsableNombre ?? "NextCob";
        if (cobro.organizationId != null) {
          const [org] = await db
            .select({ nombre: organizacionesTable.nombre })
            .from(organizacionesTable)
            .where(eq(organizacionesTable.id, cobro.organizationId));
          if (org?.nombre) empresa = org.nombre;
        }

        const remitente = await getRemitenteContacto(cobro.responsableId);
        const base = getPublicBaseUrl();
        const result = await sendEncuestaEmail(
          {
            emailDestino,
            clienteNombre: encuesta.clienteNombre,
            empresa,
            descripcion: cobro.descripcion,
            ctaUrl: `${base}/encuesta/${encuesta.token}`,
            respuestaBaseUrl: `${base}/api/encuestas/${encuesta.token}/responder`,
            remitenteNombre: remitente.nombre || cobro.responsableNombre,
            remitenteEmail: remitente.email,
          },
          log,
        );

        if (result.ok) {
          await db
            .update(encuestasTable)
            .set({ emailEnviadoEn: new Date() })
            .where(eq(encuestasTable.id, encuesta.id));
          log?.info({ cobroId: cobro.id }, "Encuesta de satisfacción enviada");
        } else {
          // Count the failure and release the claim; after MAX_INTENTOS the
          // sweep stops picking this survey up.
          await db
            .update(encuestasTable)
            .set({
              emailIntentoEn: sql`null`,
              emailIntentos: sql`${encuestasTable.emailIntentos} + 1`,
            })
            .where(eq(encuestasTable.id, encuesta.id));
          log?.warn(
            { cobroId: cobro.id, error: result.error, intento: encuesta.emailIntentos + 1 },
            "No se pudo enviar la encuesta de satisfacción — se reintentará",
          );
        }
      } catch (err) {
        log?.error({ err, encuestaId: encuesta.id }, "Error enviando encuesta pendiente");
      }
    }
  } catch (err) {
    log?.error({ err }, "procesarEncuestasPendientes failed");
  }
}
