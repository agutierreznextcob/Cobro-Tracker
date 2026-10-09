/**
 * No-send regression: temporary schema, synthetic payment data, no provider
 * requests or emails. No production/customer rows or sequences are changed.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = requireDb("pg");
const originalUrl = process.env.DATABASE_URL!;
const schema = `email_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: originalUrl });
let pool: { end(): Promise<void> } | undefined;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("External network forbidden in email test"); };

try {
  await admin.connect();
  await admin.query(`create schema "${schema}"`);
  for (const table of ["cobros", "datos_bancarios", "flow_credenciales", "mp_credenciales"]) {
    await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
  }
  const url = new URL(originalUrl);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const schemaDb = await import("@workspace/db");
  pool = schemaDb.pool;
  const { db, cobrosTable, datosBancariosTable, flowCredencialesTable, mpCredencialesTable } = schemaDb;
  const { encrypt } = await import("../src/lib/encrypt");
  const { resolveCobroEmailOptions } = await import("../src/lib/cobro-email-options");
  const { buildCobroNoticeHtml } = await import("../src/lib/email");
  const sample = {
    clienteNombre: "Cliente <prueba>",
    descripcion: "Servicio & soporte",
    comercioNombre: "Negocio de prueba",
    monto: 12000,
  };
  const bank = encrypt("000000000");
  for (const userId of ["bank", "flow-bank", "mp-bank"]) {
    await db.insert(datosBancariosTable).values({
      userId, banco: "Banco de prueba", tipoCuenta: "Cuenta corriente",
      numeroCuentaEncrypted: bank.encrypted, numeroCuentaIv: bank.iv,
      numeroCuentaAuthTag: bank.authTag, titularNombre: "Titular de prueba",
      titularRut: "11.111.111-1", emailComprobantes: "comprobantes@test.invalid",
    });
  }
  // Synthetic encrypted credential fields: never decrypted or sent anywhere.
  for (const userId of ["flow-bank", "flow-only"]) {
    await db.insert(flowCredencialesTable).values({
      userId, apiKeyEncrypted: "test", apiKeyIv: "test", apiKeyAuthTag: "test",
      secretKeyEncrypted: "test", secretKeyIv: "test", secretKeyAuthTag: "test",
    });
  }
  await db.insert(mpCredencialesTable).values({
    userId: "mp-bank", accessTokenEncrypted: "test", accessTokenIv: "test", accessTokenAuthTag: "test",
  });
  const cases = [
    { user: "flow-bank", flow: "https://flow.test.invalid/pay", mp: null, bank: true, button: true, provider: "Webpay / Flow" },
    { user: "mp-bank", flow: null, mp: "https://mercadopago.test.invalid/pay", bank: true, button: true, provider: "MercadoPago" },
    { user: "bank", flow: null, mp: null, bank: true, button: false },
    { user: "nothing", flow: null, mp: null, bank: false, button: false },
    { user: "flow-only", flow: "https://flow.test.invalid/pay", mp: null, bank: false, button: true, provider: "Webpay / Flow" },
    // Disconnected provider must not advertise an old stored payment URL.
    { user: "disconnected", flow: "https://flow.test.invalid/stale", mp: null, bank: false, button: false },
  ];
  for (const [index, c] of cases.entries()) {
    const id = index + 1;
    await db.insert(cobrosTable).values({
      id, responsableId: c.user, descripcion: sample.descripcion, monto: "12000",
      fechaVencimiento: "2026-12-20", flowLinkPago: c.flow, mpPaymentLinkUrl: c.mp,
    });
    const options = await resolveCobroEmailOptions(id, { warn: () => {} });
    const html = buildCobroNoticeHtml(sample, options);
    assert.equal(html.includes('target="_blank"'), c.button, c.user);
    assert.equal(html.includes("Banco de prueba"), c.bank, c.user);
    assert.equal(html.includes("O si prefieres, transfiere directamente"), c.button && c.bank, c.user);
    assert.equal(html.includes("Una vez realizada la transferencia, responde este correo con el comprobante."), c.bank, c.user);
    assert.ok(html.includes("20/12/2026"));
    assert.ok(html.includes("Cliente &lt;prueba&gt;"));
    assert.ok(html.includes("Servicio &amp; soporte"));
    assert.ok(!html.includes("mailto:"));
    if (c.provider) assert.ok(html.includes(`con ${c.provider}`));
    if (c.button && c.bank) assert.ok(html.indexOf('target="_blank"') < html.indexOf("Banco de prueba"));
    if (c.bank) for (const value of ["Cuenta corriente", "000000000", "Titular de prueba", "11.111.111-1"]) assert.ok(html.includes(value));
    console.log(`PASS ${c.user}`);
  }
  const noDate = buildCobroNoticeHtml(sample, {});
  assert.ok(noDate.includes("Sin fecha de vencimiento"));
  console.log("PASS missing due date; all tests passed without sending emails.");
} finally {
  globalThis.fetch = originalFetch;
  await pool?.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
