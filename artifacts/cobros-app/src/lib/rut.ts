// Chilean RUT validation + formatting (módulo 11).

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

export function isValidRut(input: string): boolean {
  const cleaned = input.replace(/[.\s]/g, "").replace(/-/g, "").toLowerCase();
  if (cleaned.length < 2) return false;
  const body = cleaned.slice(0, -1);
  const checkDigit = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  if (!/^[0-9k]$/.test(checkDigit)) return false;
  return computeCheckDigit(body) === checkDigit;
}

// Formats as "12.345.678-5" for display while typing. Leaves partial input
// alone if it isn't yet parseable.
export function formatRut(input: string): string {
  const cleaned = input.replace(/[.\s]/g, "").replace(/-/g, "").toLowerCase();
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned;
  const body = cleaned.slice(0, -1);
  const checkDigit = cleaned.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${checkDigit}`;
}
