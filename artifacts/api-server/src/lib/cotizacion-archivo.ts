import { createHash, randomUUID } from "node:crypto";
import type { Cotizacion } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";
import { documentScope } from "./empresa";
import { cotizacionEmailMessage } from "./email";

const storage = new ObjectStorageService();
export type ArchivoCotizacion = NonNullable<Cotizacion["envioPdf"]>;
export const hashPdf = (pdf: Buffer) => createHash("sha256").update(pdf).digest("hex");

export async function guardarPdfCotizacion(q: Cotizacion, pdf: Buffer, email: ArchivoCotizacion["email"]): Promise<ArchivoCotizacion> {
  const scope = documentScope(q.organizationId, q.responsableId);
  const name = `cotizaciones/${randomUUID()}.pdf`;
  const full = `${storage.getPrivateObjectDir().replace(/\/$/, "")}/${name}`;
  const [bucket, ...parts] = full.replace(/^\//, "").split("/");
  const sha256 = hashPdf(pdf);
  await objectStorageClient.bucket(bucket).file(parts.join("/")).save(pdf, {
    resumable: false, contentType: "application/pdf", preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { metadata: { scope, cotizacionId: String(q.id), sha256 } },
  });
  return { path: `/objects/${name}`, sha256, bytes: pdf.length, scope, preparedAt: new Date().toISOString(), email, message: cotizacionEmailMessage(email) };
}

export async function leerPdfCotizacion(q: Cotizacion): Promise<Buffer> {
  const a = q.envioPdf;
  if (!a || a.scope !== documentScope(q.organizationId, q.responsableId) ||
      !/^\/objects\/cotizaciones\/[a-f0-9-]{36}\.pdf$/.test(a.path)) throw new Error("Archivo de cotización inválido.");
  const file = await storage.getObjectEntityFile(a.path);
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.scope !== a.scope || metadata.metadata?.cotizacionId !== String(q.id)) throw new Error("Archivo de otro negocio.");
  const [pdf] = await file.download();
  if (pdf.length !== a.bytes || hashPdf(pdf) !== a.sha256) throw new Error("El PDF guardado no supera la verificación de integridad.");
  return pdf;
}
