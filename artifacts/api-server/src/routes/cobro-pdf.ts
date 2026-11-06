import { Router } from "express";
import { db, cobrosTable, clientesTable, cotizacionesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireSubscription } from "../middlewares/requireSubscription";
import { getOrgContext, cobroScopeCondition, clienteScopeCondition } from "../lib/org";
import { documentScope, getEmpresaForScope, getEmpresaLogoBytes } from "../lib/empresa";
import { getPreferenciasNegocio, roundMoney } from "../lib/preferencias";
import { serializeCotizacion } from "../lib/cotizaciones";
import { equivalenciaClpTexto } from "../lib/indicadores";
import { renderDocumentoPdf } from "../lib/documento-pdf";

const router = Router();
router.get("/cobros/:id/pdf", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.sendStatus(404); return; }
  try {
    const userId = req.user!.id;
    const ctx = await getOrgContext(userId);
    const [c] = await db.select().from(cobrosTable).where(and(eq(cobrosTable.id, id), cobroScopeCondition(ctx, userId)));
    if (!c || !c.responsableId) { res.sendStatus(404); return; }
    const scope = documentScope(c.organizationId, c.responsableId);
    const empresa = await getEmpresaForScope(scope);
    const [cliente] = c.clienteId ? await db.select().from(clientesTable).where(and(eq(clientesTable.id, c.clienteId), clienteScopeCondition(ctx, userId))) : [];
    const [source] = c.cotizacionId ? await db.select().from(cotizacionesTable).where(eq(cotizacionesTable.id, c.cotizacionId)) : [];
    const quote = source && documentScope(source.organizationId, source.responsableId) === scope ? source : undefined;
    const prefs = await getPreferenciasNegocio(c.responsableId);
    const subtotal = c.incluyeIva ? Number(c.montoNeto ?? c.monto) : Number(c.monto);
    const total = Number(c.monto) - Number(c.montoDescuento ?? 0);
    const numero = c.numeroDocumento || `COB-${String(c.id).padStart(4, "0")}`;
    const items = quote ? (await serializeCotizacion(quote)).items.map(i => ({
      cantidad: i.cantidad, descripcion: i.descripcion, precioUnitario: i.precioUnitario,
      descuentoPorcentaje: i.descuentoPorcentaje, subtotal: i.subtotalLinea,
    })) : c.itemsInventario.map(i => ({
      cantidad: i.cantidad, descripcion: i.nombre, precioUnitario: i.precioUnitario,
      descuentoPorcentaje: 0, subtotal: roundMoney(i.cantidad * i.precioUnitario, c.decimales),
    }));
    if (!items.length) items.push({ cantidad: 1, descripcion: c.descripcion, precioUnitario: subtotal, descuentoPorcentaje: 0, subtotal });
    const ajuste = roundMoney(subtotal - items.reduce((sum, i) => sum + i.subtotal, 0), c.decimales);
    if (ajuste !== 0) items.push({ cantidad: 1, descripcion: "Ajuste de monto del cobro", precioUnitario: ajuste, descuentoPorcentaje: 0, subtotal: ajuste });
    const pdf = await renderDocumentoPdf({
      tipo: "COBRO", numero, estado: c.estado,
      emision: new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(c.creadoEn),
      vencimiento: c.fechaVencimiento, moneda: c.moneda, decimales: c.decimales,
      formatoFecha: prefs.formatoFecha, empresa, logo: await getEmpresaLogoBytes(empresa),
      receptor: { nombre: c.clienteNombre ?? cliente?.nombre ?? "Cliente", rut: quote?.clienteRut ?? cliente?.rut ?? "",
        giro: quote?.clienteGiro ?? cliente?.giro ?? "", direccion: quote?.clienteDireccion ?? cliente?.direccion ?? "", email: c.emailPagador ?? cliente?.email ?? "" },
      items,
      subtotal, descuentoGlobal: Number(c.montoDescuento ?? 0), porcentajeIva: c.incluyeIva ? Number(c.porcentajeIva) : 0,
      montoIva: c.incluyeIva ? Number(c.montoIva ?? 0) : 0, total,
      formaPago: quote?.formaPago ?? empresa.condicionesPago, tiempoEntrega: quote?.tiempoEntrega ?? "",
      validezDias: null, notas: "", equivalencia: await equivalenciaClpTexto(total, c.moneda, c.decimales),
    });
    res.set("Cache-Control", "private, no-store").type("application/pdf")
      .set("Content-Disposition", `attachment; filename="${numero.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`).send(pdf);
  } catch (err) {
    req.log.error({ err, cobroId: id }, "No se pudo generar el documento de cobro");
    res.status(500).json({ error: "No se pudo generar el PDF. Intenta nuevamente." });
  }
});
export default router;
