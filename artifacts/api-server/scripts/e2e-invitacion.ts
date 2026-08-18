/**
 * E2E invitation flow: verifica el flujo completo de /invitacion/:token
 * desde la perspectiva del cliente HTTP (como si fuera el navegador).
 *
 * Escenarios cubiertos:
 *  1. Token inválido → GET /invitaciones/:token → 404
 *  2. Token válido, email sin cuenta → emailRegistrado: false
 *  3. Token válido, email con cuenta existente → emailRegistrado: true
 *  4. POST /invitaciones/:token/aceptar sin sesión → 401
 *  5. POST aceptar con sesión de otro correo → 403 (email_distinto)
 *  6. POST aceptar con sesión correcta → 200 (se une a la org)
 *  7. POST aceptar nuevamente (ya aceptada) → 404 (estado != pendiente)
 *  8. Crear invitación vía API → token en DB → URL CTA del email resuelve OK
 *  9. Registrar cuenta con token de invitación válido → usuario se une a la org
 * 10. Registrar cuenta con token falso mientras hay inv. pendiente para ese email
 *     → usuario va a org propia (assignOrganization no hace fallback por email)
 *
 * Usa setup directo a la DB (bypass verificación de email) y peticiones HTTP
 * reales al API Server en ejecución, igual que e2e-concurrent-seats.ts.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/e2e-invitacion.ts
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  db,
  usersTable,
  organizacionesTable,
  invitacionesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:80/api";
const TEST_PASSWORD = "InvTest2024!";
const ts = Date.now();

let failures = 0;
const createdUserIds: string[] = [];
const createdOrgIds: number[] = [];
const createdInvIds: number[] = [];

// Compute a valid Chilean RUT check digit (same algorithm as lib/rut.ts)
function computeCheckDigit(body: string): string {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  if (r === 11) return "0";
  if (r === 10) return "k";
  return String(r);
}

function makeRut(base: number): string {
  const body = String(base);
  return `${body}-${computeCheckDigit(body)}`;
}

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(
      `  ✗ ${name}`,
      detail !== undefined ? JSON.stringify(detail, null, 2) : "",
    );
  }
}

/** HTTP helper — returns { status, json, cookie? }. Accepts an optional session
 *  cookie; captures Set-Cookie from the response when present. */
async function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; json: unknown; cookie?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.cookie) headers["Cookie"] = opts.cookie;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : undefined;
  return { status: res.status, json, cookie };
}

/** Log in and return the session cookie. */
async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`Login failed for ${email} (status ${res.status}): no Set-Cookie`);
  }
  return setCookie.split(";")[0];
}

async function cleanup() {
  console.log("\n== Cleanup ==");
  try {
    if (createdInvIds.length > 0) {
      await db
        .delete(invitacionesTable)
        .where(inArray(invitacionesTable.id, createdInvIds));
    }
    if (createdUserIds.length > 0) {
      await db
        .update(usersTable)
        .set({ organizationId: null })
        .where(inArray(usersTable.id, createdUserIds));
      await db
        .delete(usersTable)
        .where(inArray(usersTable.id, createdUserIds));
    }
    if (createdOrgIds.length > 0) {
      await db
        .delete(organizacionesTable)
        .where(inArray(organizacionesTable.id, createdOrgIds));
    }
    console.log("  ✓ Datos de prueba eliminados");
  } catch (err) {
    console.error("  ! Error en cleanup (puede requerir limpieza manual):", err);
  }
}

async function main() {
  // ── Sanity: API Server must be running ──────────────────────────────────────
  const health = await fetch(BASE).catch(() => null);
  if (!health) {
    console.error("✗ API Server no responde. Levanta el workflow del API Server primero.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  // ── 1. Setup: owner + org ───────────────────────────────────────────────────
  console.log("== Setup: owner + org ==");

  const ownerEmail = `inv-owner-${ts}@example.com`;
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: ownerEmail,
      firstName: "Inv",
      lastName: "Owner",
      rut: makeRut(10_000_000 + (ts % 1_000_000)),
      passwordHash,
      emailVerified: true,
      activo: true,
      orgRole: "admin_org",
      subscriptionStatus: "activa",
      plan: null, // nextcob → 2 included seats + pack5 = 7 total
      packsUsuarios: { pack5: 1 }, // extra capacity for CTA + registration scenarios
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();
  createdUserIds.push(owner.id);
  check("owner creado", !!owner.id);

  const [org] = await db
    .insert(organizacionesTable)
    .values({ nombre: `TestInvOrg-${ts}`, ownerId: owner.id })
    .returning();
  createdOrgIds.push(org.id);
  check("org creada", !!org.id);

  await db
    .update(usersTable)
    .set({ organizationId: org.id })
    .where(eq(usersTable.id, owner.id));
  check("owner vinculado a org", true);

  // ── 2. Setup: invitee con cuenta existente ──────────────────────────────────
  console.log("\n== Setup: invitee con cuenta existente ==");

  const inviteeEmail = `inv-invitee-${ts}@example.com`;
  const [invitee] = await db
    .insert(usersTable)
    .values({
      email: inviteeEmail,
      firstName: "Invitee",
      lastName: "Test",
      rut: makeRut(20_000_000 + (ts % 1_000_000)),
      passwordHash,
      emailVerified: true,
      activo: true,
      orgRole: "admin_org",
      subscriptionStatus: "prueba",
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();
  createdUserIds.push(invitee.id);
  check("invitee creado", !!invitee.id);

  // Invitee starts in their own solo org (so they can be moved)
  const [inviteeOrg] = await db
    .insert(organizacionesTable)
    .values({ nombre: `SoloOrg-${ts}`, ownerId: invitee.id })
    .returning();
  createdOrgIds.push(inviteeOrg.id);
  await db
    .update(usersTable)
    .set({ organizationId: inviteeOrg.id })
    .where(eq(usersTable.id, invitee.id));
  check("invitee en su propia org (solo)", true);

  // ── 3. Setup: tercero (sesión de otro correo) ───────────────────────────────
  const otherEmail = `inv-other-${ts}@example.com`;
  const [other] = await db
    .insert(usersTable)
    .values({
      email: otherEmail,
      firstName: "Other",
      lastName: "User",
      rut: makeRut(30_000_000 + (ts % 1_000_000)),
      passwordHash,
      emailVerified: true,
      activo: true,
      orgRole: "admin_org",
      subscriptionStatus: "prueba",
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();
  createdUserIds.push(other.id);
  check("tercero creado", !!other.id);

  // ── 4. Setup: invitaciones en DB ───────────────────────────────────────────
  console.log("\n== Setup: invitaciones ==");

  // Invitation for invitee (existing account)
  const tokenExistente = crypto.randomUUID();
  const [invExistente] = await db
    .insert(invitacionesTable)
    .values({
      organizationId: org.id,
      email: inviteeEmail,
      orgRole: "ejecutivo",
      token: tokenExistente,
      estado: "pendiente",
      invitadoPorId: owner.id,
      invitadoPorNombre: "Inv Owner",
    })
    .returning();
  createdInvIds.push(invExistente.id);
  check("invitación para cuenta existente creada", !!invExistente.id);

  // Invitation for a new email (no account exists) — used by scenarios 2 & 8+
  const newEmail = `inv-new-${ts}@example.com`;
  const tokenNuevo = crypto.randomUUID();
  const [invNuevo] = await db
    .insert(invitacionesTable)
    .values({
      organizationId: org.id,
      email: newEmail,
      orgRole: "ejecutivo",
      token: tokenNuevo,
      estado: "pendiente",
      invitadoPorId: owner.id,
      invitadoPorNombre: "Inv Owner",
    })
    .returning();
  createdInvIds.push(invNuevo.id);
  check("invitación para correo sin cuenta creada", !!invNuevo.id);

  // ── ESCENARIO 1: Token inválido ─────────────────────────────────────────────
  console.log("\n== Escenario 1: token inválido ==");
  const r1 = await req("GET", "/invitaciones/token-invalido-e2e-xyz");
  check("token inválido → 404", r1.status === 404, r1);
  check("token inválido → sin 401/403", r1.status !== 401 && r1.status !== 403, r1.status);

  // ── ESCENARIO 2: Token válido, email sin cuenta ─────────────────────────────
  console.log("\n== Escenario 2: token válido, correo sin cuenta ==");
  const r2 = await req("GET", `/invitaciones/${tokenNuevo}`);
  check("token sin cuenta → 200", r2.status === 200, r2);
  check("valida: true", (r2.json as any)?.valida === true, r2.json);
  check("emailRegistrado: false", (r2.json as any)?.emailRegistrado === false, r2.json);
  check("email correcto", (r2.json as any)?.email === newEmail, r2.json);
  check("organizacionNombre presente", !!(r2.json as any)?.organizacionNombre, r2.json);

  // ── ESCENARIO 3: Token válido, email con cuenta existente ───────────────────
  console.log("\n== Escenario 3: token válido, correo con cuenta existente ==");
  const r3 = await req("GET", `/invitaciones/${tokenExistente}`);
  check("token con cuenta → 200", r3.status === 200, r3);
  check("valida: true", (r3.json as any)?.valida === true, r3.json);
  check("emailRegistrado: true", (r3.json as any)?.emailRegistrado === true, r3.json);
  check("email correcto", (r3.json as any)?.email === inviteeEmail, r3.json);
  check("orgRole presente", !!(r3.json as any)?.orgRole, r3.json);

  // ── ESCENARIO 4: Aceptar sin sesión → 401 ──────────────────────────────────
  console.log("\n== Escenario 4: aceptar sin sesión → 401 ==");
  const r4 = await req("POST", `/invitaciones/${tokenExistente}/aceptar`);
  check("sin sesión → 401", r4.status === 401, r4);
  check("code no_autenticado", (r4.json as any)?.code === "no_autenticado", r4.json);

  // ── ESCENARIO 5: Aceptar con sesión de otro correo → 403 email_distinto ─────
  console.log("\n== Escenario 5: sesión de otro correo → 403 email_distinto ==");
  const otherCookie = await login(otherEmail, TEST_PASSWORD);
  check("otro usuario logueado", !!otherCookie);
  const r5 = await req("POST", `/invitaciones/${tokenExistente}/aceptar`, {
    cookie: otherCookie,
  });
  check("otro correo → 403", r5.status === 403, r5);
  check("code email_distinto", (r5.json as any)?.code === "email_distinto", r5.json);

  // Invitación debe seguir pendiente (no fue aceptada)
  const [invAfterR5] = await db
    .select({ estado: invitacionesTable.estado })
    .from(invitacionesTable)
    .where(eq(invitacionesTable.id, invExistente.id));
  check("invitación sigue pendiente tras intento fallido", invAfterR5?.estado === "pendiente", invAfterR5);

  // ── ESCENARIO 6: Aceptar con sesión correcta → 200 ─────────────────────────
  console.log("\n== Escenario 6: sesión correcta → 200 (se une a la org) ==");
  const inviteeCookie = await login(inviteeEmail, TEST_PASSWORD);
  check("invitee logueado", !!inviteeCookie);
  const r6 = await req("POST", `/invitaciones/${tokenExistente}/aceptar`, {
    cookie: inviteeCookie,
  });
  check("aceptar → 200", r6.status === 200, r6);
  check("ok: true en respuesta", (r6.json as any)?.ok === true, r6.json);

  // Verificar en DB que el invitee cambió de org y de rol
  const [inviteeAfter] = await db
    .select({
      organizationId: usersTable.organizationId,
      orgRole: usersTable.orgRole,
    })
    .from(usersTable)
    .where(eq(usersTable.id, invitee.id));
  check("invitee ahora en la org del owner", inviteeAfter?.organizationId === org.id, inviteeAfter);
  check("invitee tiene rol ejecutivo", inviteeAfter?.orgRole === "ejecutivo", inviteeAfter);

  // Invitación marcada como aceptada en DB
  const [invAfterAccept] = await db
    .select({ estado: invitacionesTable.estado, aceptadaEn: invitacionesTable.aceptadaEn })
    .from(invitacionesTable)
    .where(eq(invitacionesTable.id, invExistente.id));
  check("invitación marcada aceptada en DB", invAfterAccept?.estado === "aceptada", invAfterAccept);
  check("aceptadaEn seteado", !!invAfterAccept?.aceptadaEn, invAfterAccept);

  // ── ESCENARIO 7: Re-aceptar invitación ya aceptada → 404 ───────────────────
  console.log("\n== Escenario 7: re-aceptar invitación ya aceptada → 404 ==");
  const r7 = await req("POST", `/invitaciones/${tokenExistente}/aceptar`, {
    cookie: inviteeCookie,
  });
  check("re-aceptar → 404 (estado != pendiente)", r7.status === 404, r7);

  // ── ESCENARIO 8: Crear invitación vía API → token en DB → URL CTA resuelve ──
  // Verifies that invitations created through the real API endpoint generate a
  // valid token that resolves to the correct invitation data when opened —
  // the same check a user would perform by clicking the email CTA link.
  console.log("\n== Escenario 8: crear invitación vía API → URL CTA del email resuelve ==");
  const ownerCookie = await login(ownerEmail, TEST_PASSWORD);
  check("owner logueado", !!ownerCookie);

  const ctaEmail = `inv-cta-${ts}@example.com`;
  const r8a = await req("POST", "/organization/invitaciones", {
    body: { email: ctaEmail, orgRole: "ejecutivo" },
    cookie: ownerCookie,
  });
  check("crear inv vía API → 201", r8a.status === 201, r8a);

  const invApiId = (r8a.json as any)?.id;
  check("respuesta incluye id", !!invApiId, r8a.json);

  // Obtain the token that will be embedded in the email CTA URL from the DB.
  const [invFromDb] = await db
    .select({ id: invitacionesTable.id, token: invitacionesTable.token, email: invitacionesTable.email })
    .from(invitacionesTable)
    .where(eq(invitacionesTable.id, invApiId));
  check("invitación existe en DB", !!invFromDb, invFromDb);
  createdInvIds.push(invFromDb.id);

  const ctaToken = invFromDb.token;

  // GET /invitaciones/:token → simulates opening the email CTA link.
  const r8b = await req("GET", `/invitaciones/${ctaToken}`);
  check("URL CTA del email → 200", r8b.status === 200, r8b);
  check("URL CTA: valida: true", (r8b.json as any)?.valida === true, r8b.json);
  check("URL CTA: email correcto", (r8b.json as any)?.email === ctaEmail, r8b.json);
  check("URL CTA: emailRegistrado: false", (r8b.json as any)?.emailRegistrado === false, r8b.json);
  check("URL CTA: organizacionNombre presente", !!(r8b.json as any)?.organizacionNombre, r8b.json);

  // ── ESCENARIO 9: Registro con token válido → usuario se une a la org ────────
  // Tests the full new-account branch: registration with a valid invitation
  // token immediately assigns the user to the invited org (assignOrganization
  // is called at registration time, before email verification).
  console.log("\n== Escenario 9: registro con token válido → usuario se une a la org ==");

  const regEmail = `inv-reg-${ts}@example.com`;
  const regRutBase = 40_000_000 + (ts % 1_000_000);
  const regRut = makeRut(regRutBase);

  // Create a fresh invitation directly in DB so we control the token.
  const tokenReg = crypto.randomUUID();
  const [invReg] = await db
    .insert(invitacionesTable)
    .values({
      organizationId: org.id,
      email: regEmail,
      orgRole: "ejecutivo",
      token: tokenReg,
      estado: "pendiente",
      invitadoPorId: owner.id,
      invitadoPorNombre: "Inv Owner",
    })
    .returning();
  createdInvIds.push(invReg.id);
  check("invitación de registro creada", !!invReg.id);

  const r9 = await req("POST", "/auth/register", {
    body: {
      nombre: "Reg Test",
      rut: regRut,
      email: regEmail,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
      aceptaPolitica: true,
      invitacionToken: tokenReg,
    },
  });
  check("registro con token → ok: true", (r9.json as any)?.ok === true, r9.json);
  check("requiereVerificacion: true", (r9.json as any)?.requiereVerificacion === true, r9.json);

  // Verify in DB: user is assigned to the invited org, not a solo org.
  const [regUser] = await db
    .select({ id: usersTable.id, organizationId: usersTable.organizationId })
    .from(usersTable)
    .where(eq(usersTable.email, regEmail));
  check("usuario registrado existe en DB", !!regUser, regUser);
  check("usuario asignado a la org invitante", regUser?.organizationId === org.id, {
    userOrgId: regUser?.organizationId,
    invitedOrgId: org.id,
  });
  if (regUser) createdUserIds.push(regUser.id);

  // The invitation must now be marked "aceptada".
  const [invRegAfter] = await db
    .select({ estado: invitacionesTable.estado })
    .from(invitacionesTable)
    .where(eq(invitacionesTable.id, invReg.id));
  check("invitación de registro marcada aceptada", invRegAfter?.estado === "aceptada", invRegAfter);

  // ── ESCENARIO 10: Registro con token falso + inv. pendiente → org propia ────
  // Tests assignOrganization's authoritative-token behavior: when an
  // invitacionToken is provided at registration but does not match any pending
  // invitation (stale/fake), the user must end up in their own solo org even
  // if another pending invitation exists for that email. This directly covers
  // the fix in auth.ts (removed the email-only fallback when a token is given).
  console.log("\n== Escenario 10: registro con token falso + inv. pendiente → org propia (sin fallback) ==");

  const staleEmail = `inv-stale-${ts}@example.com`;
  const staleRutBase = 50_000_000 + (ts % 1_000_000);
  const staleRut = makeRut(staleRutBase);

  // Create a pending invitation for staleEmail in org (represents an existing
  // invitation the user SHOULD have used but provides a wrong token instead).
  const tokenStale = crypto.randomUUID();
  const [invStale] = await db
    .insert(invitacionesTable)
    .values({
      organizationId: org.id,
      email: staleEmail,
      orgRole: "ejecutivo",
      token: tokenStale,
      estado: "pendiente",
      invitadoPorId: owner.id,
      invitadoPorNombre: "Inv Owner",
    })
    .returning();
  createdInvIds.push(invStale.id);
  check("inv. pendiente para email de prueba creada", !!invStale.id);

  // Register with a completely wrong token while the real one is still pending.
  const fakeToken = crypto.randomUUID(); // not in DB
  const r10 = await req("POST", "/auth/register", {
    body: {
      nombre: "Stale Test",
      rut: staleRut,
      email: staleEmail,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
      aceptaPolitica: true,
      invitacionToken: fakeToken,
    },
  });
  check("registro con token falso → ok: true (usuario creado)", (r10.json as any)?.ok === true, r10.json);

  // User must NOT be in the target org — they go to their own solo org.
  const [staleUser] = await db
    .select({ id: usersTable.id, organizationId: usersTable.organizationId })
    .from(usersTable)
    .where(eq(usersTable.email, staleEmail));
  check("usuario stale existe en DB", !!staleUser, staleUser);
  check(
    "usuario stale va a org propia, no a la org invitante (sin fallback)",
    staleUser?.organizationId !== org.id,
    { userOrgId: staleUser?.organizationId, invitedOrgId: org.id },
  );
  if (staleUser) {
    createdUserIds.push(staleUser.id);
    if (staleUser.organizationId) createdOrgIds.push(staleUser.organizationId);
  }

  // The pending invitation must remain "pendiente" — it was never consumed.
  const [invStaleAfter] = await db
    .select({ estado: invitacionesTable.estado })
    .from(invitacionesTable)
    .where(eq(invitacionesTable.id, invStale.id));
  check(
    "inv. pendiente sigue pendiente (no fue consumida por el token falso)",
    invStaleAfter?.estado === "pendiente",
    invStaleAfter,
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  await cleanup();

  // ── Resultado final ─────────────────────────────────────────────────────────
  console.log(
    `\n${failures === 0 ? "✅ Todos los checks OK" : `❌ ${failures} check(s) fallaron`}`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  cleanup().finally(() => process.exit(1));
});
