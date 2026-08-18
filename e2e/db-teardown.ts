/**
 * DB cleanup for Playwright invitation tests.
 * Run via tsx by Playwright's globalTeardown.
 * Reads fixture IDs from /tmp/e2e-inv-fixtures.json.
 */
import fs from "fs";
import {
  db,
  usersTable,
  organizacionesTable,
  invitacionesTable,
} from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

async function main() {
  const raw = fs.readFileSync("/tmp/e2e-inv-fixtures.json", "utf-8");
  const f = JSON.parse(raw);

  // Delete any remaining invitations (including tokenAccept which may be
  // "aceptada" after scenario 4 ran — delete by id not by estado).
  const invIds: number[] = [
    f.invExistingId,
    f.invNewId,
    f.invAcceptId,
    f.invRegId,
  ].filter(Boolean);
  if (invIds.length) {
    await db
      .delete(invitacionesTable)
      .where(inArray(invitacionesTable.id, invIds));
  }
  // Belt-and-suspenders: clean up any stray invitations for our test emails.
  const testEmails = [
    f.inviteeEmail,
    f.newEmail,
    f.ownerEmail,
    f.otherEmail,
    f.regEmail,
  ].filter(Boolean);
  await db
    .delete(invitacionesTable)
    .where(inArray(invitacionesTable.email, testEmails));

  // The browser registration test (scenario 6) creates a new user for regEmail
  // with emailVerified: false. Find and delete that user + their auto-created org.
  if (f.regEmail) {
    const regUsers = await db
      .select({ id: usersTable.id, orgId: usersTable.organizationId })
      .from(usersTable)
      .where(eq(usersTable.email, f.regEmail));
    if (regUsers.length) {
      const regUserIds = regUsers.map((u: { id: string }) => u.id);
      const regOrgIds = regUsers
        .map((u: { orgId: number | null }) => u.orgId)
        .filter(Boolean) as number[];
      await db
        .update(usersTable)
        .set({ organizationId: null })
        .where(inArray(usersTable.id, regUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, regUserIds));
      if (regOrgIds.length) {
        await db
          .delete(organizacionesTable)
          .where(inArray(organizacionesTable.id, regOrgIds));
      }
    }
  }

  // Restore users' orgIds before deleting (avoids FK issues if any)
  const userIds: string[] = [f.ownerId, f.inviteeId, f.otherId].filter(Boolean);
  if (userIds.length) {
    await db
      .update(usersTable)
      .set({ organizationId: null })
      .where(inArray(usersTable.id, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }

  // Delete orgs
  const orgIds: number[] = [f.orgId, f.inviteeOrgId].filter(Boolean);
  if (orgIds.length) {
    await db
      .delete(organizacionesTable)
      .where(inArray(organizacionesTable.id, orgIds));
  }

  fs.unlinkSync("/tmp/e2e-inv-fixtures.json");
  console.log("✓ Fixtures cleaned up");
}

main().catch((err) => {
  console.error("Teardown error:", err);
  process.exit(1);
});
