import PDFDocument from "pdfkit";
import { formatDocumentMoney } from "./preferencias";
import { NEXTCOB_LOGO_BASE64 } from "./logo-base64";

const MORADO = "#6C5CE7";
const TEXTO = "#1f2430";
const GRIS = "#6b7280";
const LINEA = "#e4e4e7";

export interface ComprobanteData {
  moneda?: string;
  decimales?: number;
  porcentajeIva?: number;
  numero: string;
  fecha: Date;
  clienteNombre: string;
  quienCobra: string;
  empresa: string;
  descripcion: string;
  metodoPago: string;
  referencia: string | null;
  montoTotal: number;
  montoNeto: number | null;
  montoIva: number | null;
  mensaje?: string | null;
}

function formatCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatFechaHora(d: Date): string {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(d);
}

// Renders a payment receipt ("comprobante de pago") to a PDF Buffer.
export function generarComprobantePdf(data: ComprobanteData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const contentWidth = right - left;

      // ---- Header: logo + title -------------------------------------------
      const logo = Buffer.from(NEXTCOB_LOGO_BASE64, "base64");
      try {
        doc.image(logo, left, 50, { width: 48, height: 48 });
      } catch {
        // If the embedded image fails to decode, continue without it.
      }
      doc
        .fillColor(MORADO)
        .fontSize(22)
        .font("Helvetica-Bold")
        .text("NextCob", left + 60, 56);
      doc
        .fillColor(GRIS)
        .fontSize(10)
        .font("Helvetica")
        .text("Comprobante de pago", left + 60, 82);

      doc
        .fillColor(TEXTO)
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(data.numero, left, 56, { width: contentWidth, align: "right" });
      doc
        .fillColor(GRIS)
        .fontSize(9)
        .font("Helvetica")
        .text(formatFechaHora(data.fecha), left, 72, {
          width: contentWidth,
          align: "right",
        });

      doc
        .moveTo(left, 115)
        .lineTo(right, 115)
        .strokeColor(LINEA)
        .lineWidth(1)
        .stroke();

      // ---- Parties --------------------------------------------------------
      let y = 135;
      const colW = contentWidth / 2;

      const field = (label: string, value: string, x: number, yy: number, w: number) => {
        doc.fillColor(GRIS).fontSize(8).font("Helvetica").text(label.toUpperCase(), x, yy, { width: w });
        doc.fillColor(TEXTO).fontSize(11).font("Helvetica-Bold").text(value, x, yy + 12, { width: w });
      };

      field("Cobrado por", data.empresa, left, y, colW - 10);
      field("Cliente", data.clienteNombre, left + colW, y, colW - 10);
      y += 48;
      field("Atendido por", data.quienCobra, left, y, colW - 10);
      field("Método de pago", data.metodoPago, left + colW, y, colW - 10);
      y += 48;
      if (data.referencia) {
        field("Referencia", data.referencia, left, y, contentWidth);
        y += 48;
      }

      // ---- Detail box -----------------------------------------------------
      doc.fillColor(GRIS).fontSize(8).font("Helvetica").text("DESCRIPCIÓN", left, y);
      y += 14;
      doc.fillColor(TEXTO).fontSize(12).font("Helvetica").text(data.descripcion, left, y, { width: contentWidth });
      y = doc.y + 20;

      // Amount summary box
      const boxTop = y;
      const rows: [string, string, boolean][] = [];
      if (data.montoNeto != null && data.montoIva != null) {
        rows.push(["Neto", formatDocumentMoney(data.montoNeto, data.moneda, data.decimales), false]);
        rows.push([`IVA (${data.porcentajeIva ?? 19}%)`, formatDocumentMoney(data.montoIva, data.moneda, data.decimales), false]);
      }
      rows.push(["Total pagado", formatDocumentMoney(data.montoTotal, data.moneda, data.decimales), true]);

      const rowH = 24;
      const boxH = rows.length * rowH + 16;
      doc.roundedRect(left, boxTop, contentWidth, boxH, 8).fillColor("#f7f6fe").fill();

      let ry = boxTop + 12;
      for (const [label, value, strong] of rows) {
        doc
          .fillColor(strong ? MORADO : GRIS)
          .fontSize(strong ? 13 : 10)
          .font(strong ? "Helvetica-Bold" : "Helvetica")
          .text(label, left + 16, ry, { width: contentWidth / 2 });
        doc
          .fillColor(strong ? MORADO : TEXTO)
          .fontSize(strong ? 14 : 11)
          .font("Helvetica-Bold")
          .text(value, left + contentWidth / 2, ry - (strong ? 1 : 0), {
            width: contentWidth / 2 - 16,
            align: "right",
          });
        ry += rowH;
      }
      y = boxTop + boxH + 24;

      // ---- Optional message ----------------------------------------------
      if (data.mensaje && data.mensaje.trim()) {
        doc.fillColor(GRIS).fontSize(8).font("Helvetica").text("MENSAJE", left, y);
        y += 14;
        doc.fillColor(TEXTO).fontSize(10).font("Helvetica").text(data.mensaje.trim(), left, y, { width: contentWidth });
        y = doc.y + 20;
      }

      // ---- Footer ---------------------------------------------------------
      const footY = doc.page.height - doc.page.margins.bottom - 36;
      doc.moveTo(left, footY).lineTo(right, footY).strokeColor(LINEA).lineWidth(1).stroke();
      doc
        .fillColor(GRIS)
        .fontSize(8)
        .font("Helvetica")
        .text(
          `Este comprobante certifica el pago registrado en NextCob. Documento generado automáticamente · ${data.numero}`,
          left,
          footY + 10,
          { width: contentWidth, align: "center" },
        );

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
