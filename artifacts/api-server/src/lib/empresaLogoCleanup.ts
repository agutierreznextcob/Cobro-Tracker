import { LOGO_LOCK, LOGO_GRACE_MS, LOGO_URL_TTL_MS, eligibleLogo, type LogoCandidate } from "./empresaLogoLifecycle";

// Minimal adapters let tests exercise the real coordinator without storage.
export interface LogoDatabase {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
}
export interface LogoStorage {
  inspect(path: string): Promise<{ generation: string; updatedAt: Date } | null>;
  remove(path: string, generation: string): Promise<void>;
}
export async function cleanupEmpresaLogos(
  databases: LogoDatabase[], storage: LogoStorage,
  options: { apply?: boolean; limit?: number; now?: Date; afterPath?: string | null } = {},
) {
  const limit = options.limit ?? 50;
  if (!databases.length || databases.length > 10) throw new Error("Provide every database sharing this storage (1–10).");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be 1–100.");
  const now = options.now ?? new Date();
  const opened: LogoDatabase[] = [];
  const report: { path: string; status: string }[] = [];
  try {
    // No destructive action until ALL databases are reachable and locked.
    // Try-lock avoids deadlocks between maintenance processes with different orders.
    for (const database of databases) {
      await database.query("BEGIN");
      opened.push(database);
      const lock = await database.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [LOGO_LOCK]);
      if (!lock.rows[0]?.locked) throw new Error("Logo writer/cleanup active; retry later.");
    }
    const candidates = new Map<string, LogoCandidate>();
    for (const database of databases) {
      const result = await database.query(`
        SELECT u.object_path, u.creado_en FROM empresa_uploads u
        WHERE u.creado_en < $1 AND u.object_path COLLATE "C" > $3 AND NOT EXISTS
          (SELECT 1 FROM empresas e WHERE e.perfil->>'logoPath' = u.object_path)
        ORDER BY u.object_path COLLATE "C" LIMIT $2`,
      [new Date(now.getTime() - LOGO_GRACE_MS - LOGO_URL_TTL_MS), limit, options.afterPath ?? ""]);
      for (const row of result.rows) candidates.set(row.object_path, { objectPath: row.object_path, touchedAt: new Date(row.creado_en) });
    }
    // Globally merge the per-database pages before applying the work budget.
    // A cursor advances even past protected entries; an empty page wraps around.
    const page = [...candidates.values()].sort((a, b) => a.objectPath < b.objectPath ? -1 : a.objectPath > b.objectPath ? 1 : 0).slice(0, limit);
    for (const candidate of page) {
      const references = new Set<string>();
      // Recheck recent uploads/retirements and active references in EVERY DB,
      // including ones too recent to appear in the initial candidate query.
      for (const database of databases) {
        const refs = await database.query("SELECT scope FROM empresas WHERE perfil->>'logoPath' = $1 LIMIT 1", [candidate.objectPath]);
        if (refs.rows.length) references.add(candidate.objectPath);
        const touches = await database.query("SELECT creado_en FROM empresa_uploads WHERE object_path = $1", [candidate.objectPath]);
        for (const row of touches.rows) {
          const touch = new Date(row.creado_en);
          if (!Number.isFinite(touch.getTime())) throw new Error("Invalid lifecycle timestamp.");
          if (touch > candidate.touchedAt) candidate.touchedAt = touch;
        }
      }
      if (!eligibleLogo(candidate, references, now)) {
        report.push({ path: candidate.objectPath, status: "protected" }); continue;
      }
      const object = await storage.inspect(candidate.objectPath);
      if (object && (!Number.isFinite(object.updatedAt.getTime()) ||
        now.getTime() - object.updatedAt.getTime() < LOGO_GRACE_MS)) {
        report.push({ path: candidate.objectPath, status: "recent-object" }); continue;
      }
      if (!options.apply) {
        report.push({ path: candidate.objectPath, status: object ? "would-delete" : "already-missing" }); continue;
      }
      // Generation precondition fails closed if a direct upload replaced it.
      if (object) await storage.remove(candidate.objectPath, object.generation);
      for (const database of databases) {
        await database.query("DELETE FROM empresa_uploads WHERE object_path = $1", [candidate.objectPath]);
      }
      report.push({ path: candidate.objectPath, status: object ? "deleted" : "already-missing" });
    }
    for (const database of opened) await database.query(options.apply ? "COMMIT" : "ROLLBACK");
    return report;
  } finally {
    // Also handles partial commits or a storage failure: missing objects are
    // safe to retry, but references can never be introduced under these locks.
    await Promise.all(opened.map(database => database.query("ROLLBACK").catch(() => undefined)));
  }
}
