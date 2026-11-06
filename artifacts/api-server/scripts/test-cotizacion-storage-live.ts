/**
 * Explicit opt-in integration check. No DB queries, mail, or user objects.
 * See docs/cotizaciones-storage-live.md before running.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Cotizacion } from "@workspace/db";

if (!process.argv.includes("--live")) {
  console.log("SKIP: App Storage real no habilitado. Ejecutar con --live.");
  process.exit(0);
}

// These dependencies construct a lazy DB pool and an email client. Neither is
// needed here; deny them real credentials even if future imports change.
process.env.DATABASE_URL = "postgresql://disabled:disabled@127.0.0.1:1/disabled";
delete process.env.RESEND_API_KEY;
process.env.LOG_LEVEL = "silent";

const pdf = Buffer.from("%PDF-1.4\n% isolated storage integration fixture\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
let stage = "configuration";
let server: Server | undefined;

async function main() {
  const { guardarPdfCotizacion, leerPdfCotizacion, hashPdf } = await import("../src/lib/cotizacion-archivo");
  if (process.argv.includes("--reader")) {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const q = JSON.parse(input) as Cotizacion;
    assert.deepEqual(await leerPdfCotizacion(q), pdf);
    console.log("fresh-process-read-ok");
    return;
  }

  const { ObjectStorageService, objectStorageClient } = await import("../src/lib/objectStorage");
  const storage = new ObjectStorageService();
  const original = storage.getPrivateObjectDir().replace(/\/+$/, "");
  const publicRoots = storage.getPublicObjectSearchPaths().map(p => p.replace(/\/+$/, ""));
  assert.ok(original.startsWith("/") && original.split("/").length >= 3, "Private storage configuration invalid");
  assert.ok(!publicRoots.some(p => original === p || original.startsWith(`${p}/`)),
    "Private storage overlaps a public search root");
  // Import app, never index: no startup seed, schedulers or email jobs.
  let origin = process.env.COTIZACION_STORAGE_TEST_BASE_URL;
  if (!origin) {
    const { default: app } = await import("../src/app");
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const base = new URL(origin);
  assert.ok(["http:", "https:"].includes(base.protocol) && !base.username && !base.password);

  const run = randomUUID();
  const root = `${original}/integration-tests/cotizacion-pdf/${run}`;
  process.env.PRIVATE_OBJECT_DIR = root;
  const [bucketName, ...parts] = root.slice(1).split("/");
  const prefix = `${parts.join("/")}/`;
  const bucket = objectStorageClient.bucket(bucketName);
  const owner = `storage-test-${run}`;
  const q = { id: 1, organizationId: null, responsableId: owner, envioPdf: null } as Cotizacion;
  console.log(`Run ${run} (solo objetos sintéticos)`);
  try {
    stage = "write";
    q.envioPdf = await guardarPdfCotizacion(q, pdf, {
      id: 1, version: run, numero: "STORAGE-TEST", email: "nobody@example.invalid",
      cliente: "Integration fixture", total: 1, moneda: "CLP", decimales: 0,
      vencimiento: "2099-01-01", remitente: { nombre: "Storage test" },
    });
    const file = await storage.getObjectEntityFile(q.envioPdf.path);
    const [meta] = await file.getMetadata();
    assert.equal(meta.contentType, "application/pdf");
    assert.equal(meta.metadata?.sha256, hashPdf(pdf));
    assert.equal(meta.metadata?.scope, `user:${owner}`);
    stage = "no-overwrite";
    await assert.rejects(file.save(Buffer.from("must not replace"), {
      resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
    }), (err: unknown) => Number((err as { code?: unknown }).code) === 412);
    assert.equal((await file.getMetadata())[0].generation, meta.generation);
    stage = "read-and-integrity";
    assert.deepEqual(await leerPdfCotizacion(q), pdf);
    await assert.rejects(leerPdfCotizacion({ ...q, responsableId: `${owner}-other` }));
    await assert.rejects(leerPdfCotizacion({ ...q, envioPdf: { ...q.envioPdf, sha256: "0".repeat(64) } }));

    stage = "fresh-process-read";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, process.argv[1], "--live", "--reader"], {
        env: process.env, stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      // Do not print SDK error bodies, which can contain credential URLs.
      child.stderr.resume();
      const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.on("error", reject);
      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0 && output.includes("fresh-process-read-ok")) resolve();
        else reject(new Error("Fresh process could not read archive"));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(q));
    });

    stage = "anonymous-access";
    const relative = q.envioPdf.path.slice("/objects/".length);
    const actual = `${prefix}${relative}`;
    const paths = [
      `/api/storage${q.envioPdf.path}`,
      q.envioPdf.path,
      `/api/storage/public-objects/${relative}`,
      ...publicRoots.filter(p => p.split("/")[1] === bucketName).map(p =>
        `/api/storage/public-objects/${p.split("/").slice(2).map(() => "..%2F").join("")}${actual}`),
    ];
    for (const path of paths) {
      const response = await fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(15_000) });
      await response.body?.cancel();
      assert.ok([401, 403, 404].includes(response.status), `Public route did not deny access (${response.status})`);
    }
    const anonymous = await fetch(`https://storage.googleapis.com/${bucketName}/${actual}`, {
      redirect: "manual", signal: AbortSignal.timeout(15_000),
    });
    await anonymous.body?.cancel();
    assert.ok([401, 403, 404].includes(anonymous.status), `Bucket allows anonymous access (${anonymous.status})`);
    console.log("PASS: permisos, no sobrescritura, integridad, proceso nuevo y acceso anónimo.");
  } finally {
    // List ONLY the random run namespace, including a write whose response was
    // lost. Never sweep the real cotizaciones prefix or delete recursively.
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      assert.ok(file.name.startsWith(`${prefix}cotizaciones/`), "Refusing unexpected cleanup path");
      const [meta] = await file.getMetadata();
      assert.equal(meta.metadata?.scope, `user:${owner}`, "Refusing foreign object cleanup");
      assert.equal(String(meta.metadata?.cotizacionId), "1");
      assert.ok(meta.generation, "Cleanup requires generation");
      await file.delete({ ifGenerationMatch: meta.generation });
    }
    assert.equal((await bucket.getFiles({ prefix }))[0].length, 0, "Cleanup incomplete");
    console.log("PASS: limpieza del namespace aislado.");
  }
}

try {
  await main();
} catch (error) {
  // SDK errors may include auth URLs and configured private bucket paths.
  console.error(`FAIL: ${stage}; ${error instanceof assert.AssertionError ? error.message : "operación fallida (detalle sensible omitido)"}`);
  process.exitCode = 1;
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close(err => err ? reject(err) : resolve()));
  }
  const { pool } = await import("@workspace/db");
  await pool.end();
}
