import { Router, type Request, type Response, type NextFunction } from "express";
import { db, guiasDespachoTable, guiaDespachoItemsTable, pedidosTable, pedidoItemsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { getOrgContext } from "../lib/org";
import { getPreferenciasNegocio } from "../lib/preferencias";
import { getEmpresaForScope, getEmpresaLogoBytes, documentScope } from "../lib/empresa";
import PDFDocument from "pdfkit";

const router = Router();
router.use("/guias-despacho", (req, res, next) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "No autorizado" }); return; }
  next();
});

class GuiaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const action = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    void fn(req, res).catch(err => {
      req.log?.error({ err }, "Operación de guía de despacho fallida");
      res.status(err instanceof GuiaError ? err.status : 500).json({
        error: err instanceof GuiaError ? err.message : "No se pudo completar la operación. Intenta nuevamente.",
      });
    });
  };

async function getScopedGuia(userId: string, guiaId: number) {
  const ctx = await getOrgContext(userId);
  const condition = ctx.organizationId
    ? and(eq(guiasDespachoTable.id, guiaId), eq(guiasDespachoTable.organizationId, ctx.organizationId))
    : and(eq(guiasDespachoTable.id, guiaId), eq(guiasDespachoTable.responsableId, userId));
  const [guia] = await db.select().from(guiasDespachoTable).where(condition);
  if (!guia) throw new GuiaError("Guía de despacho no encontrada.", 404);
  return { guia, condition, ctx };
}

async function guiaScope(userId: string) {
  const ctx = await getOrgContext(userId);
  return ctx.organizationId
    ? eq(guiasDespachoTable.organizationId, ctx.organizationId)
    : eq(guiasDespachoTable.responsableId, userId);
}

async function serializeGuia(guia: typeof guiasDespachoTable.$inferSelect) {
  const items = await db.select().from(guiaDespachoItemsTable).where(eq(guiaDespachoItemsTable.guiaId, guia.id));
  return { ...guia, items };
}

// GET /guias-despacho
router.get("/guias-despacho", action(async (req, res) => {
  const scope = await guiaScope(req.user!.id);
  const rows = await db.select().from(guiasDespachoTable).where(scope).orderBy(desc(guiasDespachoTable.id));
  res.json(rows);
}));

// POST /guias-despacho
router.post("/guias-despacho", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const { items = [], ...body } = req.body;

  const guia = await db.transaction(async tx => {
    const [created] = await tx.insert(guiasDespachoTable).values({
      ...body,
      organizationId: ctx.organizationId ?? null,
      responsableId: req.user!.id,
      numeroGuia: "",
    }).returning();

    const prefijo = prefs.prefijoCotizacion?.replace(/COT/i, "GD") ?? "GD-";
    const [numbered] = await tx.update(guiasDespachoTable)
      .set({ numeroGuia: `${prefijo}${String(created.id).padStart(4, "0")}` })
      .where(eq(guiasDespachoTable.id, created.id))
      .returning();

    if (items.length > 0) {
      await tx.insert(guiaDespachoItemsTable).values(items.map((i: Record<string, unknown>) => ({ ...i, guiaId: created.id })));
    }
    return numbered;
  });

  res.status(201).json(await serializeGuia(guia));
}));

// POST /guias-despacho/from-pedido/:pedidoId — genera guía desde pedido aprobado/despachado
router.post("/guias-despacho/from-pedido/:pedidoId", action(async (req, res) => {
  const ctx = await getOrgContext(req.user!.id);
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const pedidoId = Number(req.params.pedidoId);

  // Buscar pedido del mismo scope
  const pedScope = ctx.organizationId
    ? and(eq(pedidosTable.id, pedidoId), eq(pedidosTable.organizationId, ctx.organizationId))
    : and(eq(pedidosTable.id, pedidoId), eq(pedidosTable.responsableId, req.user!.id));
  const [pedido] = await db.select().from(pedidosTable).where(pedScope);
  if (!pedido) throw new GuiaError("Pedido no encontrado.", 404);
  if (!["aprobado", "despachado"].includes(pedido.estado)) {
    throw new GuiaError("Solo se puede emitir guía para pedidos aprobados o despachados.");
  }

  const pedItems = await db.select().from(pedidoItemsTable).where(eq(pedidoItemsTable.pedidoId, pedido.id));

  // Fecha de hoy en formato YYYY-MM-DD
  const hoy = new Date().toISOString().slice(0, 10);

  const guia = await db.transaction(async tx => {
    const [created] = await tx.insert(guiasDespachoTable).values({
      organizationId: ctx.organizationId ?? null,
      responsableId: req.user!.id,
      numeroGuia: "",
      clienteId: pedido.clienteId,
      clienteNombre: pedido.clienteNombre,
      clienteRut: pedido.clienteRut ?? null,
      clienteDireccion: pedido.clienteDireccion ?? null,
      pedidoId: pedido.id,
      estado: "emitida",
      fechaEmision: hoy,
      moneda: pedido.moneda,
      decimales: pedido.decimales,
      subtotal: pedido.subtotal,
      porcentajeIva: pedido.porcentajeIva,
      montoIva: pedido.montoIva,
      total: pedido.total,
      observaciones: pedido.notas ?? "",
      // Datos de transporte opcionales desde el body
      transportista: req.body.transportista ?? "",
      patenteVehiculo: req.body.patenteVehiculo ?? "",
      chofer: req.body.chofer ?? "",
      direccionOrigen: req.body.direccionOrigen ?? "",
      direccionDestino: pedido.clienteDireccion ?? req.body.direccionDestino ?? "",
    }).returning();

    const prefijo = prefs.prefijoCotizacion?.replace(/COT/i, "GD") ?? "GD-";
    const [numbered] = await tx.update(guiasDespachoTable)
      .set({ numeroGuia: `${prefijo}${String(created.id).padStart(4, "0")}` })
      .where(eq(guiasDespachoTable.id, created.id))
      .returning();

    if (pedItems.length > 0) {
      await tx.insert(guiaDespachoItemsTable).values(pedItems.map(i => ({
        guiaId: created.id,
        productoId: i.productoId ?? null,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        subtotalLinea: i.subtotalLinea,
      })));
    }

    // Marcar el pedido como despachado si estaba aprobado
    if (pedido.estado === "aprobado") {
      await tx.update(pedidosTable).set({
        estado: "despachado",
        despachadorId: req.user!.id,
        despachadoEn: new Date(),
        guiaDespachoId: created.id,
        actualizadoEn: new Date(),
      }).where(eq(pedidosTable.id, pedido.id));
    }

    return numbered;
  });

  res.status(201).json(await serializeGuia(guia));
}));

// GET /guias-despacho/:id
router.get("/guias-despacho/:id", action(async (req, res) => {
  const { guia } = await getScopedGuia(req.user!.id, Number(req.params.id));
  res.json(await serializeGuia(guia));
}));

// PATCH /guias-despacho/:id/estado
router.patch("/guias-despacho/:id/estado", action(async (req, res) => {
  const { condition } = await getScopedGuia(req.user!.id, Number(req.params.id));
  const { estado } = req.body as { estado: string };

  const estadosValidos = ["emitida", "en_despacho", "entregada", "anulada"];
  if (!estadosValidos.includes(estado)) throw new GuiaError("Estado inválido.");

  const guia = await db.transaction(async tx => {
    const [current] = await tx.select().from(guiasDespachoTable).where(condition).for("update");
    if (!current) throw new GuiaError("Guía no encontrada.", 404);

    const transicionesValidas: Record<string, string[]> = {
      emitida: ["en_despacho", "anulada"],
      en_despacho: ["entregada", "anulada"],
      entregada: [],
      anulada: [],
    };
    if (!transicionesValidas[current.estado]?.includes(estado)) {
      throw new GuiaError(`No se puede cambiar de '${current.estado}' a '${estado}'.`, 409);
    }

    const [updated] = await tx.update(guiasDespachoTable)
      .set({ estado: estado as "emitida" | "en_despacho" | "entregada" | "anulada", actualizadoEn: new Date() })
      .where(condition)
      .returning();

    // Cuando la guía se entrega, marcar el pedido origen como entregado
    if (estado === "entregada" && updated.pedidoId) {
      await tx.update(pedidosTable)
        .set({
          estado: "entregado" as "pendiente" | "aprobado" | "despachado" | "entregado" | "cancelado",
          entregadoEn: new Date(),
          actualizadoEn: new Date(),
        })
        .where(and(eq(pedidosTable.id, updated.pedidoId), eq(pedidosTable.estado, "despachado")));
    }

    return updated;
  });

  res.json(await serializeGuia(guia));
}));

// GET /guias-despacho/:id/pdf
router.get("/guias-despacho/:id/pdf", action(async (req, res) => {
  const { guia } = await getScopedGuia(req.user!.id, Number(req.params.id));
  const items = await db.select().from(guiaDespachoItemsTable).where(eq(guiaDespachoItemsTable.guiaId, guia.id));
  const prefs = await getPreferenciasNegocio(req.user!.id);
  const scope = documentScope(guia.organizationId, guia.responsableId);
  const empresa = await getEmpresaForScope(scope);
  const logoBuf = await getEmpresaLogoBytes(empresa).catch(() => null);

  const fmtDate = (s: string | null | undefined) => {
    if (!s) return "—";
    const p = s.slice(0, 10).split("-");
    if (p.length !== 3) return s;
    return prefs.formatoFecha === "MM/DD/YYYY" ? `${p[1]}/${p[2]}/${p[0]}` : `${p[2]}/${p[1]}/${p[0]}`;
  };
  const fmt = (n: number) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: guia.decimales }).format(n);
  const fmtMoney = (n: number) => `${guia.moneda} ${fmt(n)}`;
  const val = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "—");

  const ESTADO_LABEL: Record<string, string> = {
    emitida: "EMITIDA", en_despacho: "EN DESPACHO", entregada: "ENTREGADA", anulada: "ANULADA",
  };

  // Build PDF
  const doc = new PDFDocument({ size: "A4", margin: 42.52, autoFirstPage: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const W = 595.28;
  const M = 42.52;
  const CW = W - 2 * M;
  const PRIMARY: [number, number, number] = [37, 99, 235]; // blue-600

  // Header band
  doc.rect(0, 0, W, 90).fill(PRIMARY);

  // Logo
  if (logoBuf) {
    try {
      doc.image(logoBuf, M, 14, { fit: [80, 62], align: "left", valign: "center" });
    } catch { /* skip */ }
  }

  // Company name on header
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13)
    .text(val(empresa.nombre), logoBuf ? M + 90 : M, 20, { width: CW - 100 });
  doc.font("Helvetica").fontSize(8)
    .text([empresa.rut, empresa.giro].filter(Boolean).join(" · "), logoBuf ? M + 90 : M, 36, { width: CW - 100 })
    .text([empresa.direccion, empresa.ciudad].filter(Boolean).join(", "), { width: CW - 100 });

  // Document title top-right
  const titleX = W - M - 140;
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff")
    .text("GUÍA DE DESPACHO", titleX, 15, { width: 140, align: "right" });
  doc.font("Helvetica").fontSize(9)
    .text(guia.numeroGuia, titleX, 32, { width: 140, align: "right" })
    .text(ESTADO_LABEL[guia.estado] ?? guia.estado, titleX, 44, { width: 140, align: "right" });

  let y = 110;

  // Info boxes: Destinatario + Despacho side by side
  doc.fillColor("#1e293b").font("Helvetica-Bold").fontSize(8)
    .text("DESTINATARIO", M, y).text("DATOS DE DESPACHO", M + CW / 2 + 5, y);
  y += 12;
  doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a");

  const leftLines = [
    val(guia.clienteNombre),
    guia.clienteRut ? `RUT: ${guia.clienteRut}` : null,
    guia.clienteDireccion ? `Dirección: ${guia.clienteDireccion}` : null,
  ].filter(Boolean) as string[];

  const rightLines = [
    `Emisión: ${fmtDate(guia.fechaEmision)}`,
    guia.transportista ? `Transportista: ${guia.transportista}` : null,
    guia.chofer ? `Chofer: ${guia.chofer}` : null,
    guia.patenteVehiculo ? `Patente: ${guia.patenteVehiculo}` : null,
    guia.direccionOrigen ? `Origen: ${guia.direccionOrigen}` : null,
    guia.direccionDestino ? `Destino: ${guia.direccionDestino}` : null,
  ].filter(Boolean) as string[];

  const lh = 13;
  leftLines.forEach((line, i) => doc.text(line, M, y + i * lh, { width: CW / 2 - 10 }));
  rightLines.forEach((line, i) => doc.text(line, M + CW / 2 + 5, y + i * lh, { width: CW / 2 - 5 }));

  y += Math.max(leftLines.length, rightLines.length) * lh + 16;

  // Divider
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
  y += 10;

  // Items table header
  const COL = { desc: M, cant: M + CW * 0.55, pu: M + CW * 0.70, sub: M + CW * 0.85 };
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#64748b");
  doc.text("DESCRIPCIÓN", COL.desc, y, { width: CW * 0.52 });
  doc.text("CANT.", COL.cant, y, { width: CW * 0.13, align: "right" });
  doc.text("P.UNIT.", COL.pu, y, { width: CW * 0.13, align: "right" });
  doc.text("SUBTOTAL", COL.sub, y, { width: CW * 0.15, align: "right" });
  y += 11;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
  y += 6;

  // Items
  doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a");
  for (const item of items) {
    const cant = Number(item.cantidad);
    const pu = Number(item.precioUnitario);
    const sub = Number(item.subtotalLinea);
    const startY = y;
    doc.text(val(item.descripcion), COL.desc, y, { width: CW * 0.52 });
    const textH = doc.heightOfString(val(item.descripcion), { width: CW * 0.52 });
    doc.text(fmt(cant), COL.cant, startY, { width: CW * 0.13, align: "right" });
    doc.text(fmtMoney(pu), COL.pu, startY, { width: CW * 0.13, align: "right" });
    doc.text(fmtMoney(sub), COL.sub, startY, { width: CW * 0.15, align: "right" });
    y += Math.max(textH, 14) + 4;
  }

  y += 8;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
  y += 10;

  // Totals
  const totX = M + CW * 0.60;
  const totW = CW * 0.40;
  const addTotal = (label: string, amount: number, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 9.5 : 8.5).fillColor(bold ? "#0f172a" : "#475569");
    doc.text(label, totX, y, { width: totW * 0.55 });
    doc.text(fmtMoney(amount), totX + totW * 0.55, y, { width: totW * 0.45, align: "right" });
    y += bold ? 16 : 13;
  };
  addTotal("Subtotal", Number(guia.subtotal));
  addTotal(`IVA (${guia.porcentajeIva}%)`, Number(guia.montoIva));
  addTotal("TOTAL", Number(guia.total), true);

  // Observaciones
  if (guia.observaciones) {
    y += 10;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("OBSERVACIONES", M, y);
    y += 12;
    doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a").text(guia.observaciones, M, y, { width: CW });
  }

  // Footer
  doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
    .text(`Documento generado el ${fmtDate(new Date().toISOString().slice(0, 10))}`, M, H - 30, { width: CW, align: "center" });

  doc.end();

  await new Promise<void>((resolve) => doc.on("end", resolve));
  const pdf = Buffer.concat(chunks);

  res.set("Cache-Control", "private, no-store")
    .type("application/pdf")
    .set("Content-Disposition", `attachment; filename="${guia.numeroGuia}.pdf"`)
    .send(pdf);
}));

export default router;
