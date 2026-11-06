/**
 * Opt-in only. Real GCS, real SQL in an isolated schema, no application boot.
 * Never runs maintenance with the normal database search_path/storage root.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--live")) {
  console.log("SKIP: almacenamiento real desactivado; usar --live.");
  process.exit(0);
}
if (process.argv.slice(2).some(arg => arg !== "--live")) throw new Error("Unknown argument");

let stage = "setup";
async function main() {
  assert.ok(!process.env.STORAGE_EMULATOR_HOST, "This check requires real GCS, not an emulator");
  const { Pool, pool } = await import("@workspace/db");
  const { Storage } = await import("@google-cloud/storage");
  const { ObjectStorageService, objectStorageClient } = await import("../src/lib/objectStorage");
  const { createEmpresaLogoStorage } = await import("../src/lib/empresaLogoStorage");
  const { cleanupEmpresaLogos } = await import("../src/lib/empresaLogoCleanup");
  const { LOGO_GRACE_MS } = await import("../src/lib/empresaLogoLifecycle");
  const run = randomUUID();
  console.log(`Run ${run}: solo registros y objetos sintéticos.`);
  const schema = `logo_test_${run.replaceAll("-", "")}`;
  const original = new ObjectStorageService().getPrivateObjectDir().replace(/\/+$/, "");
  assert.match(original, /^\/[^/]+\/.+/);
  const root = `${original}/integration-tests/logo-cleanup/${run}`;
  const [bucket, ...segments] = root.slice(1).split("/");
  const prefix = segments.join("/");
  const storage = createEmpresaLogoStorage(objectStorageClient, root);
  // Explicit custom endpoint disables SDK authentication: real GCS denies the
  // request, without changing IAM or removing access from the normal client.
  const anonymous = createEmpresaLogoStorage(new Storage({
    // SDK compares before stripping the slash; the default URL without it
    // would still attempt ADC, ignoring useAuthWithCustomEndpoint.
    apiEndpoint: "https://storage.googleapis.com/", useAuthWithCustomEndpoint: false,
    projectId: "integration-anonymous",
    retryOptions: { autoRetry: false },
  }), root);
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let db: Awaited<ReturnType<typeof admin.connect>> | undefined;
  let createdSchema = false;
  const paths = new Set<string>();
  const cursors: string[] = [];
  const now = new Date(Date.now() + 2 * LOGO_GRACE_MS);
  const old = new Date(Date.now() - 2 * LOGO_GRACE_MS);
  const file = (path: string) => {
    assert.ok(paths.has(path), "Refuse non-fixture path");
    return objectStorageClient.bucket(bucket).file(`${prefix}/${path.slice("/objects/".length)}`);
  };
  const codeIs = (code: number) => (e: unknown) => Number((e as { code?: unknown }).code) === code;
  const deniedAccess = (e: unknown) => {
    const code = Number((e as { code?: unknown }).code);
    console.log(`Access-denial response: HTTP ${code}`);
    assert.ok(code === 401 || code === 403, `Expected real access denial; HTTP ${code}`);
    return true;
  };
  async function fixture() {
    const path = `/objects/uploads/${randomUUID()}`;
    paths.add(path);
    await file(path).save(Buffer.from(`synthetic-logo-${run}`), {
      resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "application/octet-stream", metadata: { integrationRun: run } },
    });
    await db!.query("INSERT INTO empresa_uploads VALUES ($1, $2)", [path, old]);
    return path;
  }
  async function rows() {
    return (await db!.query("SELECT * FROM empresa_uploads ORDER BY object_path")).rows;
  }
  async function cli(apply: boolean) {
    const connection = new URL(process.env.DATABASE_URL!);
    // No public fallback: even a missing test table cannot select real records.
    connection.searchParams.set("options", `-c search_path=${schema}`);
    const names = ["LOGO_TEST_DATABASE_URL"];
    const key = createHash("sha256").update(JSON.stringify([root.slice(1), names, apply])).digest("hex");
    cursors.push(fileURLToPath(new URL(`../../../generated-artifacts/logo-cleanup/${key}.json`, import.meta.url)));
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv,
        fileURLToPath(new URL("./cleanup-empresa-logos.ts", import.meta.url)),
        "--confirm-all-databases", "--confirm-coordinated-writers", ...(apply ? ["--apply"] : [])], {
        env: { ...process.env, DATABASE_URL: connection.toString(), LOGO_TEST_DATABASE_URL: connection.toString(),
          LOGO_CLEANUP_DATABASE_ENVS: JSON.stringify(names), PRIVATE_OBJECT_DIR: root },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", data => { text += data; });
      child.stderr.resume(); // Never print SDK/driver bodies with private details.
      const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.on("error", reject);
      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0) resolve(text); else reject(new Error("Isolated CLI failed"));
      });
    });
    return JSON.parse(output);
  }
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    db = await admin.connect();
    await db.query(`SET search_path TO "${schema}"`);
    await db.query("CREATE TABLE empresa_uploads (object_path text PRIMARY KEY, creado_en timestamptz NOT NULL)");
    await db.query("CREATE TABLE empresas (scope text PRIMARY KEY, perfil jsonb NOT NULL)");
    const path = await fixture();
    stage = "metadata";
    const meta = (await file(path).getMetadata())[0];
    const inspected = await storage.inspect(path);
    assert.equal(inspected?.generation, String(meta.generation));
    assert.equal(inspected?.updatedAt.toISOString(), new Date(meta.updated!).toISOString());
    assert.ok(/^\d+$/.test(inspected!.generation));
    const before = await rows();
    const bytes = (await file(path).download())[0];
    stage = "dry-run";
    assert.deepEqual(await cleanupEmpresaLogos([db], storage, { now }), [{ path, status: "would-delete" }]);
    assert.deepEqual(await rows(), before);
    assert.deepEqual(await storage.inspect(path), inspected);
    assert.deepEqual((await file(path).download())[0], bytes);
    stage = "cli";
    // Real wall clock must protect the new object; absent fixture tests CLI
    // apply/idempotency without waiting seven days or weakening production code.
    const missing = `/objects/uploads/${randomUUID()}`;
    paths.add(missing);
    await db.query("INSERT INTO empresa_uploads VALUES ($1, $2)", [missing, old]);
    const cliBefore = await rows();
    const dry = await cli(false);
    assert.equal(dry.mode, "dry-run");
    assert.ok(dry.report.some((r: any) => r.path === path && r.status === "recent-object"));
    assert.ok(dry.report.some((r: any) => r.path === missing && r.status === "already-missing"));
    assert.deepEqual(await rows(), cliBefore);
    const applied = await cli(true);
    assert.equal(applied.mode, "apply");
    assert.ok(applied.report.some((r: any) => r.path === missing && r.status === "already-missing"));
    assert.deepEqual(await rows(), before);
    assert.deepEqual(await storage.inspect(path), inspected);
    assert.deepEqual((await file(path).download())[0], bytes);
    stage = "overwrite-precondition";
    await assert.rejects(cleanupEmpresaLogos([db], {
      inspect: storage.inspect,
      async remove(p, generation) {
        await file(p).save(Buffer.from("replacement fixture"), {
          resumable: false, preconditionOpts: { ifGenerationMatch: generation },
          metadata: { metadata: { integrationRun: run } },
        });
        await storage.remove(p, generation);
      },
    }, { apply: true, now }), codeIs(412));
    assert.deepEqual(await rows(), before);
    assert.notEqual((await storage.inspect(path))!.generation, inspected!.generation);
    assert.equal((await file(path).download())[0].toString(), "replacement fixture");
    stage = "permission-denied";
    await assert.rejects(anonymous.inspect(path), deniedAccess);
    const replacement = await storage.inspect(path);
    await assert.rejects(anonymous.remove(path, replacement!.generation), deniedAccess);
    for (const denied of [anonymous, { inspect: storage.inspect, remove: anonymous.remove }]) {
      await assert.rejects(cleanupEmpresaLogos([db], denied, { apply: true, now }), deniedAccess);
      assert.deepEqual(await rows(), before);
      assert.deepEqual(await storage.inspect(path), replacement);
    }
    stage = "delete-and-404";
    assert.deepEqual(await cleanupEmpresaLogos([db], storage, { apply: true, now }), [{ path, status: "deleted" }]);
    assert.equal(await storage.inspect(path), null);
    await storage.remove(path, replacement!.generation); // Actual GCS DELETE 404.
    assert.deepEqual(await rows(), []);
    const race = await fixture();
    assert.deepEqual(await cleanupEmpresaLogos([db], {
      inspect: storage.inspect,
      async remove(p, generation) {
        await storage.remove(p, generation);
        await storage.remove(p, generation); // disappearance after inspection
      },
    }, { apply: true, now }), [{ path: race, status: "deleted" }]);
    await db.query("INSERT INTO empresa_uploads VALUES ($1, $2)", [race, old]);
    assert.deepEqual(await cleanupEmpresaLogos([db], storage, { apply: true, now }), [{ path: race, status: "already-missing" }]);
    assert.deepEqual(await cleanupEmpresaLogos([db], storage, { apply: true, now }), []);
    console.log("PASS: metadatos, generación, simulación, CLI, 412, acceso denegado y 404 reales.");
  } finally {
    // Exact known paths only; no listing or broad deletion. Always verify owner
    // metadata and generation, including writes whose acknowledgement was lost.
    const failures: unknown[] = [];
    for (const path of paths) {
      try {
        let meta;
        try { [meta] = await file(path).getMetadata(); }
        catch (e) { if (codeIs(404)(e)) continue; throw e; }
        assert.equal(meta.metadata?.integrationRun, run);
        assert.ok(meta.generation);
        await file(path).delete({ ifGenerationMatch: meta.generation });
      } catch (e) { failures.push(e); }
    }
    if (db) { await db.query("ROLLBACK"); db.release(); }
    try {
      if (createdSchema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      for (const cursor of cursors) await rm(cursor, { force: true });
    } finally { await Promise.all([admin.end(), pool.end()]); }
    assert.equal(failures.length, 0, `Fixture cleanup failed; run ${run}`);
  }
}
try { await main(); }
catch (error) {
  if (error instanceof assert.AssertionError) console.error(`Assertion code: ${error.code}; operator: ${error.operator}`);
  console.error(`FAIL: ${stage}; detalles sensibles omitidos. No se considera una prueba aprobada.`);
  process.exitCode = 1;
}
