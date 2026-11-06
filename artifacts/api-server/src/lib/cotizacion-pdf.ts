import { equivalenciaClpTexto } from "./indicadores";
import type { serializeCotizacion } from "./cotizaciones";
import { documentScope, getEmpresaForScope, getEmpresaLogoBytes } from "./empresa";
import { renderDocumentoPdf } from "./documento-pdf";

export async function cotizacionPdf(q: Awaited<ReturnType<typeof serializeCotizacion>>, negocio: string, formatoFecha = "DD/MM/YYYY"): Promise<Buffer> {
  const empresa = await getEmpresaForScope(documentScope(q.organizationId, q.responsableId));
  if (!empresa.razonSocial) empresa.razonSocial = negocio;
  return renderDocumentoPdf({
    tipo: "COTIZACIÓN", numero: q.numeroCotizacion, estado: q.estado,
    emision: q.fechaEmision, vencimiento: q.fechaVencimiento,
    moneda: q.moneda, decimales: q.decimales, formatoFecha, empresa,
    logo: await getEmpresaLogoBytes(empresa),
    receptor: { nombre: q.clienteNombre, rut: q.clienteRut ?? "", giro: q.clienteGiro,
      direccion: q.clienteDireccion ?? "", email: q.clienteEmail ?? "" },
    items: q.items.map(i => ({ ...i, subtotal: i.subtotalLinea })),
    subtotal: q.subtotal, descuentoGlobal: 0, porcentajeIva: q.porcentajeIva, montoIva: q.montoIva, total: q.total,
    formaPago: q.formaPago, tiempoEntrega: q.tiempoEntrega, validezDias: q.validezDias, notas: q.notas,
    equivalencia: await equivalenciaClpTexto(q.total, q.moneda, q.decimales),
  });
}
