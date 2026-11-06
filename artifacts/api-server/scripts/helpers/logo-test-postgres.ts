import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const exec = promisify(execFile);
const { Pool } = createRequire(new URL("../../../../lib/db/package.json", import.meta.url))("pg");

// Never connects to DATABASE_URL. A private Unix socket avoids both external
// databases and TCP port conflicts; initdb/pg_ctl must be available locally.
export async function temporaryLogoPostgres() {
  const root = await mkdtemp(join(tmpdir(), "logo-pg-"));
  const data = join(root, "data");
  const pools: any[] = [];
  let started = false;
  const close = async () => {
    try {
      await Promise.all(pools.map(pool => pool.end()));
    } finally {
      try {
        if (started) await exec("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  };
  try {
    await exec("initdb", ["-D", data, "-A", "trust", "-U", "logo_test", "--no-locale"]);
    await exec("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"),
      "-o", `-k ${root} -h '' -F`, "-w", "start"]);
    started = true;
    const pool = (database: string) => {
      const result = new Pool({ host: root, user: "logo_test", database,
        connectionTimeoutMillis: 3000, options: "-c statement_timeout=5000 -c lock_timeout=3000" });
      pools.push(result);
      return result;
    };
    const admin = pool("postgres");
    for (const name of ["logos_a", "logos_b"]) await admin.query(`CREATE DATABASE ${name}`);
    const databases = [pool("logos_a"), pool("logos_b")];
    for (const db of databases) {
      await db.query(`
        CREATE TABLE empresas (scope text PRIMARY KEY, perfil jsonb NOT NULL DEFAULT '{}',
          actualizado_en timestamptz NOT NULL DEFAULT now());
        CREATE TABLE empresa_uploads (object_path text PRIMARY KEY, scope text NOT NULL,
          creado_en timestamptz NOT NULL DEFAULT now());
      `);
    }
    const url = new URL("postgresql://logo_test@localhost/logos_a");
    url.searchParams.set("host", root);
    url.searchParams.set("options", "-c statement_timeout=5000 -c lock_timeout=3000");
    return { databases, url: url.toString(), close };
  } catch (error) {
    await close();
    throw error;
  }
}
