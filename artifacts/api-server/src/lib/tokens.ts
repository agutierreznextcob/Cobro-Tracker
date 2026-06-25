import crypto from "crypto";
import { db, authTokensTable } from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

export type AuthTokenTipo = "verificacion" | "reset";

const VERIFICACION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TTL_MS = 60 * 60 * 1000; // 1h

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Creates a single-use token of the given type. Returns the RAW token (which
// travels in the email link); only its SHA-256 hash is persisted. Any prior
// unused tokens of the same type for this user are invalidated first.
export async function createAuthToken(
  userId: string,
  tipo: AuthTokenTipo,
): Promise<string> {
  await db
    .delete(authTokensTable)
    .where(
      and(eq(authTokensTable.userId, userId), eq(authTokensTable.tipo, tipo)),
    );

  const raw = crypto.randomBytes(32).toString("hex");
  const ttl = tipo === "reset" ? RESET_TTL_MS : VERIFICACION_TTL_MS;
  await db.insert(authTokensTable).values({
    userId,
    tipo,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttl),
  });
  return raw;
}

// Validates and consumes (single-use) a raw token. Returns the userId on
// success, or null when the token is missing, of the wrong type, expired, or
// already used. The check-and-consume happens in a single atomic UPDATE so two
// concurrent requests can never redeem the same token twice.
export async function consumeAuthToken(
  raw: string,
  tipo: AuthTokenTipo,
): Promise<string | null> {
  const tokenHash = hashToken(raw);
  const updated = await db
    .update(authTokensTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokensTable.tokenHash, tokenHash),
        eq(authTokensTable.tipo, tipo),
        isNull(authTokensTable.usedAt),
        gt(authTokensTable.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: authTokensTable.userId });

  return updated[0]?.userId ?? null;
}
