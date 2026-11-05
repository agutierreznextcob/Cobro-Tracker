export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

// Org date-format preference, set by <PreferenciasSync/> inside the protected
// Layout. null (public pages, before load, after logout) keeps legacy es-CL output.
let formatoFechaGlobal: "DD/MM/YYYY" | "MM/DD/YYYY" | null = null;
export function setFormatoFechaGlobal(f: "DD/MM/YYYY" | "MM/DD/YYYY" | null) {
  formatoFechaGlobal = f;
}
export function getFormatoFechaGlobal() {
  return formatoFechaGlobal;
}

export function formatDate(dateStr: string) {
  if (formatoFechaGlobal) {
    const hora = new Intl.DateTimeFormat("es-CL", { timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(dateStr));
    return `${formatFechaPref(dateStr, formatoFechaGlobal)} ${hora}`;
  }
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateStr));
}

export function formatShortDate(dateStr: string) {
  if (formatoFechaGlobal) return formatFechaPref(dateStr, formatoFechaGlobal);
  return new Intl.DateTimeFormat("es-CL", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

export function formatDateSantiago(dateStr: string | Date | undefined | null) {
  if (!dateStr) return "";
  if (formatoFechaGlobal) return formatFechaPref(typeof dateStr === "string" ? dateStr : dateStr.toISOString(), formatoFechaGlobal);
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
  if (formatoFechaGlobal && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) return formatFechaPref(dateStr.slice(0, 10), formatoFechaGlobal);
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
  }).format(new Date(y, m - 1, d));
}

// ---------------------------------------------------------------------------
// Per-document currency formatting. Every document (cobro, cotización,
// producto) carries its own currency; historical documents without one are
// CLP. Never relabel a document with the org's current preference.
// ---------------------------------------------------------------------------
export const MONEDAS = ["CLP", "USD", "EUR", "UF"] as const;
export type Moneda = (typeof MONEDAS)[number];

export const MONEDA_INFO: Record<Moneda, { simbolo: string; nombre: string }> = {
  CLP: { simbolo: "$", nombre: "Peso chileno" },
  USD: { simbolo: "US$", nombre: "Dólar estadounidense" },
  EUR: { simbolo: "€", nombre: "Euro" },
  UF: { simbolo: "UF", nombre: "Unidad de Fomento" },
};

export function monedaDe(m: string | null | undefined): Moneda {
  return (MONEDAS as readonly string[]).includes(m ?? "") ? (m as Moneda) : "CLP";
}

export function clampDecimales(d: number | null | undefined, moneda?: string | null): number {
  if (d == null || Number.isNaN(d)) return monedaDe(moneda) === "CLP" ? 0 : 2;
  return Math.min(2, Math.max(0, Math.round(d)));
}

export function roundTo(n: number, decimales: number) {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function formatMoney(amount: number, moneda?: string | null, decimales?: number | null) {
  const m = monedaDe(moneda);
  const d = decimales == null ? (m === "CLP" ? 0 : 2) : clampDecimales(decimales, m);
  const v = roundTo(Number(amount) || 0, d);
  if (m === "UF") {
    return `UF ${new Intl.NumberFormat("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}`;
  }
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: m,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(v);
}

export type FormatoFecha = "DD/MM/YYYY" | "MM/DD/YYYY";

/** Formats a date (ISO or YYYY-MM-DD) with the org's preferred numeric pattern. */
export function formatFechaPref(dateStr: string | null | undefined, formato: FormatoFecha = "DD/MM/YYYY") {
  if (!dateStr) return "";
  let y: number, m: number, d: number;
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (mm) {
    y = +mm[1]; m = +mm[2]; d = +mm[3];
  } else {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date(dateStr)).map((p) => [p.type, p.value]),
    );
    y = +parts.year; m = +parts.month; d = +parts.day;
  }
  const dd = String(d).padStart(2, "0");
  const mo = String(m).padStart(2, "0");
  return formato === "MM/DD/YYYY" ? `${mo}/${dd}/${y}` : `${dd}/${mo}/${y}`;
}

export function hoySantiago(offsetDias = 0) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(Date.now() + offsetDias * 86400000)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Sums amounts grouped by document currency and renders "CLP x · USD y". Never mixes currencies. */
export function totalesPorMoneda<T extends { moneda?: string | null; decimales?: number | null }>(rows: T[], monto: (r: T) => number) {
  const map = new Map<Moneda, { total: number; decimales: number }>();
  for (const r of rows) {
    const m = monedaDe(r.moneda);
    const cur = map.get(m) ?? { total: 0, decimales: 0 };
    cur.total += Number(monto(r)) || 0;
    cur.decimales = Math.max(cur.decimales, clampDecimales(r.decimales, m));
    map.set(m, cur);
  }
  return MONEDAS.filter((m) => map.has(m)).map((m) => ({ moneda: m, ...map.get(m)! }));
}

export function formatTotalesPorMoneda<T extends { moneda?: string | null; decimales?: number | null }>(rows: T[], monto: (r: T) => number) {
  const t = totalesPorMoneda(rows, monto);
  if (t.length === 0) return formatMoney(0, "CLP", 0);
  return t.map((x) => formatMoney(x.total, x.moneda, x.decimales)).join(" · ");
}
