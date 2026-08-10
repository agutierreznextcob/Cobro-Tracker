import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { orgRoleEnum } from "./organizaciones";

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Platform subscription status for a user.
// - prueba: within the 14-day free trial
// - activa: paid subscription is active
// - vencida: trial ended without subscription, or a recurring charge failed
// - cancelada: the user cancelled the renewal; access continues until
//   subscription_period_end and then no further charges occur.
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "prueba",
  "activa",
  "vencida",
  "cancelada",
]);

// Platform role. "admin" users have permanent access (no trial/subscription
// gating) and can see platform-wide admin views. Assigned manually in the DB.
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// Users table. Authentication is a 100% custom email + password system (bcrypt
// hashes in passwordHash, cookie sessions in sessionsTable). The session table
// stays for backwards compatibility.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Permanent, human-friendly, sequential public account identifier shown to
  // users and support (format NCB-XXXXXXXXXX, zero-padded to 10 digits, and
  // grows naturally past 10 digits — e.g. NCB-10000000000 — so there is never a
  // cap). Reserved low values: NCB-0000000001 = superadmin, NCB-0000000002 is
  // intentionally left unassigned, NCB-0000000003 = demo account; real accounts
  // are handed NCB-0000000004 onward (the identity sequence floor is enforced by
  // the startup seed, see lib/seed.ts).
  // accountSeq is the sequential source (an identity column, assigned by the DB
  // and never reused); accountId is the formatted string as a STORED generated
  // column, so it is always consistent and directly queryable. Neither is ever
  // set by the application at runtime (only the one-time startup seed overrides
  // accountSeq for the reserved accounts); the database generates accountId
  // automatically, so the identifier is immutable across email/profile changes.
  // Uniqueness is structural, not enforced by a UNIQUE constraint: account_seq
  // is an identity (values never repeat or get reused) and account_id is a pure
  // deterministic function of it, so two rows can never collide. We deliberately
  // avoid a UNIQUE constraint because adding one to a populated table makes
  // `drizzle-kit push` require an interactive truncate confirmation, which
  // breaks non-interactive schema sync (dev push and production deploys).
  accountSeq: integer("account_seq").generatedByDefaultAsIdentity(),
  accountId: varchar("account_id").generatedAlwaysAs(
    sql`'NCB-' || lpad(account_seq::text, 10, '0')`,
  ),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // Custom auth fields. passwordHash is null for accounts seeded by migration
  // (demo / superadmin), who set their password via the password-reset flow.
  passwordHash: varchar("password_hash"),
  emailVerified: boolean("email_verified").notNull().default(false),
  // esDemo accounts have permanent access (no trial/subscription gating), like
  // platform admins. Used for the showcase/demo account.
  esDemo: boolean("es_demo").notNull().default(false),
  // Brute-force protection: after 5 failed logins the account is locked until
  // lockedUntil. Reset on a successful login.
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  // Platform subscription fields.
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '14 days'`),
  subscriptionStatus: subscriptionStatusEnum("subscription_status")
    .notNull()
    .default("prueba"),
  role: userRoleEnum("role").notNull().default("user"),
  // Multi-tenant organization fields. organizationId links the user to their
  // organization; orgRole is their role within it (admin_org sees everything,
  // ejecutivo only their assigned cobros/clientes). activo=false disables a
  // team member without deleting their data. No hard FK by convention.
  organizationId: integer("organization_id"),
  orgRole: orgRoleEnum("org_role"),
  // For ejecutivos: users.id of the supervisor they report to (null when the
  // ejecutivo reports directly to the admin, or for admin/supervisor roles).
  // No hard FK by convention (matches organizationId).
  supervisorId: varchar("supervisor_id"),
  activo: boolean("activo").notNull().default(true),
  // Mandatory profile fields collected on first login. profileCompleted gates
  // access to the rest of the platform until the onboarding form is submitted.
  // RUT must be unique across the whole platform (one account per RUT). Null
  // until a profile is completed; Postgres allows multiple NULLs under unique.
  rut: varchar("rut").unique(),
  phone: varchar("phone"),
  address: varchar("address"),
  companyName: varchar("company_name"),
  profileCompleted: boolean("profile_completed").notNull().default(false),
  flowCustomerId: varchar("flow_customer_id"),
  flowSubscriptionId: varchar("flow_subscription_id"),
  flowRegisterToken: varchar("flow_register_token"),
  // Reveniu (cobro recurrente de la suscripción de la plataforma).
  // reveniuPendingSubscriptionId: id devuelto al iniciar el checkout; se
  // promueve a reveniuSubscriptionId cuando llega subscription_activated.
  reveniuSubscriptionId: integer("reveniu_subscription_id"),
  reveniuPendingSubscriptionId: integer("reveniu_pending_subscription_id"),
  // Último monto mensual (CLP, IVA incl.) sincronizado con Reveniu. Cuando el
  // total calculado (base + usuarios extra activos) difiere, el scheduler
  // llama a /subscriptions/{id}/amount/ y actualiza este snapshot.
  reveniuMontoSync: integer("reveniu_monto_sync"),
  // Gracia por pago fallido: timestamp del aviso por email. Tras 3 días sin
  // pago exitoso, el scheduler marca la suscripción como vencida.
  avisoPagoFallidoEn: timestamp("aviso_pago_fallido_en", { withTimezone: true }),
  subscriptionPeriodEnd: timestamp("subscription_period_end", { withTimezone: true }),
  // Renewal reminder bookkeeping: the periodEnd for which a 7-days-before
  // renewal notice was already emailed (prevents duplicate notices per period).
  // Ley 21.719: timestamp the user accepted the Privacy Policy + Terms of Use at
  // registration (consent record). Null for accounts created before this field
  // or seeded by migration (demo/superadmin).
  politicaAceptadaEn: timestamp("politica_aceptada_en", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

// One-time, single-use tokens for email verification and password reset. We
// store only the SHA-256 hash of the raw token (the raw token travels in the
// email link), so a DB leak does not expose usable tokens.
export const authTokenTipoEnum = pgEnum("auth_token_tipo", [
  "verificacion",
  "reset",
]);

export const authTokensTable = pgTable(
  "auth_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    tipo: authTokenTipoEnum("tipo").notNull(),
    tokenHash: varchar("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("IDX_auth_tokens_hash").on(table.tokenHash)],
);

export type AuthToken = typeof authTokensTable.$inferSelect;

// Anti-abuse: records every RUT that has ever been granted a free trial, so a
// RUT can only ever receive a single 14-day trial even if the user re-registers
// with a different email. Persists independently of the user row.
export const trialRutsTable = pgTable("trial_ruts", {
  rut: varchar("rut").primaryKey(),
  primerTrialEn: timestamp("primer_trial_en", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertTrialRutSchema = createInsertSchema(trialRutsTable);
export type TrialRut = typeof trialRutsTable.$inferSelect;
