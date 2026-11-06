import { db, preferenciasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrgContext } from "./org";

export const preferenciasDefault = {
  moneda: "CLP" as const, decimales: 0, porcentajeIva: 19,
  formatoFecha: "DD/MM/YYYY" as const, prefijoCobro: "COB-", prefijoCotizacion: "COT-",
  googleReviewUrl: "", googleReviewEnabled: false,
};
export async function preferenciasScope(userId: string) {
  const ctx = await getOrgContext(userId);
  return { ctx, scope: ctx.organizationId == null ? `user:${userId}` : `org:${ctx.organizationId}` };
}
export async function getPreferenciasNegocio(userId: string) {
  const { scope } = await preferenciasScope(userId);
  const [row] = await db.select().from(preferenciasTable).where(eq(preferenciasTable.scope, scope));
  return row ? { ...row, porcentajeIva: Number(row.porcentajeIva) } : preferenciasDefault;
}
export function roundMoney(n: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}
export function formatDocumentMoney(n: number, moneda = "CLP", decimales = 0) {
  const value = new Intl.NumberFormat("es-CL", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);
  return `${moneda} ${value}`;
}
export function hoySantiago() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
