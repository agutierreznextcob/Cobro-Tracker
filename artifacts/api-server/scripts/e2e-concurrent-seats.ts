/**
 * E2E concurrency test: two admins try to reactivate two different members
 * simultaneously when only ONE seat is free. After the FOR UPDATE fix exactly
 * ONE reactivation must win (200) and the other must get 403.
 *
 * Uses DB-direct setup for users/org (to bypass email-verification) and real
 * concurrent HTTP requests to the running API server for the critical section.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/e2e-concurrent-seats.ts
 */
import bcrypt from "bcryptjs";
import {
  db,
  usersTable,
  organizacionesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:80/api";
const TEST_PASSWORD = "ConcTest2024!";

let failures = 0;
const createdUserIds: string[] = [];
const createdOrgIds: number[] = [];

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

async function api(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`Login failed for ${email}: no cookie`);
  return setCookie.split(";")[0];
}

async function cleanup() {
  console.log("\n== Cleanup ==");
  try {
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
    console.log("  ✓ Cleaned up test data");
  } catch (err) {
    console.error("  ! Cleanup error (manual cleanup may be needed):", err);
  }
}

async function main() {
  const ts = Date.now();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  // -------------------------------------------------------------------------
  // 1. Create owner + org with NextCob plan (2 seats).
  //    Owner occupies seat 1; one seat remains free.
  // -------------------------------------------------------------------------
  console.log("== Setup: owner + org (NextCob, 2 seats) ==");

  const ownerEmail = `conc-owner-${ts}@example.com`;

  const [owner] = await db
    .insert(usersTable)
    .values({
      email: ownerEmail,
      firstName: "Seat",
      lastName: "Owner",
      rut: `11111${ts % 100000}-1`,
      passwordHash,
      emailVerified: true,
      activo: true,
      orgRole: "admin_org",
      subscriptionStatus: "activa",
      plan: null, // null → nextcob (2 included seats)
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();
  createdUserIds.push(owner.id);
  check("owner created", !!owner.id);

  const [org] = await db
    .insert(organizacionesTable)
    .values({ nombre: `TestOrg-${ts}`, ownerId: owner.id })
    .returning();
  createdOrgIds.push(org.id);
  check("org created", !!org.id);

  await db
    .update(usersTable)
    .set({ organizationId: org.id })
    .where(eq(usersTable.id, owner.id));
  check("owner linked to org", true);

  // -------------------------------------------------------------------------
  // 2. Create TWO deactivated members in the same org.
  //    With 1 free seat, only ONE reactivation should succeed.
  // -------------------------------------------------------------------------
  console.log("\n== Setup: two deactivated members ==");

  const [memberA] = await db
    .insert(usersTable)
    .values({
      email: `conc-member-a-${ts}@example.com`,
      firstName: "Member",
      lastName: "A",
      rut: `22222${ts % 100000}-2`,
      passwordHash,
      emailVerified: true,
      activo: false, // deactivated
      orgRole: "ejecutivo",
      organizationId: org.id,
      subscriptionStatus: "prueba",
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();
  createdUserIds.push(memberA.id);
  check("member A created (deactivated)", !!memberA.id);

  const [memberB] = await db
    .insert(usersTable)
    .values({
      email: `conc-member-b-${ts}@example.com`,
      firstName: "Member",
      lastName: "B",
      rut: `33333${ts % 100000}-3`,
      passwordHash,
      emailVerified: true,
      activo: false, // deactivated
      orgRole: "ejecutivo",
      organizationId: org.id,
      subscriptionStatus: "prueba",
      politicaAceptadaEn: new Date(),
    } as any)
    .returning();
  createdUserIds.push(memberB.id);
  check("member B created (deactivated)", !!memberB.id);

  // -------------------------------------------------------------------------
  // 3. Login as owner.
  // -------------------------------------------------------------------------
  console.log("\n== Login as owner ==");
  const ownerCookie = await login(ownerEmail, TEST_PASSWORD);
  check("owner logged in", !!ownerCookie);

  // -------------------------------------------------------------------------
  // 4. Fire two concurrent PATCH reactivation requests.
  //    Both see: 1 active member (owner) + 1 free seat (NextCob = 2 total).
  //    The FOR UPDATE lock must serialize them: exactly ONE wins.
  // -------------------------------------------------------------------------
  console.log("\n== Concurrent reactivation (1 free seat) ==");

  const [responseA, responseB] = await Promise.all([
    api(
      "PATCH",
      `/organization/usuarios/${memberA.id}`,
      { activo: true },
      ownerCookie,
    ),
    api(
      "PATCH",
      `/organization/usuarios/${memberB.id}`,
      { activo: true },
      ownerCookie,
    ),
  ]);

  console.log(`  Response A: ${responseA.status}`);
  console.log(`  Response B: ${responseB.status}`);

  const successCount = [responseA.status, responseB.status].filter(
    (s) => s === 200,
  ).length;
  const failCount = [responseA.status, responseB.status].filter(
    (s) => s === 403,
  ).length;

  check("exactly one reactivation succeeded (200)", successCount === 1, {
    statusA: responseA.status,
    statusB: responseB.status,
  });
  check("exactly one reactivation was rejected (403)", failCount === 1, {
    statusA: responseA.status,
    statusB: responseB.status,
  });

  // Verify in the DB that the org has exactly 2 active members.
  const allMembers = await db
    .select({ id: usersTable.id, activo: usersTable.activo })
    .from(usersTable)
    .where(eq(usersTable.organizationId, org.id));
  const activeCount = allMembers.filter((m) => m.activo).length;
  check("org has exactly 2 active members after race (owner + 1 winner)", activeCount === 2, {
    activeCount,
    members: allMembers,
  });

  // -------------------------------------------------------------------------
  await cleanup();

  console.log(
    `\n${failures === 0 ? "✅ All checks passed" : `❌ ${failures} check(s) failed`}`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
