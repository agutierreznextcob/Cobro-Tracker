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
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "prueba",
  "activa",
  "vencida",
]);

// Platform role. "admin" users have permanent access (no trial/subscription
// gating) and can see platform-wide admin views. Assigned manually in the DB.
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// Users table. Authentication is a 100% custom email + password system (bcrypt
// hashes in passwordHash, cookie sessions in sessionsTable). The session table
// stays for backwards compatibility.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  subscriptionPeriodEnd: timestamp("subscription_period_end", { withTimezone: true }),
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
