import { createHash } from "node:crypto";
import sharp from "sharp";
import { db, empresasTable, empresaUploadsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { SaveEmpresaBody, type Empresa } from "@workspace/api-zod";
import { preferenciasScope } from "./preferencias";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";

export const empresaDefault: Empresa = {
  razonSocial: "", rut: "", giro: "", direccion: "", ciudad: "", telefono: "", email: "",
  sitioWeb: "", piePagina: "", condicionesPago: "", validezDias: 30,
  colorPrimario: "#2563EB", plantilla: "clasica", logoPath: null,
};
export class EmpresaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function getEmpresaForScope(scope: string): Promise<Empresa> {
  const [row] = await db.select().from(empresasTable).where(eq(empresasTable.scope, scope));
  return SaveEmpresaBody.parse({ ...empresaDefault, ...row?.perfil });
}
export async function getEmpresaForUser(userId: string) {
  return getEmpresaForScope((await preferenciasScope(userId)).scope);
}
export function documentScope(organizationId: number | null, ownerId: string) {
  // Use the document's stored tenant, not whichever org the owner joined later.
  return organizationId == null ? `user:${ownerId}` : `org:${organizationId}`;
}
export function formatEmpresaRut(input: string) {
  const clean = input.replace(/[.\s-]/g, "").toUpperCase();
  if (!clean) return "";
  if (!/^\d{7,8}[0-9K]$/.test(clean)) throw new EmpresaError("Ingresa un RUT con 7 u 8 dígitos y dígito verificador.");
  return `${clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${clean.slice(-1)}`;
}
export function validateEmpresa(input: unknown): Empresa {
  const parsed = SaveEmpresaBody.safeParse(input);
  if (!parsed.success) throw new EmpresaError("Revisa los campos del perfil de empresa.");
  const p = parsed.data;
  p.rut = formatEmpresaRut(p.rut);
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new EmpresaError("El email de contacto no es válido.");
  if (p.sitioWeb) {
    try { const u = new URL(p.sitioWeb); if (!["http:", "https:"].includes(u.protocol)) throw Error(); }
    catch { throw new EmpresaError("El sitio web debe comenzar con https:// o http://."); }
  }
  return p;
}
const storage = new ObjectStorageService();
async function readLimited(path: string, limit: number) {
  const file = await storage.getObjectEntityFile(path);
  const stream = file.createReadStream();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > limit) { stream.destroy(); throw new EmpresaError("El logo supera el tamaño permitido."); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function normalizeEmpresaLogo(scope: string, path: string) {
  if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/.test(path)) throw new EmpresaError("Carga un nuevo logo.");
  const [upload] = await db.select().from(empresaUploadsTable).where(and(eq(empresaUploadsTable.objectPath, path), eq(empresaUploadsTable.scope, scope)));
  if (!upload) throw new EmpresaError("El logo no pertenece a este negocio.", 403);
  const bytes = await readLimited(path, 2 * 1024 * 1024);
  let png: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false, failOn: "warning" });
    const meta = await image.metadata();
    if (!["jpeg", "png"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw Error();
    png = await image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  } catch { throw new EmpresaError("El archivo debe ser una imagen JPG o PNG válida (máximo 16 megapíxeles)."); }
  // Copy validated bytes into an immutable, non-presigned location. Reusing the
  // original upload URL cannot change a saved logo after validation.
  const hash = createHash("sha256").update(scope).update(png).digest("hex");
  const finalPath = `/objects/empresas/${hash}.png`;
  const full = `${storage.getPrivateObjectDir().replace(/\/$/, "")}/empresas/${hash}.png`;
  const [bucket, ...parts] = full.replace(/^\//, "").split("/");
  await objectStorageClient.bucket(bucket).file(parts.join("/")).save(png, { resumable: false, contentType: "image/png" });
  return finalPath;
}
export async function getEmpresaLogoBytes(empresa: Empresa) {
  if (!empresa.logoPath) return null;
  if (!/^\/objects\/empresas\/[a-f0-9]{64}\.png$/.test(empresa.logoPath)) throw new EmpresaError("El logo guardado no es válido.");
  return readLimited(empresa.logoPath, 8 * 1024 * 1024);
}
export async function requestLogoUpload(scope: string) {
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  await db.insert(empresaUploadsTable).values({ scope, objectPath });
  return { uploadURL, objectPath };
}
