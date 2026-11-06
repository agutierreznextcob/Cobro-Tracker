import { createHash } from "node:crypto";
import sharp from "sharp";
import { db, pool, empresasTable, empresaUploadsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { SaveEmpresaBody, type Empresa } from "@workspace/api-zod";
import { preferenciasScope } from "./preferencias";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";
import { LOGO_LOCK } from "./empresaLogoLifecycle";

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
async function withLogoLock<T>(work: (connection: NodePgDatabase) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    // Pin ONE connection for the whole operation, including the committed
    // ledger write. Never ask the pool for another while holding this lock.
    await client.query("SELECT pg_advisory_lock($1)", [LOGO_LOCK]);
    return await work(drizzle(client));
  } finally {
    try { await client.query("SELECT pg_advisory_unlock($1)", [LOGO_LOCK]); }
    catch { discard = true; }
    // A connection whose unlock failed must never reenter the pool.
    client.release(discard);
  }
}
async function normalizeEmpresaLogo(connection: NodePgDatabase, scope: string, path: string) {
  if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/.test(path)) throw new EmpresaError("Carga un nuevo logo.");
  const [upload] = await connection.select().from(empresaUploadsTable).where(and(eq(empresaUploadsTable.objectPath, path), eq(empresaUploadsTable.scope, scope)));
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
  // Durable before writing bytes: a failed profile transaction still leaves a
  // cleanup record. The caller holds LOGO_LOCK until the profile is committed.
  await connection.insert(empresaUploadsTable).values({ scope, objectPath: finalPath })
    .onConflictDoUpdate({ target: empresaUploadsTable.objectPath, set: { creadoEn: new Date() } });
  await objectStorageClient.bucket(bucket).file(parts.join("/")).save(png, { resumable: false, contentType: "image/png" });
  return finalPath;
}
export async function saveEmpresa(scope: string, perfil: Empresa) {
  return withLogoLock(async (connection) => {
    const [row] = await connection.select().from(empresasTable).where(eq(empresasTable.scope, scope));
    const current = SaveEmpresaBody.parse({ ...empresaDefault, ...row?.perfil });
    if (perfil.logoPath && perfil.logoPath !== current.logoPath) {
      perfil.logoPath = await normalizeEmpresaLogo(connection, scope, perfil.logoPath);
    }
    await connection.transaction(async (tx) => {
      if (current.logoPath && current.logoPath !== perfil.logoPath) {
        // Start the grace period at retirement, not the original upload date.
        // Untracked historical files remain untracked and are never swept.
        await tx.update(empresaUploadsTable).set({ creadoEn: new Date() })
          .where(eq(empresaUploadsTable.objectPath, current.logoPath));
      }
      await tx.insert(empresasTable).values({ scope, perfil: { ...perfil } })
        .onConflictDoUpdate({ target: empresasTable.scope, set: { perfil: { ...perfil }, actualizadoEn: new Date() } });
    });
    return perfil;
  });
}
export async function getEmpresaLogoBytes(empresa: Empresa) {
  if (!empresa.logoPath) return null;
  if (!/^\/objects\/empresas\/[a-f0-9]{64}\.png$/.test(empresa.logoPath)) throw new EmpresaError("El logo guardado no es válido.");
  return readLimited(empresa.logoPath, 8 * 1024 * 1024);
}
export async function requestLogoUpload(scope: string) {
  return withLogoLock(async (connection) => {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    await connection.insert(empresaUploadsTable).values({ scope, objectPath });
    return { uploadURL, objectPath };
  });
}
