// Chilean RUT validation (módulo 11). Accepts formats like "12.345.678-5",
// "12345678-5" or "123456785". Returns the normalized "12345678-5" form (lower
// "k" for the check digit) or null when invalid.
export function normalizeRut(input: string): string | null {
  const cleaned = input.replace(/[.\s]/g, "").replace(/-/g, "").toLowerCase();
  if (cleaned.length < 2) return null;

  const body = cleaned.slice(0, -1);
  const checkDigit = cleaned.slice(-1);

  if (!/^\d+$/.test(body)) return null;
  if (!/^[0-9k]$/.test(checkDigit)) return null;

  const expected = computeCheckDigit(body);
  if (expected !== checkDigit) return null;

  return `${body}-${checkDigit}`;
}

export function isValidRut(input: string): boolean {
  return normalizeRut(input) !== null;
}

function computeCheckDigit(body: string): string {
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "k";
  return String(remainder);
}
