import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

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

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // Platform subscription fields.
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '14 days'`),
  subscriptionStatus: subscriptionStatusEnum("subscription_status")
    .notNull()
    .default("prueba"),
  role: userRoleEnum("role").notNull().default("user"),
  flowCustomerId: varchar("flow_customer_id"),
  flowSubscriptionId: varchar("flow_subscription_id"),
  flowRegisterToken: varchar("flow_register_token"),
  subscriptionPeriodEnd: timestamp("subscription_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
