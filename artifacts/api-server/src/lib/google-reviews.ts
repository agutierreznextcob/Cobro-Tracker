import { db, preferenciasTable, type Encuesta } from "@workspace/db";
import { eq } from "drizzle-orm";

// Only direct Google review links, never arbitrary redirects or credentials.
export function validGoogleReviewUrl(url: string): boolean {
  return /^https:\/\/g\.page\/r\/[A-Za-z0-9_-]+\/review\/?$/.test(url);
}

export async function googleReviewForSurvey(e: Encuesta): Promise<string | null> {
  if (e.calificacion == null) return null;
  const scope = e.organizationId != null ? `org:${e.organizationId}` : e.userId ? `user:${e.userId}` : null;
  if (!scope) return null;
  const [prefs] = await db.select().from(preferenciasTable).where(eq(preferenciasTable.scope, scope));
  return prefs?.googleReviewEnabled && validGoogleReviewUrl(prefs.googleReviewUrl) ? prefs.googleReviewUrl : null;
}
