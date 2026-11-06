import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { cleanupEmpresaLogos, type LogoDatabase, type LogoStorage } from "../src/lib/empresaLogoCleanup";
import { eligibleLogo, LOGO_GRACE_MS, LOGO_URL_TTL_MS, LOGO_LOCK } from "../src/lib/empresaLogoLifecycle";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readLogoCursor, writeLogoCursor } from "../src/lib/empresaLogoCursor";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { temporaryLogoPostgres } from "./helpers/logo-test-postgres";

let postgres: Awaited<ReturnType<typeof temporaryLogoPostgres>>;
const originalDatabaseUrl = process.env.DATABASE_URL;
before(async () => { postgres = await temporaryLogoPostgres(); });
after(async () => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  await postgres?.close();
});

const now = new Date("2026-11-06T12:00:00Z");
const old = new Date(now.getTime() - 2 * LOGO_GRACE_MS);
const logo = `/objects/empresas/${"a".repeat(64)}.png`;
const temp = `/objects/uploads/${randomUUID()}`;
class Database implements LogoDatabase {
  records = new Map<string, Date>();
  refs = new Set<string>();
  locked = true;
  fail = false;
  async query(sql: string, values: unknown[] = []) {
    if (this.fail) throw new Error("offline");
    if (sql.includes("pg_try")) return { rows: [{ locked: this.locked }] };
    if (sql.includes("SELECT u.")) return { rows: [...this.records].filter(([p, d]) => !this.refs.has(p) && d < (values[0] as Date) && p > (values[2] as string))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .slice(0, values[1] as number).map(([p, d]) => ({ object_path: p, creado_en: d })) };
    if (sql.includes("SELECT scope")) return { rows: this.refs.has(values[0] as string) ? [{ scope: "test" }] : [] };
    if (sql.includes("SELECT creado_en")) return { rows: this.records.has(values[0] as string) ? [{ creado_en: this.records.get(values[0] as string) }] : [] };
    if (sql.includes("DELETE")) this.records.delete(values[0] as string);
    return { rows: [] };
  }
}
function fixture() {
  const a = new Database(), b = new Database();
  a.records.set(logo, old); a.records.set(temp, old);
  const objects = new Map([logo, temp].map(path => [path, { generation: "1", updatedAt: old }]));
  const removed: string[] = [];
  const storage: LogoStorage = {
    async inspect(path) { return objects.get(path) ?? null; },
    async remove(path, generation) {
      assert.equal(generation, objects.get(path)?.generation);
      removed.push(path); objects.delete(path);
    },
  };
  return { a, b, objects, removed, storage };
}
test("all-environment references and recent concurrent uploads are protected", async () => {
  const f = fixture();
  f.b.refs.add(logo);
  f.b.records.set(temp, now);
  const report = await cleanupEmpresaLogos([f.a, f.b], f.storage, { apply: true, now });
  assert.deepEqual(report.map(r => r.status), ["protected", "protected"]);
  assert.equal(f.removed.length, 0);
});
test("dry run is non-mutating; apply is bounded and idempotent including missing objects", async () => {
  const f = fixture();
  await cleanupEmpresaLogos([f.a, f.b], f.storage, { now });
  assert.equal(f.a.records.size, 2); assert.equal(f.removed.length, 0);
  await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true, limit: 1 });
  assert.equal(f.removed.length, 1); assert.equal(f.a.records.size, 1);
  f.objects.delete(temp);
  assert.equal((await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true }))[0].status, "already-missing");
  assert.deepEqual(await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true }), []);
});
test("foreign paths, grace/expiry boundaries and invalid times fail closed", () => {
  for (const path of ["/objects/pdfs/test.pdf", "/objects/uploads/../file", "/objects/empresas/invalid.png"]) {
    assert.equal(eligibleLogo({ objectPath: path, touchedAt: old }, new Set(), now), false);
  }
  const cutoff = now.getTime() - LOGO_GRACE_MS - LOGO_URL_TTL_MS;
  assert.equal(eligibleLogo({ objectPath: temp, touchedAt: new Date(cutoff + 1) }, new Set(), now), false);
  assert.equal(eligibleLogo({ objectPath: temp, touchedAt: new Date(cutoff) }, new Set(), now), true);
  assert.equal(eligibleLogo({ objectPath: logo, touchedAt: new Date(NaN) }, new Set(), now), false);
});
test("storage rewrite, unavailable DB or active writer never authorizes deletion", async () => {
  for (const mode of ["rewrite", "offline", "busy", "generation-failure"]) {
    const f = fixture();
    if (mode === "rewrite") {
      f.objects.set(logo, { generation: "2", updatedAt: now });
      f.objects.set(temp, { generation: "2", updatedAt: now });
      await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true });
    } else {
      if (mode === "offline") f.b.fail = true;
      if (mode === "busy") f.b.locked = false;
      if (mode === "generation-failure") f.storage.remove = async () => { throw new Error("412"); };
      await assert.rejects(cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true }));
    }
    assert.equal(f.removed.length, 0); assert.equal(f.a.records.size, 2);
  }
});
test("unregistered historical objects are not enumerated", async () => {
  const f = fixture(); f.a.records.clear();
  assert.deepEqual(await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true }), []);
  assert.equal(f.objects.size, 2);
});
test("persistent pagination passes 50 cross-database references and wraps for newly eligible objects", async () => {
  const f = fixture();
  f.a.records.clear();
  for (let i = 0; i < 50; i++) {
    const path = `/objects/empresas/${i.toString(16).padStart(64, "0")}.png`;
    f.a.records.set(path, old);
    f.b.refs.add(path);
  }
  f.a.records.set(temp, old);
  const file = fileURLToPath(new URL(`../../../generated-artifacts/logo-cleanup/test-${randomUUID()}.json`, import.meta.url));
  try {
    const first = await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true, afterPath: await readLogoCursor(file) });
    assert.equal(first.length, 50);
    assert.ok(first.every(row => row.status === "protected"));
    assert.equal(f.removed.length, 0);
    await writeLogoCursor(file, first);
    const second = await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true, afterPath: await readLogoCursor(file) });
    assert.deepEqual(second, [{ path: temp, status: "deleted" }]);
    await writeLogoCursor(file, second);
    const empty = await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true, afterPath: await readLogoCursor(file) });
    assert.deepEqual(empty, []);
    await writeLogoCursor(file, empty);
    assert.equal(await readLogoCursor(file), null, "wrap to start after end of inventory");
    f.b.refs.clear();
    const nextCycle = await cleanupEmpresaLogos([f.a, f.b], f.storage, { now, apply: true, afterPath: await readLogoCursor(file) });
    assert.equal(nextCycle.length, 50);
    assert.ok(nextCycle.every(row => row.status === "already-missing"));
  } finally { await rm(file, { force: true }); }
});
// Storage remains in memory: these tests must never touch a shared bucket.
async function realPair(run: (f: ReturnType<typeof fixture>, clients: any[]) => Promise<void>) {
  const clients = await Promise.all(postgres.databases.map(pool => pool.connect()));
  try {
    for (const client of clients) {
      await client.query("TRUNCATE empresas, empresa_uploads");
      for (const path of [logo, temp]) {
        await client.query("INSERT INTO empresa_uploads VALUES ($1, 'test', $2)", [path, old]);
      }
    }
    const names = await Promise.all(clients.map(client => client.query("SELECT current_database() AS name")));
    assert.notEqual(names[0].rows[0].name, names[1].rows[0].name, "not two schemas in one database");
    await run(fixture(), clients);
  } finally {
    for (const client of clients) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release(true);
    }
  }
}
async function ledgerCounts() {
  return Promise.all(postgres.databases.map(async pool =>
    Number((await pool.query("SELECT count(*) FROM empresa_uploads")).rows[0].count)));
}
function barrier(count: number) {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return async () => { if (++arrived === count) release(); await ready; };
}
test("independent Postgres databases: simultaneous writers protect references in both", { timeout: 15000 }, async () => {
  await realPair(async (f, maintenance) => {
    const writers = await Promise.all(postgres.databases.map(pool => pool.connect()));
    try {
      // Both transactions hold the same advisory key at once: these locks are
      // database-local, so maintenance must acquire/check BOTH databases.
      await Promise.all(writers.map(async (writer, i) => {
        await writer.query("BEGIN");
        await writer.query("SELECT pg_advisory_xact_lock($1)", [LOGO_LOCK]);
        await writer.query("INSERT INTO empresas(scope, perfil) VALUES ('test', $1)",
          [JSON.stringify({ logoPath: i === 0 ? logo : temp })]);
      }));
      await assert.rejects(cleanupEmpresaLogos(maintenance, f.storage, { now, apply: true }), /active/);
      await writers[0].query("COMMIT");
      // Specifically reaches the second DB, rolls back the first lock.
      await assert.rejects(cleanupEmpresaLogos(maintenance, f.storage, { now, apply: true }), /active/);
      assert.deepEqual(await ledgerCounts(), [2, 2]);
      assert.equal(f.removed.length, 0);
      await writers[1].query("COMMIT");
      const report = await cleanupEmpresaLogos(maintenance, f.storage, { now, apply: true });
      assert.equal(report.length, 2);
      assert.ok(report.every(row => row.status === "protected"));
      assert.equal(f.objects.size, 2);
      assert.equal(f.removed.length, 0);
      assert.deepEqual(await ledgerCounts(), [2, 2]);
    } finally {
      for (const writer of writers) { await writer.query("ROLLBACK"); writer.release(); }
    }
  });
});
test("second Postgres disconnect before deletion fails closed, reconnect protects its reference", { timeout: 15000 }, async () => {
  await realPair(async (f, clients) => {
    await clients[1].query("INSERT INTO empresas(scope, perfil) VALUES ('test', $1)", [JSON.stringify({ logoPath: logo })]);
    const pid = (await clients[1].query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    clients[1].on("error", () => {}); // Expected backend termination, not an unhandled pool error.
    let disconnected = false;
    const second: LogoDatabase = { async query(sql, values) {
      if (!disconnected && sql.includes("SELECT scope")) {
        disconnected = true;
        await postgres.databases[1].query("SELECT pg_terminate_backend($1)", [pid]);
      }
      return clients[1].query(sql, values);
    } };
    await assert.rejects(cleanupEmpresaLogos([clients[0], second], f.storage, { now, apply: true }));
    assert.ok(disconnected, "failure occurs after candidate selection, before delete");
    assert.equal(f.removed.length, 0);
    assert.equal(f.objects.size, 2);
    assert.deepEqual(await ledgerCounts(), [2, 2]);
    const replacement = await postgres.databases[1].connect();
    try {
      const report = await cleanupEmpresaLogos([clients[0], replacement], f.storage, { now, apply: true });
      assert.deepEqual(report, [{ path: logo, status: "protected" }, { path: temp, status: "deleted" }]);
      assert.deepEqual(await cleanupEmpresaLogos([clients[0], replacement], f.storage, { now, apply: true }),
        [{ path: logo, status: "protected" }]);
      assert.deepEqual(f.removed, [temp]);
      assert.ok(f.objects.has(logo));
      assert.deepEqual(await ledgerCounts(), [1, 1]);
    } finally { replacement.release(); }
  });
});
test("opposite-order Postgres maintenance attempts abort without deadlock and retry once", { timeout: 15000 }, async () => {
  await realPair(async (f, clients) => {
    const others = await Promise.all(postgres.databases.map(pool => pool.connect()));
    const firstLocks = barrier(2), secondLocks = barrier(2);
    const wrap = (client: any, first: boolean): LogoDatabase => ({ async query(sql, values) {
      const result = await client.query(sql, values);
      if (sql.includes("pg_try")) await (first ? firstLocks() : secondLocks());
      return result;
    } });
    try {
      const results = await Promise.allSettled([
        cleanupEmpresaLogos([wrap(clients[0], true), wrap(clients[1], false)], f.storage, { now, apply: true }),
        cleanupEmpresaLogos([wrap(others[1], true), wrap(others[0], false)], f.storage, { now, apply: true }),
      ]);
      assert.ok(results.every(result => result.status === "rejected" && /active/.test(String(result.reason))));
      assert.equal(f.removed.length, 0);
      assert.deepEqual(await ledgerCounts(), [2, 2]);
      assert.equal((await cleanupEmpresaLogos(clients, f.storage, { now, apply: true })).length, 2);
      assert.deepEqual(await cleanupEmpresaLogos([...others].reverse(), f.storage, { now, apply: true }), []);
      assert.equal(new Set(f.removed).size, 2);
      assert.equal(f.removed.length, 2);
      assert.deepEqual(await ledgerCounts(), [0, 0]);
    } finally { for (const client of others) { await client.query("ROLLBACK"); client.release(); } }
  });
});
test("partial Postgres commit preserves active logo and retry reconciles missing object idempotently", { timeout: 15000 }, async () => {
  await realPair(async (f, clients) => {
    await clients[1].query("INSERT INTO empresas(scope, perfil) VALUES ('test', $1)", [JSON.stringify({ logoPath: logo })]);
    const pid = (await clients[1].query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    clients[1].on("error", () => {});
    let firstCommitted = false, failed = false;
    const first: LogoDatabase = { async query(sql, values) {
      const result = await clients[0].query(sql, values);
      if (sql === "COMMIT") firstCommitted = true;
      return result;
    } };
    const second: LogoDatabase = { async query(sql, values) {
      if (sql === "COMMIT") {
        assert.ok(firstCommitted);
        failed = true;
        await postgres.databases[1].query("SELECT pg_terminate_backend($1)", [pid]);
      }
      return clients[1].query(sql, values);
    } };
    await assert.rejects(cleanupEmpresaLogos([first, second], f.storage, { now, apply: true }));
    assert.ok(failed);
    assert.deepEqual(await ledgerCounts(), [1, 2], "first commit durable; second transaction rolled back");
    assert.deepEqual(f.removed, [temp]);
    assert.ok(f.objects.has(logo));
    const replacement = await postgres.databases[1].connect();
    try {
      assert.deepEqual(await cleanupEmpresaLogos([clients[0], replacement], f.storage, { now, apply: true }),
        [{ path: logo, status: "protected" }, { path: temp, status: "already-missing" }]);
      assert.deepEqual(await cleanupEmpresaLogos([replacement, clients[0]], f.storage, { now, apply: true }),
        [{ path: logo, status: "protected" }]);
      assert.deepEqual(await ledgerCounts(), [1, 1]);
      assert.deepEqual(f.removed, [temp], "retry must not issue another storage deletion");
      assert.ok(f.objects.has(logo));
      assert.equal((await replacement.query("SELECT perfil->>'logoPath' AS path FROM empresas")).rows[0].path, logo);
    } finally { replacement.release(); }
  });
});
test("real Postgres lock serializes profile save, retirement and cleanup", async () => {
  const { Pool } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
  const admin = new Pool({ connectionString: postgres.url });
  const schema = `logo_test_${randomUUID().replaceAll("-", "")}`;
  let appPool: { end(): Promise<void> } | undefined;
  let maintenance: any;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["empresas", "empresa_uploads"]) {
      await admin.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const url = new URL(postgres.url);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    const d = await import("@workspace/db"); appPool = d.pool;
    const { saveEmpresa, empresaDefault, requestLogoUpload } = await import("../src/lib/empresa");
    await d.db.insert(d.empresasTable).values({ scope: "test", perfil: { ...empresaDefault, logoPath: logo } });
    await d.db.insert(d.empresaUploadsTable).values({ scope: "test", objectPath: logo, creadoEn: old });
    maintenance = await admin.connect();
    await maintenance.query(`SET search_path TO "${schema}", public`);
    await maintenance.query("BEGIN");
    await maintenance.query("SELECT pg_advisory_xact_lock($1)", [LOGO_LOCK]);
    let saved = false;
    const pending = saveEmpresa("test", { ...empresaDefault, razonSocial: "Updated", logoPath: null }).then(() => { saved = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(saved, false, "profile writer must wait for cleanup lock");
    await maintenance.query("COMMIT");
    await pending;
    const touched = await maintenance.query("SELECT creado_en FROM empresa_uploads");
    assert.ok(new Date(touched.rows[0].creado_en).getTime() > old.getTime(), "retirement resets grace");
    let inspected = false;
    await cleanupEmpresaLogos([maintenance], {
      async inspect() { inspected = true; return null; }, async remove() { assert.fail("must not delete"); },
    }, { apply: true });
    assert.equal(inspected, false, "just-retired logo protected");
    // Reverse ordering: an in-flight writer makes maintenance abort.
    const writer = await admin.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT pg_advisory_xact_lock($1)", [LOGO_LOCK]);
      await assert.rejects(cleanupEmpresaLogos([maintenance], fixture().storage, { apply: true }), /active/);
    } finally { await writer.query("ROLLBACK"); writer.release(); }
    // Upload issuance uses the same lock; new normalized objects are recorded
    // durably even if object storage fails before the profile transaction commits.
    const { ObjectStorageService, objectStorageClient } = await import("../src/lib/objectStorage");
    const proto = ObjectStorageService.prototype;
    const originalSign = proto.getObjectEntityUploadURL;
    const originalRead = proto.getObjectEntityFile;
    const originalRoot = proto.getPrivateObjectDir;
    const originalBucket = objectStorageClient.bucket;
    try {
      proto.getObjectEntityUploadURL = async () => temp;
      await maintenance.query("BEGIN");
      await maintenance.query("SELECT pg_advisory_xact_lock($1)", [LOGO_LOCK]);
      let issued = false;
      const uploading = requestLogoUpload("test").then(value => { issued = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(issued, false);
      await maintenance.query("COMMIT");
      assert.equal((await uploading).objectPath, temp);
      const sharp = (await import("sharp")).default;
      const { Readable } = await import("node:stream");
      const bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: "#2563EB" } }).png().toBuffer();
      proto.getObjectEntityFile = async () => ({ createReadStream: () => Readable.from([bytes]) }) as any;
      proto.getPrivateObjectDir = () => "/test-bucket/private";
      objectStorageClient.bucket = (() => ({ file: () => ({
        save: async () => { throw new Error("simulated storage outage"); },
      }) })) as any;
      await assert.rejects(saveEmpresa("test", { ...empresaDefault, logoPath: temp }), /simulated storage/);
      const ledger = await maintenance.query("SELECT object_path FROM empresa_uploads WHERE object_path LIKE '/objects/empresas/%'");
      assert.equal(ledger.rows.length, 2, "failed storage write retains normalized cleanup record");
      objectStorageClient.bucket = (() => ({ file: () => ({ save: async () => {} }) })) as any;
      const results = await Promise.all([
        saveEmpresa("test", { ...empresaDefault, logoPath: temp }),
        saveEmpresa("test", { ...empresaDefault, logoPath: temp }),
      ]);
      assert.equal(results[0].logoPath, results[1].logoPath);
      const profile = await maintenance.query("SELECT perfil FROM empresas WHERE scope = 'test'");
      assert.equal(profile.rows[0].perfil.logoPath, results[0].logoPath);
      // Saturate every pool slot with writers waiting for the same lock.
      // Releasing the gate must let the holder complete without borrowing a
      // second connection. A lock timeout makes regressions fail, not hang.
      const slots = d.pool.options.max ?? 10;
      const warm = await Promise.all(Array.from({ length: slots }, () => d.pool.connect()));
      await Promise.all(warm.map(client => client.query("SET lock_timeout = '5s'")));
      warm.forEach(client => client.release());
      await maintenance.query("BEGIN");
      await maintenance.query("SELECT pg_advisory_xact_lock($1)", [LOGO_LOCK]);
      const burst = Array.from({ length: slots + 2 }, () =>
        saveEmpresa("test", { ...empresaDefault, logoPath: temp }));
      // Attach rejection handlers immediately, including for a failed regression.
      const settled = Promise.allSettled(burst);
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(d.pool.idleCount, 0, "test exhausts all pool connections");
      assert.ok(d.pool.waitingCount >= 2);
      await maintenance.query("COMMIT");
      const completed = await settled;
      assert.ok(completed.every(result => result.status === "fulfilled"),
        "all saves finish even with the pool saturated");
    } finally {
      proto.getObjectEntityUploadURL = originalSign;
      proto.getObjectEntityFile = originalRead;
      proto.getPrivateObjectDir = originalRoot;
      objectStorageClient.bucket = originalBucket;
    }
  } finally {
    if (maintenance) { await maintenance.query("ROLLBACK"); maintenance.release(); }
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
