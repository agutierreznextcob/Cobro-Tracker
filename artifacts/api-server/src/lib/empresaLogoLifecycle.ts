// Shared by writers and the maintenance command in EVERY database sharing storage.
export const LOGO_LOCK = 68190421;
export const LOGO_GRACE_MS = 7 * 24 * 3600_000;
export const LOGO_URL_TTL_MS = 900_000;
export const temporaryLogoPath = /^\/objects\/uploads\/[a-f0-9-]{36}$/;
export const normalizedLogoPath = /^\/objects\/empresas\/[a-f0-9]{64}\.png$/;

export type LogoCandidate = { objectPath: string; touchedAt: Date };
export function eligibleLogo(candidate: LogoCandidate, references: Set<string>, now: Date) {
  const temporary = temporaryLogoPath.test(candidate.objectPath);
  if (!temporary && !normalizedLogoPath.test(candidate.objectPath)) return false;
  if (references.has(candidate.objectPath)) return false;
  const age = now.getTime() - candidate.touchedAt.getTime();
  return Number.isFinite(age) && age >= LOGO_GRACE_MS + (temporary ? LOGO_URL_TTL_MS : 0);
}
