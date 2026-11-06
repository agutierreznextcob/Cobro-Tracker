import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
const originalUrl = process.env.DATABASE_URL!;
const schema = `survey_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: originalUrl });
let pool: { end(): Promise<void> } | undefined;
let server: Server | undefined;
try {
  await admin.connect();
  await admin.query(`create schema "${schema}"`);
  for (const table of ["users", "organizaciones", "preferencias", "cobros", "encuestas_satisfaccion"]) {
    await admin.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
    if (!["users", "preferencias"].includes(table)) {
      await admin.query(`create sequence "${schema}"."${table}_seq"`);
      await admin.query(`alter table "${schema}"."${table}" alter column id set default nextval('"${schema}"."${table}_seq"')`);
    }
  }
  const url = new URL(originalUrl); url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const D = await import("@workspace/db"); pool = D.pool;
  const { eq } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const surveys = (await import("../src/routes/encuestas")).default;
  const preferences = (await import("../src/routes/preferencias")).default;
  const { preferenciasDefault, hoySantiago } = await import("../src/lib/preferencias");
  const [owner, staff, outside] = await D.db.insert(D.usersTable).values(["owner", "staff", "outside"].map((n, i) => ({
    id: `survey-${n}`, accountSeq: 49000 + i, email: `${n}@survey.invalid`, esDemo: true, activo: true, profileCompleted: true,
  }))).returning();
  const [org] = await D.db.insert(D.organizacionesTable).values({ nombre: "Encuestas QA", ownerId: owner.id }).returning();
  await D.db.update(D.usersTable).set({ organizationId: org.id, orgRole: "admin_org" }).where(eq(D.usersTable.id, owner.id));
  await D.db.update(D.usersTable).set({ organizationId: org.id, orgRole: "ejecutivo" }).where(eq(D.usersTable.id, staff.id));
  const tokens: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [c] = await D.db.insert(D.cobrosTable).values({
      descripcion: "QA survey", monto: "1000", responsableId: owner.id, organizationId: org.id,
      clienteId: i < 2 ? 1 : i, clienteNombre: `QA ${i}`,
    }).returning();
    const token = randomUUID(); tokens.push(token);
    await D.db.insert(D.encuestasTable).values({
      cobroId: c.id, token, organizationId: org.id, userId: staff.id, clienteId: c.clienteId, clienteNombre: c.clienteNombre,
    });
  }
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = req.headers["x-test-user"] ? { id: req.headers["x-test-user"] } : undefined;
    (req as any).isAuthenticated = () => !!req.user;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api", surveys, preferences);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}/api`;
  const request = async (path: string, method = "GET", body?: unknown, actor?: string) => {
    const response = await fetch(base + path, { method, redirect: "manual", headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(actor ? { "x-test-user": actor } : {}),
    }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const save = (fields: object, actor = owner.id) => request("/configuracion/preferencias", "PUT", { ...preferenciasDefault, ...fields }, actor);
  const survey = (i: number, suffix = "") => `/encuestas/${tokens[i]}${suffix}`;
  assert.equal((await request("/encuestas/stats/resumen")).status, 401);
  assert.equal((await request(survey(0))).body.googleReviewUrl, null);
  assert.equal((await request(survey(0, "/responder?calificacion=1"))).status, 302);
  assert.equal((await request(survey(0))).body.yaRespondida, false, "GET/email prefetch never records answers");
  assert.equal((await request(survey(0, "/comentario"), "POST", { comentario: "Before response" })).status, 409);
  const link = "https://g.page/r/QA_123/review";
  for (const bad of ["javascript:alert(1)", "https://g.page.evil/r/x/review", "https://evil.com/review", "https://g.page@evil.com/r/x/review"]) {
    assert.equal((await save({ googleReviewUrl: bad })).status, 400);
  }
  assert.equal((await save({ googleReviewEnabled: true })).status, 400);
  assert.equal((await save({ googleReviewUrl: link, googleReviewEnabled: true }, staff.id)).status, 403);
  assert.equal((await save({ googleReviewUrl: link, googleReviewEnabled: true })).status, 200);
  assert.equal((await request("/configuracion/preferencias", "GET", undefined, staff.id)).body.googleReviewUrl, link);
  assert.equal((await request(survey(0, "/google"), "POST")).status, 409);
  for (const [i, rating] of [1, 5, 3].entries()) {
    const answer = await request(survey(i), "POST", { calificacion: rating });
    assert.equal(answer.status, 200); assert.equal(answer.body.googleReviewUrl, link, "Invite every rating");
    assert.equal(answer.body.googleRedirigido, false, "Showing invitation is not a click");
  }
  const comment = await request(survey(0, "/comentario"), "POST", { comentario: "  Atención privada  " });
  assert.equal(comment.body.comentario, "Atención privada");
  assert.equal((await request(survey(0, "/comentario"), "POST", { comentario: "Overwrite" })).body.comentario, "Atención privada");
  assert.equal((await request(survey(0), "POST", { calificacion: 5, comentario: "Overwrite" })).body.calificacion, 1);
  assert.equal((await request(survey(1, "/comentario"), "POST", { comentario: "x".repeat(2001) })).status, 400);
  await Promise.all(Array.from({ length: 4 }, () => request(survey(0, "/google"), "POST")));
  const [first] = await D.db.select().from(D.encuestasTable).where(eq(D.encuestasTable.token, tokens[0]));
  await request(survey(0, "/google"), "POST");
  const [again] = await D.db.select().from(D.encuestasTable).where(eq(D.encuestasTable.token, tokens[0]));
  assert.equal(again.googleClickedAt!.getTime(), first.googleClickedAt!.getTime(), "Repeated clicks keep first timestamp");
  await request(survey(1, "/google"), "POST");
  let stats = (await request("/encuestas/stats/resumen", "GET", undefined, owner.id)).body;
  assert.equal(stats.googleRedirigidosMes, 1, "Two surveys for one customer count once");
  assert.equal(stats.recientes.filter((r: any) => r.googleRedirigido).length, 2);
  assert.ok(stats.recientes.some((r: any) => r.comentario === "Atención privada"), "Owner receives private comment in own list");
  assert.equal((await request("/encuestas/stats/resumen", "GET", undefined, outside.id)).body.respondidas, 0);
  await request(survey(2, "/google"), "POST");
  const previousChileMonth = new Date(`${hoySantiago().slice(0, 7)}-01T01:00:00Z`);
  await D.db.update(D.encuestasTable).set({ googleClickedAt: previousChileMonth }).where(eq(D.encuestasTable.token, tokens[2]));
  stats = (await request("/encuestas/stats/resumen", "GET", undefined, owner.id)).body;
  assert.equal(stats.googleRedirigidosMes, 1, "Month boundary uses Chile, not UTC");
  await save({ googleReviewUrl: link, googleReviewEnabled: false });
  assert.equal((await request(survey(0))).body.googleReviewUrl, null);
  assert.equal((await request(survey(0, "/google"), "POST")).status, 409);
  await save({ googleReviewUrl: "", googleReviewEnabled: false });
  assert.equal((await request("/configuracion/preferencias", "GET", undefined, owner.id)).body.googleReviewUrl, "");
  assert.equal((await request("/encuestas/not-a-token/google", "POST")).status, 404);
  console.log("PASS satisfaction: scope/admin permissions, URL safety, all ratings, private comments, GET safety, click idempotency, unique customers, Chile month, off/clear");
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (pool) await pool.end();
  await admin.query(`drop schema if exists "${schema}" cascade`);
  await admin.end();
}
