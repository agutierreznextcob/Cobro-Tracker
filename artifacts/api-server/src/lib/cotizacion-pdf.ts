import PDFDocument from "pdfkit";
import { formatDocumentMoney } from "./preferencias";
import type { serializeCotizacion } from "./cotizaciones";

export async function cotizacionPdf(q: Awaited<ReturnType<typeof serializeCotizacion>>, negocio: string, formatoFecha = "DD/MM/YYYY"): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: q.numeroCotizacion, Author: negocio } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const date = (s: string) => {
    const [y, m, d] = s.split("-");
    return formatoFecha === "MM/DD/YYYY" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
  };
  const money = (n: number) => formatDocumentMoney(n, q.moneda, q.decimales);
  const space = (height: number) => { if (doc.y + height > 770) doc.addPage(); };
  doc.fillColor("#0A0A0A").fontSize(22).text(negocio);
  doc.fillColor("#A66F00").fontSize(17).text(`Cotización ${q.numeroCotizacion}`).moveDown();
  doc.fillColor("#333333").fontSize(10);
  doc.text(`Estado: ${q.estado}  |  Moneda: ${q.moneda}`);
  doc.text(`Emisión: ${date(q.fechaEmision)}  |  Vencimiento: ${date(q.fechaVencimiento)}`).moveDown();
  doc.font("Helvetica-Bold").text(q.clienteNombre).font("Helvetica");
  if (q.clienteRut) doc.text(`RUT: ${q.clienteRut}`);
  if (q.clienteDireccion) doc.text(q.clienteDireccion);
  if (q.clienteEmail) doc.text(q.clienteEmail);
  doc.moveDown();
  for (const [index, item] of q.items.entries()) {
    space(75);
    doc.font("Helvetica-Bold").text(`${index + 1}. ${item.descripcion}`).font("Helvetica");
    doc.text(`${item.cantidad} × ${money(item.precioUnitario)} | Descuento: ${item.descuentoPorcentaje}%`);
    doc.text(money(item.subtotalLinea), { align: "right" }).moveDown(0.7);
  }
  space(120);
  doc.text(`Subtotal: ${money(q.subtotal)}`, { align: "right" });
  doc.text(`IVA (${q.porcentajeIva}%): ${money(q.montoIva)}`, { align: "right" });
  doc.font("Helvetica-Bold").fontSize(14).text(`Total: ${money(q.total)}`, { align: "right" }).font("Helvetica").fontSize(10).moveDown();
  if (q.notas) { space(70); doc.text("Observaciones").text(q.notas).moveDown(); }
  space(40);
  doc.fillColor("#666666").fontSize(9).text("Esta cotización no es un documento tributario ni un comprobante de pago.");
  doc.end();
  return result;
}
