import { Router, type Request, type Response, type NextFunction } from "express";
import { db, cotizacionesTable, cotizacionItemsTable, cobrosTable, productosTable, type ItemInventarioSnapshot } from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { requireSubscription } from "../middlewares/requireSubscription";
import { cotizacionScope, cotizacionValues, getScopedCotizacion, serializeCotizacion, estadoCotizacion, CotizacionError } from "../lib/cotizaciones";
import { getOrgContext, getRemitenteContacto } from "../lib/org";
import { getPreferenciasNegocio, hoySantiago } from "../lib/preferencias";
import { cotizacionPdf } from "../lib/cotizacion-pdf";
import { sendCotizacionEmail } from "../lib/email";
import { guardarPdfCotizacion, leerPdfCotizacion } from "../lib/cotizacion-archivo";

const router = Router();
router.use("/cotizaciones", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
}, requireSubscription);
const action = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    void fn(req, res).catch(err => {
      req.log.error({ err }, "Operación de cotización fallida");
      res.status(err instanceof CotizacionError ? err.status : 500).json({ error: err instanceof CotizacionError ? err.message : "No se pudo completar la operación. Intenta nuevamente." });
    });
  };
function assertNotSending(q: { envioEnCurso: Date | null }) {
  if (q.envioEnCurso && Date.now() - q.envioEnCurso.getTime() < 5 * 60_000) throw new CotizacionError("Hay un envío en curso. Intenta nuevamente en unos minutos.", 409);
}
router.get("/cotizaciones", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const rows = await db.select().from(cotizacionesTable).where(cotizacionScope(ctx, req.user!.id)).orderBy(desc(cotizacionesTable.id));
  res.json(await Promise.all(rows.map(serializeCotizacion)));
}));
router.post("/cotizaciones", action(async (req, res) => {
  const { ctx, items, values } = await cotizacionValues(req.user!.id, req.body);
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const q = await db.transaction(async tx => {
    const [created] = await tx.insert(cotizacionesTable).values({ ...values, organizationId: ctx.organizationId, responsableId: req.user!.id, numeroCotizacion: "" }).returning();
    const [numbered] = await tx.update(cotizacionesTable).set({ numeroCotizacion: `${prefs.prefijoCotizacion}${String(created.id).padStart(4, "0")}` }).where(eq(cotizacionesTable.id, created.id)).returning();
    await tx.insert(cotizacionItemsTable).values(items.map(i => ({ ...i, cotizacionId: created.id })));
    return numbered;
  });
  res.status(201).json(await serializeCotizacion(q));
}));
router.get("/cotizaciones/:id", action(async (req, res) => {
  const { q } = await getScopedCotizacion(req.user!.id, Number(req.params.id));
  res.json(await serializeCotizacion(q));
}));
router.patch("/cotizaciones/:id", action(async (req, res) => {
  const { condition, q: original } = await getScopedCotizacion(req.user!.id, Number(req.params.id));
  const { values, items } = await cotizacionValues(req.user!.id, {
    clienteGiro: original.clienteGiro, formaPago: original.formaPago,
    tiempoEntrega: original.tiempoEntrega, validezDias: original.validezDias, ...req.body,
  }, original.decimales);
  const q = await db.transaction(async tx => {
    const [current] = await tx.select().from(cotizacionesTable).where(condition).for("update");
    if (!current) throw new CotizacionError("Cotización no encontrada.", 404);
    assertNotSending(current);
    if (current.envioPdf) throw new CotizacionError("Hay un envío pendiente de confirmar. Reintenta el envío antes de editar.", 409);
    if (current.estado !== "borrador") throw new CotizacionError("Solo puedes editar un borrador.", 409);
    // Currency is immutable even for drafts: changing defaults never relabels documents.
    if (values.moneda !== current.moneda) throw new CotizacionError("La moneda de un documento existente no puede cambiarse.");
    const [updated] = await tx.update(cotizacionesTable).set({ ...values, updatedAt: new Date() }).where(condition).returning();
    await tx.delete(cotizacionItemsTable).where(eq(cotizacionItemsTable.cotizacionId, current.id));
    await tx.insert(cotizacionItemsTable).values(items.map(i => ({ ...i, cotizacionId: current.id })));
    return updated;
  });
  res.json(await serializeCotizacion(q));
}));
router.get("/cotizaciones/:id/pdf", action(async (req, res) => {
  const { q } = await getScopedCotizacion(req.user!.id, Number(req.params.id));
  const sender = await getRemitenteContacto(q.responsableId);
  const prefs = await getPreferenciasNegocio(q.responsableId);
  const pdf = await cotizacionPdf(await serializeCotizacion(q), sender.nombre || "NextCob", prefs.formatoFecha);
  res.type("application/pdf").set("Content-Disposition", `attachment; filename="${q.numeroCotizacion.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`).send(pdf);
}));
router.get("/cotizaciones/:id/pdf-enviado", action(async (req, res) => {
  const { q } = await getScopedCotizacion(req.user!.id, Number(req.params.id));
  if (!q.enviadoEn || !q.envioPdf) throw new CotizacionError("No hay una copia del PDF enviado. Los envíos anteriores a esta función no tienen copia histórica.", 404);
  const pdf = await leerPdfCotizacion(q);
  res.type("application/pdf").set("Cache-Control", "private, no-store")
    .set("Content-Disposition", `attachment; filename="${q.numeroCotizacion.replace(/[^A-Za-z0-9_-]/g, "_")}-enviada.pdf"`).send(pdf);
}));
router.post("/cotizaciones/:id/enviar", action(async (req, res) => {
  const { condition } = await getScopedCotizacion(req.user!.id, Number(req.params.id));
  const claim = new Date();
  const q = await db.transaction(async tx => {
    const [current] = await tx.select().from(cotizacionesTable).where(condition).for("update");
    if (!current) throw new CotizacionError("Cotización no encontrada.", 404);
    if (current.enviadoEn) return current; // Repeat clicks/retries never resend.
    assertNotSending(current);
    if (!current.envioPdf && estadoCotizacion(current) !== "borrador") throw new CotizacionError("Solo puedes enviar un borrador vigente.", 409);
    if (!current.clienteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current.clienteEmail)) throw new CotizacionError("El cliente no tiene un email válido. Actualízalo y vuelve a guardar el borrador.");
    // Persist the exact attachment AND email inputs before contacting the provider.
    // A retry must never regenerate a PDF under the same idempotency key.
    let archivo = current.envioPdf;
    if (!archivo) {
      const remitente = await getRemitenteContacto(current.responsableId);
      const prefs = await getPreferenciasNegocio(current.responsableId);
      const pdf = await cotizacionPdf(await serializeCotizacion(current), remitente.nombre || "NextCob", prefs.formatoFecha);
      const [y, m, d] = current.fechaVencimiento.split("-");
      archivo = await guardarPdfCotizacion(current, pdf, {
        id: current.id, version: current.updatedAt.getTime().toString(), numero: current.numeroCotizacion,
        email: current.clienteEmail!, cliente: current.clienteNombre, total: Number(current.total), moneda: current.moneda,
        decimales: current.decimales, vencimiento: prefs.formatoFecha === "MM/DD/YYYY" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`, remitente,
      });
    }
    // Resend retains idempotency keys for 24h. Never risk a duplicate beyond it.
    if (Date.now() - Date.parse(archivo.preparedAt) > 23 * 60 * 60_000)
      throw new CotizacionError("El envío necesita revisión de soporte antes de volver a intentarlo; no se enviará otro correo para evitar duplicados.", 409);
    const [claimed] = await tx.update(cotizacionesTable).set({ envioEnCurso: claim, envioPdf: archivo }).where(condition).returning();
    return claimed;
  });
  if (q.enviadoEn) { res.json(await serializeCotizacion(q)); return; }
  try {
    const pdf = await leerPdfCotizacion(q);
    await sendCotizacionEmail({ ...q.envioPdf!.email, pdf });
    const [updated] = await db.update(cotizacionesTable).set({ estado: "enviada", enviadoEn: new Date(), envioEnCurso: null, updatedAt: new Date() })
      .where(and(condition, eq(cotizacionesTable.envioEnCurso, claim))).returning();
    if (!updated) throw new CotizacionError("El envío se está conciliando. Actualiza la página.", 409);
    res.json(await serializeCotizacion(updated));
  } catch (err) {
    await db.update(cotizacionesTable).set({ envioEnCurso: null }).where(and(condition, eq(cotizacionesTable.envioEnCurso, claim)));
    throw err;
  }
}));
router.patch("/cotizaciones/:id/estado", action(async (req, res) => {
  const { condition } = await getScopedCotizacion(req.user!.id, Number(req.params.id));
  const estado = req.body.estado;
  if (estado !== "aceptada" && estado !== "rechazada") throw new CotizacionError("Estado inválido.");
  const updated = await db.transaction(async tx => {
    const [q] = await tx.select().from(cotizacionesTable).where(condition).for("update");
    if (!q) throw new CotizacionError("Cotización no encontrada.", 404);
    assertNotSending(q);
    if (estadoCotizacion(q) !== "enviada") throw new CotizacionError("Solo puedes registrar la decisión de una cotización enviada y vigente.", 409);
    const [row] = await tx.update(cotizacionesTable).set({ estado, updatedAt: new Date() }).where(condition).returning();
    return row;
  });
  res.json(await serializeCotizacion(updated));
}));
router.post("/cotizaciones/:id/convertir", action(async (req, res) => {
  const { condition } = await getScopedCotizacion(req.user!.id, Number(req.params.id));
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const updated = await db.transaction(async tx => {
    const [q] = await tx.select().from(cotizacionesTable).where(condition).for("update");
    if (!q) throw new CotizacionError("Cotización no encontrada.", 404);
    if (q.cobroId) return q; // Lock makes conversion idempotent under concurrent requests.
    assertNotSending(q);
    if (q.estado !== "aceptada") throw new CotizacionError("La cotización debe estar aceptada.", 409);
    const items = await tx.select().from(cotizacionItemsTable).where(eq(cotizacionItemsTable.cotizacionId, q.id)).orderBy(cotizacionItemsTable.id);
    const ids = [...new Set(items.flatMap(i => i.productoId == null ? [] : [i.productoId]))];
    const products = ids.length ? await tx.select().from(productosTable).where(inArray(productosTable.id, ids)) : [];
    const inventory = new Map<number, ItemInventarioSnapshot>();
    for (const i of items) {
      if (i.productoId == null) continue;
      const p = products.find(p => p.id === i.productoId);
      if (!p || p.moneda !== q.moneda) throw new CotizacionError("Un producto ya no está disponible en la moneda de la cotización.", 409);
      const old = inventory.get(p.id);
      const cantidad = Number(i.cantidad) + (old?.cantidad ?? 0);
      const subtotal = Number(i.subtotalLinea) + (old ? old.cantidad * old.precioUnitario : 0);
      inventory.set(p.id, { productoId: p.id, nombre: p.nombre, tipo: p.tipo, cantidad, precioUnitario: subtotal / cantidad });
    }
    const sender = await getRemitenteContacto(q.responsableId);
    const [cobro] = await tx.insert(cobrosTable).values({
      cotizacionId: q.id, monto: q.total, moneda: q.moneda, decimales: q.decimales, porcentajeIva: q.porcentajeIva,
      incluyeIva: Number(q.porcentajeIva) > 0, montoNeto: q.subtotal, montoIva: q.montoIva,
      tipoDocumento: Number(q.porcentajeIva) > 0 ? "factura_afecta" : "factura_exenta",
      descripcion: `${q.numeroCotizacion}: ${items.map(i => `${i.cantidad} × ${i.descripcion} (${q.moneda} ${i.subtotalLinea})`).join("; ")}`,
      referencia: q.numeroCotizacion, organizationId: q.organizationId, responsableId: q.responsableId, responsableNombre: sender.nombre,
      clienteId: q.clienteId, clienteNombre: q.clienteNombre, emailPagador: q.clienteEmail,
      fechaVencimiento: q.fechaVencimiento, itemsInventario: [...inventory.values()],
    }).returning();
    await tx.update(cobrosTable).set({ numeroDocumento: `${prefs.prefijoCobro}${String(cobro.id).padStart(4, "0")}` }).where(eq(cobrosTable.id, cobro.id));
    const [row] = await tx.update(cotizacionesTable).set({ cobroId: cobro.id, updatedAt: new Date() }).where(condition).returning();
    return row;
  });
  res.json(await serializeCotizacion(updated));
}));
export default router;
