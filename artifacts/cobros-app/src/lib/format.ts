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
