import { Pool, pool } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "../src/lib/objectStorage";
import { cleanupEmpresaLogos } from "../src/lib/empresaLogoCleanup";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readLogoCursor, writeLogoCursor } from "../src/lib/empresaLogoCursor";
import { createEmpresaLogoStorage } from "../src/lib/empresaLogoStorage";

const pools: InstanceType<typeof Pool>[] = [];
const clients: Awaited<ReturnType<InstanceType<typeof Pool>["connect"]>>[] = [];
try {
  const args = process.argv.slice(2);
  const allowed = new Set(["--apply", "--confirm-all-databases", "--confirm-coordinated-writers"]);
  if (args.some(arg => !allowed.has(arg))) throw new Error("Unknown argument.");
  if (!args.includes("--confirm-all-databases") || !args.includes("--confirm-coordinated-writers")) {
    throw new Error("Requires --confirm-all-databases and --confirm-coordinated-writers; read docs/empresa-logo-cleanup.md first.");
  }
  // Names only, never connection strings on the command line or in reports.
  const names: unknown = JSON.parse(process.env.LOGO_CLEANUP_DATABASE_ENVS ?? "[]");
  if (!Array.isArray(names) || names.length < 1 || names.length > 10 ||
    names.some(name => typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name)) ||
    new Set(names).size !== names.length) throw new Error("Set LOGO_CLEANUP_DATABASE_ENVS to the complete list of connection-secret names.");
  const connections = names.map(name => process.env[name]);
  if (connections.some(value => !value) || new Set(connections).size !== connections.length) {
    throw new Error("Missing or duplicate database connection.");
  }
  for (const connectionString of connections) {
    const p = new Pool({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    pools.push(p);
    clients.push(await p.connect());
  }
  const root = new ObjectStorageService().getPrivateObjectDir().replace(/^\/|\/$/g, "");
  const [bucket, ...prefix] = root.split("/");
  if (!bucket || !prefix.length) throw new Error("Invalid private storage root.");
  const apply = args.includes("--apply");
  // Independent dry-run/apply progress, scoped to the storage root and database
  // inventory. Names only; no credentials stored in the progress file.
  const key = createHash("sha256").update(JSON.stringify([root, [...names].sort(), apply])).digest("hex");
  const cursorFile = fileURLToPath(new URL(`../../../generated-artifacts/logo-cleanup/${key}.json`, import.meta.url));
  const afterPath = await readLogoCursor(cursorFile);
  const report = await cleanupEmpresaLogos(clients, createEmpresaLogoStorage(objectStorageClient, root), { apply, afterPath });
  // Persist only a completely successful batch; failures retry the same page.
  const nextCursor = await writeLogoCursor(cursorFile, report);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", report, nextCursor }, null, 2));
} catch (error) {
  // Driver errors may contain connection details; never dump the raw exception.
  console.error(error instanceof Error && !("code" in error) ? error.message : "Cleanup stopped safely; verify database/storage access.");
  process.exitCode = 1;
} finally {
  clients.forEach(client => client.release());
  await Promise.all([...pools, pool].map(p => p.end()));
}
