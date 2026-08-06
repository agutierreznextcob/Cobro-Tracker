import { db, datosBancariosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decrypt } from "./encrypt";

export interface DatosBancariosDecrypted {
  banco: string;
  tipoCuenta: string;
  numeroCuenta: string;
  titularNombre: string;
  titularRut: string;
  emailComprobantes: string;
}

/**
 * Devuelve los datos bancarios del usuario (número de cuenta desencriptado),
 * o null si no están configurados.
 */
export async function getDatosBancariosUsuario(
  userId: string | null | undefined,
): Promise<DatosBancariosDecrypted | null> {
  if (!userId) return null;
  const [row] = await db
    .select()
    .from(datosBancariosTable)
    .where(eq(datosBancariosTable.userId, userId));
  if (!row) return null;
  try {
    return {
      banco: row.banco,
      tipoCuenta: row.tipoCuenta,
      numeroCuenta: decrypt(row.numeroCuentaEncrypted, row.numeroCuentaIv, row.numeroCuentaAuthTag),
      titularNombre: row.titularNombre,
      titularRut: row.titularRut,
      emailComprobantes: row.emailComprobantes,
    };
  } catch {
    // Clave de encriptación rotada u otro problema: tratar como no configurado.
    return null;
  }
}

/** Bloque de texto plano con los datos de transferencia (WhatsApp). */
export function buildDatosBancariosTextoWa(d: DatosBancariosDecrypted): string {
  return [
    "Datos para transferir:",
    `🏦 ${d.banco} | ${d.tipoCuenta}`,
    `📝 N° ${d.numeroCuenta}`,
    `👤 ${d.titularNombre} | RUT ${d.titularRut}`,
    `📧 Comprobante a: ${d.emailComprobantes}`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bloque HTML con los datos de transferencia (emails de cobranza). */
export function buildDatosBancariosHtml(d: DatosBancariosDecrypted): string {
  return `<span style="display:block;background:#f0f9ff;border-radius:8px;padding:12px 16px;font-size:14px;color:#09090b;border-left:3px solid #0284c7;">
    <strong>Para realizar el pago por transferencia:</strong><br/>
    <strong>Banco:</strong> ${escapeHtml(d.banco)}<br/>
    <strong>Tipo de cuenta:</strong> ${escapeHtml(d.tipoCuenta)}<br/>
    <strong>N° de cuenta:</strong> <span style="font-family:monospace;">${escapeHtml(d.numeroCuenta)}</span><br/>
    <strong>Titular:</strong> ${escapeHtml(d.titularNombre)}<br/>
    <strong>RUT:</strong> ${escapeHtml(d.titularRut)}<br/>
    <strong>Email para comprobante:</strong> ${escapeHtml(d.emailComprobantes)}
  </span>`;
}
