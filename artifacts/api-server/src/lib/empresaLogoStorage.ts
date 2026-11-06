import type { Storage } from "@google-cloud/storage";
import type { LogoStorage } from "./empresaLogoCleanup";

/** Shared by the maintenance CLI and the opt-in real-storage check. */
export function createEmpresaLogoStorage(client: Storage, root: string): LogoStorage {
  const [bucket, ...prefix] = root.replace(/^\/|\/$/g, "").split("/");
  if (!bucket || !prefix.length) throw new Error("Invalid private storage root.");
  const file = (path: string) => client.bucket(bucket).file(`${prefix.join("/")}/${path.slice("/objects/".length)}`);
  return {
    async inspect(path) {
      try {
        const [meta] = await file(path).getMetadata();
        if (!meta.generation || !meta.updated) throw new Error("Missing storage metadata.");
        return { generation: String(meta.generation), updatedAt: new Date(meta.updated) };
      } catch (error) {
        if ((error as { code?: number }).code === 404) return null;
        throw error;
      }
    },
    async remove(path, generation) {
      try { await file(path).delete({ ifGenerationMatch: generation }); }
      catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
    },
  };
}
