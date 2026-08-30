export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateStr));
}

export function formatShortDate(dateStr: string) {
  return new Intl.DateTimeFormat("es-CL", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

export function formatDateSantiago(dateStr: string | Date | undefined | null) {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeZone: "America/Santiago",
  }).format(new Date(dateStr));
}

export function isVencidoSantiago(dateStr: string | Date | undefined | null) {
  if (!dateStr) return false;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const now = new Date();
  const nowParts = formatter.formatToParts(now);
  const nowMap = Object.fromEntries(nowParts.map(p => [p.type, p.value]));
  const todayStr = `${nowMap.year}-${nowMap.month}-${nowMap.day}`;

  const targetDate = new Date(dateStr);
  const targetParts = formatter.formatToParts(targetDate);
  const targetMap = Object.fromEntries(targetParts.map(p => [p.type, p.value]));
  const targetStr = `${targetMap.year}-${targetMap.month}-${targetMap.day}`;

  return targetStr < todayStr;
}

// Formats a date-only string ("YYYY-MM-DD") without timezone shifting.
export function formatDateOnly(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
  }).format(new Date(y, m - 1, d));
}
