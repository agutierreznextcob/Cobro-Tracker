import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

// Minimum policy: at least 8 chars, one uppercase letter, one digit.
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

export function isStrongPassword(password: string): boolean {
  return PASSWORD_RE.test(password);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}
