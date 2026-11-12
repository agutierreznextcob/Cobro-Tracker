/**
 * Read-only, opt-in provider contract check. No server, DB, send or mutation.
 * Preparation and fixture format: docs/cotizaciones-resend-live.md.
 */
import { readFile } from "node:fs/promises";

if (!process.argv.includes("--live")) {
  console.log("SKIP: Resend real no habilitado. Usar --live --fixture <archivo local>.");
  process.exit(0);
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== "--live" || args[1] !== "--fixture" || !args[2])
    throw new Error("FAIL: usar --live --fixture <archivo local>.");
  if (!process.env.RESEND_API_KEY)
    throw new Error("FAIL: falta RESEND_API_KEY en Secrets.");
  let fixture: unknown;
  try {
    const raw = await readFile(args[2], "utf8");
    if (raw.length > 1_000_000) throw new Error();
    fixture = JSON.parse(raw);
  } catch {
    throw new Error("FAIL: fixture local ilegible, demasiado grande o JSON inválido.");
  }
  const { checkResendContract } = await import("./helpers/resend-contract");
  await checkResendContract(fixture);
  console.log("PASS: contrato Resend, mensaje, adjunto único, CDN HTTPS, lectura y SHA-256 verificados. Sin envíos ni cambios.");
} catch (error) {
  // Only our deliberately sanitized diagnostics may leave this process.
  const message = error instanceof Error && error.message.startsWith("FAIL")
    ? error.message : "FAIL: no se pudo comprobar el contrato. No autoriza reenvío.";
  console.error(message);
  process.exitCode = 1;
}
