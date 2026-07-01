import { db, usersTable, cobrosTable, trialRutsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";
import { logger } from "./logger";

// Essential accounts that must exist in every environment (dev + production).
// Production is provisioned with only the schema on publish (no data), so these
// accounts are (re)created here on startup. The whole routine is idempotent:
// accounts are matched by email and only inserted when missing, so it is a
// no-op once they exist (e.g. on every subsequent boot and in development).
const DEMO_EMAIL = "anibal.gutierrezbasoalto@gmail.com";
const DEMO_PASSWORD = "Demo2024NextCob!";
const DEMO_RUT = "18027185-6";
const SUPERADMIN_EMAIL = "agutierrez@nextcob.com";

// Demo trial never expires. esDemo already grants permanent access; the
// far-future date keeps every trial/expiry code path happy.
const FAR_FUTURE = new Date("2099-12-31T00:00:00.000Z");

function dateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function ensureDemoUser(): Promise<string | null> {
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, DEMO_EMAIL));
  if (existing) return existing.id;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [created] = await db
    .insert(usersTable)
    .values({
      email: DEMO_EMAIL,
      firstName: "Anibal",
      lastName: "Gutierrezbasoalto",
      rut: DEMO_RUT,
      passwordHash,
      emailVerified: true,
      esDemo: true,
      activo: true,
      subscriptionStatus: "activa",
      trialEndsAt: FAR_FUTURE,
      role: "user",
      profileCompleted: true,
      politicaAceptadaEn: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: usersTable.id });

  // Keep the anti-abuse ledger consistent (1 RUT = 1 trial).
  await db.insert(trialRutsTable).values({ rut: DEMO_RUT }).onConflictDoNothing();

  if (created) {
    logger.info({ email: DEMO_EMAIL }, "Seed: demo account created");
    return created.id;
  }

  // Lost an insert race: fetch the row the other writer created.
  const [after] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, DEMO_EMAIL));
  return after ? after.id : null;
}

async function ensureSuperadmin(): Promise<void> {
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, SUPERADMIN_EMAIL));
  if (existing) return;

  // No password: the superadmin sets it via the "forgot password" flow (now
  // deliverable because the account exists). role=admin grants permanent access.
  await db
    .insert(usersTable)
    .values({
      email: SUPERADMIN_EMAIL,
      firstName: "Soporte",
      lastName: "NextCob",
      passwordHash: null,
      emailVerified: true,
      esDemo: false,
      activo: true,
      subscriptionStatus: "activa",
      role: "admin",
      profileCompleted: true,
    })
    .onConflictDoNothing();
  logger.info({ email: SUPERADMIN_EMAIL }, "Seed: superadmin account created");
}

async function ensureDemoCobros(demoUserId: string): Promise<void> {
  // Resumable + idempotent: only seed sample cobros when the demo account has
  // none yet (fresh production, or a boot where a previous seed created the
  // account but failed before inserting cobros). Dev already has real cobros,
  // so this is a no-op there.
  const [existing] = await db
    .select({ id: cobrosTable.id })
    .from(cobrosTable)
    .where(eq(cobrosTable.responsableId, demoUserId))
    .limit(1);
  if (existing) return;

  const nombre = "Anibal Gutierrezbasoalto";
  await db.insert(cobrosTable).values([
    {
      monto: "150000.00",
      descripcion: "Servicio de asesoría contable - Mayo 2026",
      estado: "pendiente",
      responsableId: demoUserId,
      responsableNombre: nombre,
      clienteNombre: "Comercial Los Andes SpA",
      emailPagador: "pagos@comerciallosandes.cl",
      fechaVencimiento: dateOffset(12),
    },
    {
      monto: "89900.00",
      descripcion: "Plan mensual software de gestión",
      estado: "pagado",
      responsableId: demoUserId,
      responsableNombre: nombre,
      clienteNombre: "Ferretería El Roble Ltda",
      emailPagador: "contacto@ferreteriaelroble.cl",
      fechaVencimiento: dateOffset(-3),
    },
    {
      monto: "320000.00",
      descripcion: "Proyecto desarrollo web - Anticipo",
      estado: "parcial",
      responsableId: demoUserId,
      responsableNombre: nombre,
      clienteNombre: "Inversiones del Sur SpA",
      emailPagador: "gerencia@inversionesdelsur.cl",
      fechaVencimiento: dateOffset(20),
    },
    {
      monto: "55000.00",
      descripcion: "Mantención de equipos - Abril 2026",
      estado: "pendiente",
      responsableId: demoUserId,
      responsableNombre: nombre,
      clienteNombre: "Restaurant La Terraza",
      emailPagador: "administracion@laterraza.cl",
      fechaVencimiento: dateOffset(-8),
    },
  ]);
  logger.info({ demoUserId }, "Seed: demo sample cobros created");
}

// Idempotently ensure the demo + superadmin accounts exist, plus a few sample
// cobros for the demo when it has none. Safe to run on every startup.
export async function seedEssentialAccounts(): Promise<void> {
  const demoUserId = await ensureDemoUser();
  await ensureSuperadmin();
  if (demoUserId) {
    await ensureDemoCobros(demoUserId);
  }
}
