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

// Formats a date-only string ("YYYY-MM-DD") without timezone shifting.
export function formatDateOnly(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
  }).format(new Date(y, m - 1, d));
}
