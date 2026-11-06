export const dayNumber = (day: string) => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / 86400000);
export const dayString = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export const chileDay = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export function inicioPeriodo(periodo: string, hoy: string, oldest: string) {
  const [y, m] = hoy.split("-").map(Number);
  if (periodo === "todo") return oldest < hoy ? oldest : hoy;
  if (periodo === "7dias") return dayString(dayNumber(hoy) - 6);
  if (periodo === "ano") return `${y}-01-01`;
  if (periodo === "trimestre") return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return `${hoy.slice(0, 7)}-01`;
}
export type StockEvent = { id: number; tipo: string; cantidad: string | number; creadoEn: Date; bodegaOrigenId: number | null; bodegaDestinoId: number | null; referenciaCobroId: number | null };
export function stockDelta(m: StockEvent) {
  if (m.bodegaOrigenId != null && m.bodegaDestinoId != null) return 0;
  return Number(m.cantidad) * (m.tipo === "salida" ? -1 : 1);
}
export function stockHistory(stockActual: number, created: string, events: StockEvent[], desde: string, hasta: string) {
  const sorted = [...events].sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime() || a.id - b.id);
  let stock = stockActual - sorted.reduce((s, e) => s + stockDelta(e), 0);
  const start = Math.max(dayNumber(created), dayNumber(desde));
  const end = dayNumber(hasta);
  let cursor = start, sum = 0;
  let open: string | null = null;
  const episodes: { fecha: string; fin: string | null; diasSinStock: number }[] = [];
  for (const e of sorted) {
    const fecha = chileDay(e.creadoEn);
    const day = dayNumber(fecha);
    if (day >= start && day <= end) {
      sum += Math.max(0, stock) * Math.max(0, day - cursor);
      cursor = day;
    }
    const next = Math.round((stock + stockDelta(e)) * 1000) / 1000;
    if (stock > 0 && next <= 0 && !open) open = fecha;
    if (open && next > 0) {
      episodes.push({ fecha: open, fin: fecha, diasSinStock: Math.max(0, dayNumber(fecha) - dayNumber(open)) });
      open = null;
    }
    stock = next;
  }
  if (open) episodes.push({ fecha: open, fin: null, diasSinStock: Math.max(0, end - dayNumber(open)) });
  sum += Math.max(0, stock) * Math.max(0, end - cursor + 1);
  return {
    promedio: sum / Math.max(1, end - start + 1),
    episodes: episodes.filter(e => e.fecha >= desde && e.fecha <= hasta),
    dias: Math.max(1, end - start + 1),
  };
}
