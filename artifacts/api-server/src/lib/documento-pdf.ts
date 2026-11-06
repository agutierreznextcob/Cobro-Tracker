import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { DocumentoPdf } from "./documento-types";
import { formatDocumentMoney } from "./preferencias";

/*
 * Visual PDF renderer for quotes (COTIZACIÓN) and charges (COBRO).
 * Three A4 templates: clasica (neutral), moderna (primary band), bicolor
 * (split header). Content margins are 15mm. No data is invented: empty
 * company/recipient fields render as a dash, IVA only when the document has it.
 * The renderer never fetches anything; the logo comes only from data.logo.
 */

const W = 595.28;
const H = 841.89;
const M = 42.52; // 15mm
const CW = W - 2 * M;
const R = "Helvetica";
const B = "Helvetica-Bold";
const DASH = "—";

type RGB = [number, number, number];
type Doc = PDFKit.PDFDocument;
type Plantilla = "clasica" | "moderna" | "bicolor";
type Logo = { buf: Buffer; w: number; h: number; plate: boolean };

const hexRgb = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  const v = m ? m[1] : "2563EB";
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
};
const mix = (c: RGB, w: RGB, t: number): RGB => c.map((v, i) => Math.round(v + (w[i] - v) * t)) as RGB;
const toHex = (c: RGB) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const val = (s: string | null | undefined) => (s && s.trim() ? s.trim() : DASH);

function fmtDate(s: string | null | undefined, formato: string) {
  if (!s) return DASH;
  const p = s.slice(0, 10).split("-");
  if (p.length !== 3) return s;
  return formato === "MM/DD/YYYY" ? `${p[1]}/${p[2]}/${p[0]}` : `${p[2]}/${p[1]}/${p[0]}`;
}
const fmtNum = (n: number, max = 4) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: max }).format(n);

const ESTADOS: Record<string, string> = {
  borrador: "BORRADOR", enviada: "ENVIADA", aceptada: "ACEPTADA", rechazada: "RECHAZADA", vencida: "VENCIDA",
  pendiente: "PENDIENTE", pagado: "PAGADO", parcial: "PAGO PARCIAL", fallido: "FALLIDO", cancelado: "CANCELADO",
};

async function prepLogos(input: Buffer | null): Promise<{ normal: Logo | null; onColor: Logo | null }> {
  if (!input) return { normal: null, onColor: null };
  try {
    const meta = await sharp(input).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return { normal: null, onColor: null };
    const normalBuf = await sharp(input).png().toBuffer();
    const normal: Logo = { buf: normalBuf, w, h, plate: false };
    let transparent = false;
    if (meta.hasAlpha) {
      const st = await sharp(input).stats();
      transparent = (st.channels[3]?.min ?? 255) < 250;
    }
    if (!transparent) return { normal, onColor: { ...normal, plate: true } };
    // White silhouette preserving the alpha shape (logo on colored band).
    const alpha = await sharp(input).ensureAlpha().extractChannel(3).png().toBuffer();
    const white = await sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } })
      .joinChannel(alpha)
      .png()
      .toBuffer();
    return { normal, onColor: { buf: white, w, h, plate: false } };
  } catch {
    return { normal: null, onColor: null };
  }
}

export async function renderDocumentoPdf(data: DocumentoPdf): Promise<Buffer> {
  const e = data.empresa;
  const plantilla: Plantilla = (["clasica", "moderna", "bicolor"] as const).includes(e.plantilla as Plantilla)
    ? (e.plantilla as Plantilla)
    : "clasica";
  const logos = await prepLogos(data.logo);

  const prim = hexRgb(e.colorPrimario);
  const WHITE: RGB = [255, 255, 255];
  const C = {
    ink: "#111827",
    soft: "#374151",
    muted: "#6B7280",
    line: "#E5E7EB",
    slate: "#1F2937",
    band: "#EEF0F3",
    zebra: "#F4F5F7",
    primary: toHex(prim),
    onPrimary: lum(prim) > 0.55 ? "#111827" : "#FFFFFF",
    tint: toHex(mix(prim, WHITE, 0.92)),
    tint2: toHex(mix(prim, WHITE, 0.8)),
  };
  // All templates use the configured brand accent; classic keeps dark headings.
  const accent = C.primary;

  const doc: Doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    info: { Title: `${data.tipo} ${data.numero}`, Author: e.razonSocial || "NextCob", Creator: "NextCob" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => {
    doc.on("end", () => res(Buffer.concat(chunks)));
    doc.on("error", rej);
  });

  type TO = { size?: number; bold?: boolean; color?: string; width?: number; align?: "left" | "right" | "center"; lineGap?: number; chars?: number };
  const txt = (s: string, x: number, y: number, o: TO = {}) => {
    doc.font(o.bold ? B : R).fontSize(o.size ?? 9).fillColor(o.color ?? C.ink);
    doc.text(s, x, y, { width: o.width, align: o.align, lineGap: o.lineGap ?? 1, characterSpacing: o.chars });
    return doc.y - y;
  };
  const line1 = (s: string, x: number, y: number, o: TO & { width: number }) => {
    doc.font(o.bold ? B : R).fontSize(o.size ?? 9).fillColor(o.color ?? C.ink);
    doc.text(s, x, y, { width: o.width, align: o.align, lineBreak: false, ellipsis: true, height: (o.size ?? 9) * 1.3, characterSpacing: o.chars });
  };
  const measure = (s: string, width: number, size: number, bold = false, lineGap = 1) => {
    doc.font(bold ? B : R).fontSize(size);
    return doc.heightOfString(s || " ", { width, lineGap });
  };
  const splitFit = (s: string, width: number, size: number, maxH: number, bold = false): [string, string] => {
    if (measure(s, width, size, bold) <= maxH) return [s, ""];
    const fits = (t: string) => measure(t, width, size, bold) <= maxH;
    const words = s.split(/(\s+)/);
    let lo = 0;
    let hi = words.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fits(words.slice(0, mid).join(""))) lo = mid;
      else hi = mid - 1;
    }
    if (lo > 0) return [words.slice(0, lo).join("").trimEnd(), words.slice(lo).join("").trimStart()];
    // Single overlong token: split by characters.
    let a = 0;
    let b = s.length;
    while (a < b) {
      const mid = (a + b + 1) >> 1;
      if (fits(s.slice(0, mid))) a = mid;
      else b = mid - 1;
    }
    a = Math.max(a, 1);
    return [s.slice(0, a), s.slice(a)];
  };

  const drawLogo = (logo: Logo | null, x: number, y: number, bw: number, bh: number, align: "left" | "center" | "right") => {
    if (!logo) return { w: 0, h: 0 };
    const pad = logo.plate ? 5 : 0;
    const s = Math.min((bw - 2 * pad) / logo.w, (bh - 2 * pad) / logo.h, 1);
    const dw = logo.w * s;
    const dh = logo.h * s;
    const ox = align === "left" ? x : align === "right" ? x + bw - dw - 2 * pad : x + (bw - dw - 2 * pad) / 2;
    if (logo.plate) {
      doc.save().roundedRect(ox, y, dw + 2 * pad, dh + 2 * pad, 3).fill("#FFFFFF").restore();
    }
    doc.image(logo.buf, ox + pad, y + pad, { width: dw, height: dh });
    return { w: dw + 2 * pad, h: dh + 2 * pad };
  };

  const dir = [e.direccion, e.ciudad].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  const empresaLineas = (): string[] => {
    const l = [`RUT ${val(e.rut)}`, `Giro: ${val(e.giro)}`, `Dirección: ${dir || DASH}`, `Tel.: ${val(e.telefono)}`, `Email: ${val(e.email)}`];
    if (e.sitioWeb?.trim()) l.push(e.sitioWeb.trim());
    return l;
  };
  const r = data.receptor;
  const receptorLineas: [string, string][] = [
    ["Señor(es)", val(r.nombre)],
    ["RUT", val(r.rut)],
    ["Giro", val(r.giro)],
    ["Dirección", val(r.direccion)],
  ];
  if (r.email?.trim()) receptorLineas.push(["Email", r.email.trim()]);

  const money = (n: number) => formatDocumentMoney(n, data.moneda, data.decimales);
  const titulo = data.tipo;
  const esCot = data.tipo === "COTIZACIÓN";

  // ---------- page geometry ----------
  const footerReserve = plantilla === "bicolor" ? 58 : 44;
  const bottom = H - M - footerReserve;
  let y = M;

  const contHeader = () => {
    if (plantilla !== "clasica") doc.save().rect(0, 0, W, 6).fill(C.primary).restore();
    line1(e.razonSocial || DASH, M, M, { width: CW / 2, bold: true, size: 9 });
    line1(`${titulo} ${data.numero} (continuación)`, M + CW / 2, M, { width: CW / 2, align: "right", size: 9, color: C.muted });
    doc.save().moveTo(M, M + 16).lineTo(W - M, M + 16).lineWidth(0.5).stroke(C.line).restore();
    return M + 26;
  };
  const newPage = () => {
    doc.addPage();
    y = contHeader();
  };
  const ensure = (h: number) => {
    if (y + h > bottom) {
      newPage();
      return true;
    }
    return false;
  };

  // ---------- headers ----------
  const metaCells = (): [string, string][] => {
    const c: [string, string][] = [["N°", data.numero], ["Fecha de emisión", fmtDate(data.emision, data.formatoFecha)]];
    if (data.vencimiento) c.push([esCot ? "Válida hasta" : "Vencimiento", fmtDate(data.vencimiento, data.formatoFecha)]);
    return c;
  };

  const headerClasica = () => {
    const bw = 300;
    const bx = W - M - bw;
    let cy = M;
    cy += txt(e.razonSocial || DASH, bx, cy, { width: bw, align: "right", bold: true, size: 13 }) + 2;
    for (const l of empresaLineas()) cy += txt(l, bx, cy, { width: bw, align: "right", size: 8.5, color: C.soft });
    const lg = drawLogo(logos.normal, M, M, 170, 70, "left");
    if (!logos.normal) txt((e.razonSocial || "").slice(0, 40), M, M + 4, { width: 170, bold: true, size: 15, color: C.slate });
    y = Math.max(cy, M + lg.h) + 14;
    // Title band
    doc.save().rect(M, y, CW, 30).fill(C.band).restore();
    txt(titulo, M, y + 8, { width: CW, align: "center", bold: true, size: 15, color: C.slate, chars: 2 });
    y += 40;
    // Meta boxes
    const cells = metaCells();
    const cw = CW / cells.length;
    cells.forEach(([k, v], i) => {
      const x = M + i * cw;
      doc.save().rect(x + (i ? 4 : 0), y, cw - 4, 38).lineWidth(0.6).stroke("#D1D5DB").restore();
      line1(k.toUpperCase(), x + 10, y + 7, { width: cw - 20, size: 7, color: C.muted, chars: 0.6 });
      line1(v, x + 10, y + 18, { width: cw - 20, size: i === 0 ? 13 : 11, bold: true });
    });
    y += 50;
    // Client block with left border
    const h = 16 + receptorLineas.length * 12.5;
    doc.save().rect(M, y, CW, h).fill("#F8F9FA").rect(M, y, 3, h).fill(C.primary).restore();
    receptorLineas.forEach(([k, v], i) => {
      line1(`${k}:`, M + 14, y + 8 + i * 12.5, { width: 70, size: 8.5, color: C.muted, bold: true });
      line1(v, M + 84, y + 8 + i * 12.5, { width: CW - 96, size: 8.5, bold: i === 0 });
    });
    y += h + 16;
  };

  const headerModerna = () => {
    const pad = 22;
    const nameW = CW * 0.58;
    const lg = logos.onColor;
    let lh = 0;
    let lw = 0;
    if (lg) {
      const s = Math.min(130 / lg.w, 46 / lg.h, 1);
      lw = lg.w * s + (lg.plate ? 10 : 0);
      lh = lg.h * s + (lg.plate ? 10 : 0);
    }
    const nameX = lg ? M + lw + 12 : M;
    const nameH = measure(e.razonSocial || DASH, nameW - (nameX - M), 15, true);
    const bandH = Math.max(lh, nameH, 50) + pad * 2;
    doc.save().rect(0, 0, W, bandH).fill(C.primary).restore();
    if (lg) drawLogo(lg, M, (bandH - lh) / 2, lw, lh, "left");
    txt(e.razonSocial || DASH, nameX, (bandH - nameH) / 2, { width: nameW - (nameX - M), bold: true, size: 15, color: C.onPrimary });
    line1(titulo, M + CW - 200, bandH / 2 - 22, { width: 200, align: "right", size: 8, color: C.onPrimary, chars: 2 });
    line1(data.numero, M + CW - 200, bandH / 2 - 10, { width: 200, align: "right", size: 22, bold: true, color: C.onPrimary });
    y = bandH + 20;
    // dates row
    const cells = metaCells().slice(1);
    let x = M;
    for (const [k, v] of cells) {
      line1(k.toUpperCase(), x, y, { width: 150, size: 7, color: C.muted, chars: 0.8 });
      line1(v, x, y + 10, { width: 150, size: 10, bold: true });
      x += 150;
    }
    y += 34;
    // Two columns divided by vertical rule
    const colW = CW / 2 - 16;
    const startY = y;
    let ly = y;
    line1("DE", M, ly, { width: colW, size: 7, color: C.primary, bold: true, chars: 1.2 });
    ly += 13;
    ly += txt(e.razonSocial || DASH, M, ly, { width: colW, bold: true, size: 10 }) + 2;
    for (const l of empresaLineas()) ly += txt(l, M, ly, { width: colW, size: 8.5, color: C.soft });
    const rx = M + CW / 2 + 16;
    let ry = y;
    line1("PARA", rx, ry, { width: colW, size: 7, color: C.primary, bold: true, chars: 1.2 });
    ry += 13;
    receptorLineas.forEach(([k, v], i) => {
      ry += txt(i === 0 ? v : `${k}: ${v}`, rx, ry, { width: colW, size: i === 0 ? 10 : 8.5, bold: i === 0, color: i === 0 ? C.ink : C.soft }) + (i === 0 ? 2 : 0);
    });
    const endY = Math.max(ly, ry);
    doc.save().moveTo(M + CW / 2, startY).lineTo(M + CW / 2, endY).lineWidth(0.6).stroke(C.line).restore();
    y = endY + 22;
  };

  const headerBicolor = () => {
    const half = W / 2;
    const bw = W - M - (half + 22);
    let cy = M - 6;
    cy += txt(e.razonSocial || DASH, half + 22, cy, { width: bw, bold: true, size: 12.5 }) + 3;
    for (const l of empresaLineas()) cy += txt(l, half + 22, cy, { width: bw, size: 8.5, color: C.soft });
    const lg = logos.onColor;
    const hdrH = Math.max(cy + 14, 128);
    doc.save().rect(0, 0, half, hdrH).fill(C.primary).restore();
    const titleH = 16;
    if (lg) {
      const s = Math.min((half - 2 * M - 10) / lg.w, (hdrH - 70) / lg.h, 1);
      const lh = lg.h * s + (lg.plate ? 10 : 0);
      drawLogo(lg, M, (hdrH - titleH - 8 - lh) / 2, half - 2 * M, lh, "left");
    } else {
      txt(e.razonSocial || DASH, M, hdrH / 2 - 26, { width: half - 2 * M, bold: true, size: 16, color: C.onPrimary });
    }
    line1(titulo, M, hdrH - titleH - 14, { width: half - 2 * M, size: 11, bold: true, color: C.onPrimary, chars: 2.5 });
    y = hdrH + 20;
    // number + status badge
    line1(`N° ${data.numero}`, M, y, { width: CW - 140, size: 18, bold: true, color: C.primary });
    const est = ESTADOS[data.estado] ?? (data.estado || "").toUpperCase();
    if (est) {
      doc.font(B).fontSize(8);
      const tw = doc.widthOfString(est, { characterSpacing: 1 }) + 20;
      const bx = W - M - tw;
      doc.save().roundedRect(bx, y + 2, tw, 18, 9).fill(C.tint2).restore();
      line1(est, bx, y + 7.5, { width: tw, align: "center", size: 8, bold: true, color: C.primary, chars: 1 });
    }
    y += 28;
    const cells = metaCells().slice(1);
    line1(cells.map(([k, v]) => `${k}: ${v}`).join("     "), M, y, { width: CW, size: 9, color: C.soft });
    y += 22;
    // recipient grid
    const colW = CW / 2;
    const rows = Math.ceil(receptorLineas.length / 2);
    const h = 26 + rows * 24;
    doc.save().rect(M, y, CW, h).lineWidth(0.6).stroke(C.line).rect(M, y, CW, 18).fill(C.tint).restore();
    line1("DATOS DEL RECEPTOR", M + 10, y + 5.5, { width: CW - 20, size: 7.5, bold: true, color: C.primary, chars: 1 });
    receptorLineas.forEach(([k, v], i) => {
      const cx = M + 10 + (i % 2) * colW;
      const ry = y + 24 + Math.floor(i / 2) * 24;
      line1(k.toUpperCase(), cx, ry, { width: colW - 20, size: 6.5, color: C.muted, chars: 0.6 });
      line1(v, cx, ry + 9, { width: colW - 20, size: 9, bold: i === 0 });
    });
    y += h + 18;
  };

  // ---------- table ----------
  const cols = [
    { label: "Cant.", w: 44, align: "center" as const },
    { label: "Descripción", w: CW - 44 - 86 - 46 - 96, align: "left" as const },
    { label: "Precio Unit.", w: 86, align: "right" as const },
    { label: "Desc.%", w: 46, align: "right" as const },
    { label: "Subtotal", w: 96, align: "right" as const },
  ];
  const colX = cols.reduce<number[]>((a, c, i) => (a.push(i ? a[i - 1] + cols[i - 1].w : M), a), []);
  const PX = 5;
  const FS = 8.5;
  const headH = plantilla === "moderna" ? 20 : 22;

  const tableHeader = () => {
    if (plantilla === "clasica") doc.save().rect(M, y, CW, headH).fill(C.slate).restore();
    if (plantilla === "bicolor") doc.save().rect(M, y, CW, headH).fill(C.primary).restore();
    const color = plantilla === "clasica" ? "#FFFFFF" : plantilla === "bicolor" ? C.onPrimary : C.muted;
    cols.forEach((c, i) =>
      line1(plantilla === "moderna" ? c.label.toUpperCase() : c.label, colX[i] + PX, y + (headH - 8) / 2, { width: c.w - 2 * PX, align: c.align, size: plantilla === "moderna" ? 7 : 8, bold: true, color, chars: plantilla === "moderna" ? 0.8 : 0 }),
    );
    if (plantilla === "moderna") doc.save().moveTo(M, y + headH).lineTo(W - M, y + headH).lineWidth(0.9).stroke(C.ink).restore();
    y += headH;
  };

  const drawRow = (idx: number, desc: string, rowH: number, nums: string[] | null) => {
    if (plantilla === "clasica" && idx % 2 === 1) doc.save().rect(M, y, CW, rowH).fill(C.zebra).restore();
    if (plantilla === "bicolor") doc.save().rect(colX[1], y, cols[1].w, rowH).fill(C.tint).restore();
    txt(desc, colX[1] + PX, y + 5, { width: cols[1].w - 2 * PX, size: FS });
    if (nums) {
      [0, 2, 3, 4].forEach((ci, k) => line1(nums[k], colX[ci] + PX, y + 5, { width: cols[ci].w - 2 * PX, align: cols[ci].align, size: FS, bold: ci === 4 }));
    }
    if (plantilla !== "clasica") doc.save().moveTo(M, y + rowH).lineTo(W - M, y + rowH).lineWidth(0.4).stroke(C.line).restore();
    y += rowH;
  };

  const lineH = measure("Ag", 100, FS);
  const firstY = M + 26; // continuation page content start
  const drawItems = () => data.items.forEach((it, idx) => {
    let rest = it.descripcion || DASH;
    let nums: string[] | null = [fmtNum(it.cantidad), money(it.precioUnitario), `${fmtNum(it.descuentoPorcentaje, 2)}%`, money(it.subtotal)];
    while (rest) {
      const dh = measure(rest, cols[1].w - 2 * PX, FS);
      const rowH = Math.max(dh, lineH) + 10;
      if (y + rowH <= bottom) {
        drawRow(idx, rest, rowH, nums);
        rest = "";
        break;
      }
      const fullAvail = bottom - firstY - headH;
      const avail = bottom - y - 10;
      if (rowH <= fullAvail || avail < lineH * 2) {
        newPage();
        tableHeader();
        continue;
      }
      const [a, b] = splitFit(rest, cols[1].w - 2 * PX, FS, avail);
      drawRow(idx, a, measure(a, cols[1].w - 2 * PX, FS) + 10, nums);
      nums = null;
      rest = b;
      newPage();
      tableHeader();
    }
  });

  // ---------- totals ----------
  const drawTotals = () => {
    const rows: { k: string; v: string; strong?: boolean }[] = [{ k: "Subtotal neto", v: money(data.subtotal) }];
    if (data.descuentoGlobal > 0) rows.push({ k: "Descuento global", v: `- ${money(data.descuentoGlobal)}` });
    if (data.porcentajeIva > 0 || data.montoIva !== 0) rows.push({ k: `IVA (${fmtNum(data.porcentajeIva, 2)}%)`, v: money(data.montoIva) });
    const tw = 240;
    const tx = W - M - tw;
    const rh = 17;
    const totalH = 30;
    const eqH = data.equivalencia ? 16 : 0;
    const blockH = 14 + rows.length * rh + totalH + 10 + eqH;
    ensure(blockH);
    y += 14;
    if (plantilla === "moderna") {
      const h = rows.length * rh + totalH + 16;
      doc.save().rect(tx, y, tw, h).fill(C.primary).restore();
      let ty = y + 9;
      for (const r of rows) {
        line1(r.k, tx + 12, ty, { width: 110, size: 8.5, color: C.onPrimary });
        line1(r.v, tx + 110, ty, { width: tw - 122, align: "right", size: 8.5, color: C.onPrimary });
        ty += rh;
      }
      doc.save().moveTo(tx + 12, ty).lineTo(tx + tw - 12, ty).lineWidth(0.5).strokeOpacity(0.5).stroke(C.onPrimary).restore();
      line1("TOTAL", tx + 12, ty + 9, { width: 80, size: 9, bold: true, color: C.onPrimary, chars: 1 });
      line1(money(data.total), tx + 80, ty + 6, { width: tw - 92, align: "right", size: 14, bold: true, color: C.onPrimary });
      y += h;
    } else {
      for (const r of rows) {
        line1(r.k, tx, y, { width: 120, size: 9, color: C.soft });
        line1(r.v, tx + 110, y, { width: tw - 110, align: "right", size: 9 });
        y += rh;
      }
      const lc = plantilla === "bicolor" ? C.primary : C.slate;
      doc.save().moveTo(tx, y).lineTo(W - M, y).lineWidth(plantilla === "bicolor" ? 1.5 : 1).stroke(lc).restore();
      line1("TOTAL", tx, y + 10, { width: 80, size: 10, bold: true, color: plantilla === "bicolor" ? C.primary : C.ink });
      line1(money(data.total), tx + 70, y + 7, { width: tw - 70, align: "right", size: 15, bold: true, color: plantilla === "bicolor" ? C.primary : C.ink });
      y += totalH;
    }
    if (data.equivalencia) {
      line1(data.equivalencia, tx, y + 4, { width: tw, align: "right", size: 7.5, color: C.muted });
      y += eqH;
    }
    y += 10;
  };

  // ---------- conditions / notes / custom footer text (flowing) ----------
  const drawConditions = () => {
    const blocks: [string, string][] = [];
    if (data.formaPago?.trim()) blocks.push(["Condiciones de pago", data.formaPago.trim()]);
    if (data.tiempoEntrega?.trim()) blocks.push(["Tiempo de entrega", data.tiempoEntrega.trim()]);
    if (data.validezDias != null) blocks.push([esCot ? "Validez de la cotización" : "Validez", `${data.validezDias} ${data.validezDias === 1 ? "día" : "días"} desde la fecha de emisión`]);
    if (data.notas?.trim()) blocks.push(["Observaciones", data.notas.trim()]);
    if (e.piePagina?.trim()) blocks.push(["", e.piePagina.trim()]);
    if (!blocks.length) return;
    const boxed = plantilla === "bicolor";
    const ix = boxed ? M + 12 : M;
    const iw = boxed ? CW - 24 : CW;
    ensure(40);
    y += 8;
    if (plantilla === "clasica") { doc.save().moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).stroke(C.line).restore(); y += 10; }
    if (plantilla === "moderna") { line1("CONDICIONES", M, y, { width: CW, size: 7, bold: true, color: C.primary, chars: 1.2 }); y += 14; }
    for (const [label, body] of blocks) {
      const labH = label ? 12 : 0;
      ensure(labH + lineH * 2 + 12);
      let rest = body;
      let first = true;
      while (rest) {
        const lab = first ? labH : 0;
        const avail = bottom - y - lab - 12;
        if (avail < lineH) { newPage(); continue; }
        const [a, b] = splitFit(rest, iw, 8.5, avail);
        const h = lab + measure(a, iw, 8.5) + 10;
        if (boxed) doc.save().rect(M, y, CW, h).fill("#F3F4F6").restore();
        if (lab) line1(label.toUpperCase(), ix, y + 5, { width: iw, size: 7, bold: true, color: C.muted, chars: 0.8 });
        txt(a, ix, y + 5 + lab, { width: iw, size: 8.5, color: label ? C.soft : C.muted });
        y += h;
        rest = b;
        first = false;
        if (rest) newPage();
      }
      y += boxed ? 0 : 4;
    }
  };

  // ---------- page footers ----------
  const ATTR = "Documento generado por NextCob — nextcob.com";
  const drawFooters = () => {
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      const pg = `Página ${i + 1} de ${total}`;
      if (plantilla === "clasica") {
        const fy = H - M - 30;
        doc.save().moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.6).stroke("#D1D5DB").restore();
        const contacto = [e.razonSocial, dir, e.telefono && `Tel. ${e.telefono}`, e.email, e.sitioWeb].map((s) => (s ?? "").trim()).filter(Boolean).join("  ·  ") || DASH;
        line1(contacto, M, fy + 7, { width: CW, size: 7.5, color: C.soft, align: "center" });
        line1(ATTR, M, fy + 19, { width: CW - 80, size: 6.5, color: C.muted });
        line1(pg, W - M - 80, fy + 19, { width: 80, size: 6.5, color: C.muted, align: "right" });
      } else if (plantilla === "moderna") {
        const fy = H - M - 24;
        const contacto = [e.email, e.telefono].map((s) => (s ?? "").trim()).filter(Boolean).join("   ·   ") || DASH;
        line1(contacto, M, fy, { width: CW, size: 8, color: C.soft, align: "center" });
        line1(`${ATTR}   ·   ${pg}`, M, fy + 13, { width: CW, size: 6.5, color: C.muted, align: "center" });
      } else {
        const barH = 24;
        line1(ATTR, M, H - M - barH - 16, { width: CW - 80, size: 6.5, color: C.muted });
        line1(pg, W - M - 80, H - M - barH - 16, { width: 80, size: 6.5, color: C.muted, align: "right" });
        doc.save().rect(M, H - M - barH, CW, barH).fill(C.primary).restore();
        const contacto = [dir, e.telefono && `Tel. ${e.telefono}`, e.email, e.sitioWeb].map((s) => (s ?? "").trim()).filter(Boolean).join("   ·   ") || DASH;
        line1(contacto, M + 6, H - M - barH + 8, { width: CW - 12, size: 7.5, color: C.onPrimary, align: "center" });
      }
    }
  };

  if (plantilla === "clasica") headerClasica();
  else if (plantilla === "moderna") headerModerna();
  else headerBicolor();
  ensure(headH + lineH + 10);
  tableHeader();
  drawItems();
  drawTotals();
  drawConditions();
  drawFooters();
  doc.end();
  return done;
}
