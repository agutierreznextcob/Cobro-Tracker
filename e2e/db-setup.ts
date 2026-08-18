/**
 * DB seeder for Playwright invitation tests.
 * Run via tsx by Playwright's globalSetup (not directly by Playwright itself,
 * so @workspace/* packages resolve through pnpm's virtual store).
 *
 * Writes fixture data to /tmp/e2e-inv-fixtures.json so the spec file can
 * read it without needing direct DB access.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import fs from "fs";
import {
  db,
  usersTable,
  organizacionesTable,
  invitacionesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const TS = Date.now();
const TEST_PASSWORD = "InvBrowser2024!";
const DUMMY_RUT_SUFFIX = String(TS % 1_000_000).padStart(6, "0");

const ownerEmail = `e2e-brow-owner-${TS}@example.com`;
const inviteeEmail = `e2e-brow-invitee-${TS}@example.com`;
const newEmail = `e2e-brow-new-${TS}@example.com`;
const otherEmail = `e2e-brow-other-${TS}@example.com`;
const regEmail = `e2e-brow-reg-${TS}@example.com`; // for registration branch test

// Compute a valid Chilean RUT check digit (module 11), same algorithm as
// artifacts/api-server/src/lib/rut.ts#computeCheckDigit
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

// Build a unique valid RUT for the browser registration test form.
// Use a 7-digit base in the 4M–5M range (avoids overlap with other test RUTs).
const regRutBase = 4_000_000 + (TS % 1_000_000);
const regCheckDigit = computeCheckDigit(String(regRutBase));
const regTestRutNorm = `${regRutBase}-${regCheckDigit}`; // stored form, e.g. "4123456-7"
// Formatted with dots for direct input into the browser form field.
const regTestRutFormatted = (() => {
  const s = String(regRutBase);
  const parts: string[] = [];
  let i = s.length;
  while (i > 0) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
    i -= 3;
  }
  return parts.join(".") + "-" + regCheckDigit;
})(); // e.g. "4.123.456-7"

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  // Owner + org
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: ownerEmail,
      firstName: "Brow",
      lastName: "Owner",
      rut: `1${DUMMY_RUT_SUFFIX}-1`,
      passwordHash,
      emailVerified: true,
      activo: true,
      orgRole: "admin_org",
      subscriptionStatus: "activa",
      plan: null,
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();

  const [org] = await db
    .insert(organizacionesTable)
    .values({ nombre: `BrowTestOrg-${TS}`, ownerId: owner.id })
    .returning();

  await db
    .update(usersTable)
    .set({ organizationId: org.id })
    .where(eq(usersTable.id, owner.id));

  // Invitee (existing account) in their own solo org.
  // profileCompleted: true so the app goes to /dashboard after accepting,
  // not to /perfil (profile completion gate).
  const [invitee] = await db
    .insert(usersTable)
    .values({
      email: inviteeEmail,
      firstName: "Invitee",
      lastName: "Brow",
      rut: `2${DUMMY_RUT_SUFFIX}-2`,
      passwordHash,
      emailVerified: true,
      activo: true,
      orgRole: "admin_org",
      subscriptionStatus: "prueba",
      profileCompleted: true,
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();

  const [inviteeOrg] = await db
    .insert(organizacionesTable)
    .values({ nombre: `InviteeSolo-${TS}`, ownerId: invitee.id })
    .returning();

  await db
    .update(usersTable)
    .set({ organizationId: inviteeOrg.id })
    .where(eq(usersTable.id, invitee.id));

  // Other user (wrong-email session test)
  const [other] = await db
    .insert(usersTable)
    .values({
      email: otherEmail,
      firstName: "Other",
      lastName: "Brow",
      rut: `3${DUMMY_RUT_SUFFIX}-3`,
      passwordHash,
      emailVerified: true,
      activo: true,
      orgRole: "admin_org",
      subscriptionStatus: "prueba",
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();

  // Invitation for existing account (used by scenarios 3 & 5 — read-only)
  const tokenExisting = crypto.randomUUID();
  const [invExisting] = await db
    .insert(invitacionesTable)
    .values({
      organizationId: org.id,
      email: inviteeEmail,
      orgRole: "ejecutivo",
      token: tokenExisting,
      estado: "pendiente",
      invitadoPorId: owner.id,
      invitadoPorNombre: "Brow Owner",
    })
    .returning();

  // Invitation consumed by scenario 4 (the "Unirme" acceptance test).
  // Kept separate so scenarios 3 & 5 can still use tokenExisting as pendiente.
  const tokenAccept = crypto.randomUUID();
  const [invAccept] = await db
    .insert(invitacionesTable)
    .values({
      organizationId: org.id,
      email: inviteeEmail,
      orgRole: "ejecutivo",
      token: tokenAccept,
      estado: "pendiente",
      invitadoPorId: owner.id,
      invitadoPorNombre: "Brow Owner",
    })
    .returning();

  // Invitation for new email (no account) — used by scenario 2 (read-only).
  const tokenNew = crypto.randomUUID();
  const [invNew] = await db
    .insert(invitacionesTable)
    .values({
      organizationId: org.id,
      email: newEmail,
      orgRole: "ejecutivo",
      token: tokenNew,
      estado: "pendiente",
      invitadoPorId: owner.id,
      invitadoPorNombre: "Brow Owner",
    })
    .returning();

  // Invitation for the registration branch browser test (scenario 6).
  // This invitation is consumed when the user registers through the form.
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
      invitadoPorNombre: "Brow Owner",
    })
    .returning();

  const fixtures = {
    ts: TS,
    password: TEST_PASSWORD,
    ownerEmail,
    inviteeEmail,
    inviteeId: invitee.id,
    inviteeOrgId: inviteeOrg.id,
    newEmail,
    otherEmail,
    otherId: other.id,
    orgId: org.id,
    ownerId: owner.id,
    tokenExisting,
    tokenNew,
    tokenAccept,
    tokenReg,
    regEmail,
    regTestRutFormatted, // formatted for direct browser form input, e.g. "4.123.456-7"
    regTestRutNorm,      // normalized form stored in DB, e.g. "4123456-7"
    invExistingId: invExisting.id,
    invNewId: invNew.id,
    invAcceptId: invAccept.id,
    invRegId: invReg.id,
  };

  fs.writeFileSync("/tmp/e2e-inv-fixtures.json", JSON.stringify(fixtures, null, 2));
  console.log("✓ Fixtures seeded:", fixtures);
}

main().catch((err) => {
  console.error("Setup error:", err);
  process.exit(1);
});
