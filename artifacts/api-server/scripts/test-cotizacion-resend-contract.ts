import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { checkResendContract } from "./helpers/resend-contract";

// This process never uses the workspace credential or real transport.
process.env.RESEND_API_KEY = "synthetic-contract-test-key";
const pdf = Buffer.from("%PDF-1.4\nsynthetic fixture\n%%EOF");
const fixture = {
  providerId: "11111111-1111-4111-8111-111111111111",
  preparedAt: "2026-01-01T00:00:00Z", bytes: pdf.length,
  sha256: createHash("sha256").update(pdf).digest("hex"),
  email: { id: 1, version: "test", numero: "TEST-1", email: "test@example.invalid",
    cliente: "Test", total: 1, moneda: "CLP", decimales: 0, vencimiento: "2026-01-02", remitente: {} },
  message: { from: "Test <test@example.invalid>", to: ["test@example.invalid"],
    subject: "Test", html: "<p>Test</p>", replyTo: "reply@example.invalid" },
};
const email = {
  id: fixture.providerId, created_at: fixture.preparedAt, to: fixture.message.to,
  subject: fixture.message.subject, html: fixture.message.html, from: fixture.message.from,
  reply_to: [fixture.message.replyTo], last_event: "bounced",
};
const attachment = {
  filename: "TEST-1.pdf", size: pdf.length,
  download_url: "https://outbound-cdn.resend.com/test?signature=never-log-this",
};

test("default invocation skips before reading fixtures or credentials", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/test-cotizacion-resend-live.ts"], {
    cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^SKIP:/);
});

test("contract checks use the real verifier, with sanitized failures and only three GETs", async () => {
  const scenarios = [
    { name: "valid including bounced", pass: true },
    { name: "email format", email: { ...email, to: "not-an-array" } },
    { name: "email mismatch", email: { ...email, subject: "changed" } },
    { name: "email ID", email: { ...email, id: "other" } },
    { name: "email date", email: { ...email, created_at: "invalid" } },
    { name: "reply-to", email: { ...email, reply_to: [] } },
    ...[401, 403, 404, 429, 500].map(status => ({ name: `email HTTP ${status}`, status, at: 1 })),
    ...[401, 403, 404].map(status => ({ name: `attachment HTTP ${status}`, status, at: 2 })),
    { name: "CDN forbidden", status: 403, at: 3 },
    { name: "pagination", attachments: { has_more: true, data: [attachment] } },
    { name: "missing attachment", attachments: { has_more: false, data: [] } },
    { name: "multiple attachments", attachments: { has_more: false, data: [attachment, attachment] } },
    { name: "attachment format", attachments: { data: [attachment] } },
    { name: "CDN hostname", attachment: { ...attachment, download_url: "https://outbound-cdn.resend.com.evil.invalid/a" } },
    { name: "CDN HTTP", attachment: { ...attachment, download_url: "http://outbound-cdn.resend.com/a" } },
    { name: "attachment name", attachment: { ...attachment, filename: "other.pdf" } },
    { name: "attachment size", attachment: { ...attachment, size: 0 } },
    { name: "hash mismatch", bytes: Buffer.alloc(pdf.length, 65) },
    { name: "truncated body", bytes: pdf.subarray(1) },
    { name: "oversized body", bytes: Buffer.concat([pdf, pdf]) },
    { name: "network failure", network: true },
  ];
  for (const scenario of scenarios) {
    const s = scenario as {
      name: string; pass?: boolean; email?: unknown; attachments?: unknown; attachment?: unknown;
      status?: number; at?: number; bytes?: Buffer; network?: boolean;
    };
    let calls = 0;
    const original = globalThis.fetch;
    const transport: typeof fetch = async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(request.method, "GET");
      assert.equal(request.redirect, "error");
      assert.equal(request.headers.has("authorization"), calls < 3);
      assert.ok(calls <= 3);
      if (s.network) throw new Error("signed URL or secret never-log-this");
      if (calls === s.at) return new Response("private response never-log-this", { status: s.status });
      if (calls === 1) return Response.json(s.email ?? email);
      if (calls === 2) return Response.json(s.attachments ?? { has_more: false, data: [s.attachment ?? attachment] });
      return new Response(s.bytes ?? pdf);
    };
    if (s.pass) {
      await checkResendContract(fixture, transport);
      assert.equal(calls, 3);
    } else {
      await assert.rejects(checkResendContract(fixture, transport), (error: Error) => {
        assert.match(error.message, /No prueba rechazo ni autoriza reenvío/);
        assert.doesNotMatch(error.message, /never-log-this|example.invalid|11111111|synthetic-contract-test-key/);
        if (s.status) assert.match(error.message, new RegExp(`HTTP ${s.status}`));
        return true;
      }, s.name);
    }
    assert.equal(globalThis.fetch, original);
  }
});

test("invalid fixture fails without network access", async () => {
  await assert.rejects(checkResendContract({ ...fixture, apiKey: "not-allowed" }, async () => {
    assert.fail("must not make a request");
  }), /fixture/);
});
