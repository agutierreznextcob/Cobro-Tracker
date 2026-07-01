import crypto from "node:crypto";
import {
  db,
  cobrosTable,
  clientesTable,
  organizacionesTable,
  encuestasTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEncuestaEmail } from "./email";
import { getRemitenteContacto } from "./org";
import { getPublicBaseUrl } from "./flow-api";

interface Logger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

// Creates (idempotently) a post-payment satisfaction survey for a cobro and emails
// the client a public link to answer it. Called fire-and-forget when a cobro is
// paid; safe to call multiple times — the unique constraint on encuestas.cobroId
// plus onConflictDoNothing means at most one survey/email per cobro. Never throws.
export async function crearYEnviarEncuesta(cobroId: number, log?: Logger): Promise<void> {
  try {
    const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));
    if (!cobro) {
      log?.warn({ cobroId }, "crearYEnviarEncuesta: cobro not found");
      return;
    }

    // Resolve payer email + cliente name.
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
      })
      .onConflictDoNothing({ target: encuestasTable.cobroId })
      .returning({ token: encuestasTable.token });

    // A conflict means a survey already exists for this cobro — email was already
    // handled (or attempted). Do not send again.
    if (inserted.length === 0) {
      log?.info({ cobroId }, "Encuesta ya existía para el cobro, se omite envío");
      return;
    }

    if (!emailDestino) {
      log?.warn({ cobroId }, "Encuesta creada pero sin email destino — no se envía");
      return;
    }

    // Resolve the collecting business name.
    let empresa = cobro.responsableNombre ?? "NextCob";
    if (cobro.organizationId != null) {
      const [org] = await db
        .select({ nombre: organizacionesTable.nombre })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, cobro.organizationId));
      if (org?.nombre) empresa = org.nombre;
    }

    const remitente = await getRemitenteContacto(cobro.responsableId);
    const ctaUrl = `${getPublicBaseUrl()}/encuesta/${inserted[0]!.token}`;

    const result = await sendEncuestaEmail(
      {
        emailDestino,
        clienteNombre: clienteNombre || null,
        empresa,
        descripcion: cobro.descripcion,
        ctaUrl,
        remitenteNombre: remitente.nombre || cobro.responsableNombre,
        remitenteEmail: remitente.email,
      },
      log,
    );

    if (result.ok) {
      log?.info({ cobroId }, "Encuesta de satisfacción enviada");
    } else {
      log?.warn({ cobroId, error: result.error }, "No se pudo enviar la encuesta de satisfacción");
    }
  } catch (err) {
    log?.error({ err, cobroId }, "crearYEnviarEncuesta failed");
  }
}
