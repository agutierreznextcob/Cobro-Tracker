import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

// Idempotent backfill for the multi-tenant organizations rollout.
//
// 1. Every existing user without an organization becomes the admin_org of their
//    own new solo organization (preserving current data isolation).
// 2. Every cobro/cliente without an organizationId is stamped with the
//    organization of its responsable/owner user.
//
// Safe to run multiple times: each step only touches rows still missing data.
async function main() {
  console.log("Backfill organizaciones: starting...");

  // 1. Create a solo organization for each user that doesn't have one yet.
  const usersSinOrg = await db.execute(sql`
    SELECT id, email, first_name, last_name, company_name
    FROM users
    WHERE organization_id IS NULL
  `);

  let orgsCreadas = 0;
  for (const row of usersSinOrg.rows as Array<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
  }>) {
    const nombre =
      row.company_name?.trim() ||
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
      row.email ||
      "Mi organización";

    const inserted = await db.execute(sql`
      INSERT INTO organizaciones (nombre, owner_id)
      VALUES (${nombre}, ${row.id})
      RETURNING id
    `);
    const orgId = (inserted.rows[0] as { id: number }).id;

    await db.execute(sql`
      UPDATE users
      SET organization_id = ${orgId},
          org_role = COALESCE(org_role, 'admin_org'),
          activo = COALESCE(activo, true)
      WHERE id = ${row.id}
    `);
    orgsCreadas++;
  }
  console.log(`  Organizaciones creadas para usuarios: ${orgsCreadas}`);

  // 2. Stamp cobros with their responsable's organization.
  const cobrosRes = await db.execute(sql`
    UPDATE cobros c
    SET organization_id = u.organization_id
    FROM users u
    WHERE c.responsable_id = u.id
      AND c.organization_id IS NULL
      AND u.organization_id IS NOT NULL
  `);
  console.log(`  Cobros actualizados: ${cobrosRes.rowCount ?? 0}`);

  // 3. Stamp clientes with their owner user's organization.
  const clientesRes = await db.execute(sql`
    UPDATE clientes cl
    SET organization_id = u.organization_id
    FROM users u
    WHERE cl.user_id = u.id
      AND cl.organization_id IS NULL
      AND u.organization_id IS NOT NULL
  `);
  console.log(`  Clientes actualizados: ${clientesRes.rowCount ?? 0}`);

  console.log("Backfill organizaciones: done.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Backfill organizaciones failed:", err);
    pool.end();
    process.exit(1);
  });
