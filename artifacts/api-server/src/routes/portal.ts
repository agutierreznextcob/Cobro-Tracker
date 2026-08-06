import { Router, type IRouter, type Request } from "express";
import {
  db,
  cobrosTable,
  clientesTable,
  organizacionesTable,
  pagosParciales,
  comprobantesTransferenciaTable,
  notificacionesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

const portalRouter: IRouter = Router();

// ---- Abuse protection for the unauthenticated portal endpoint --------------
// Fixed-window limiter, en memoria (una sola instancia). Tokens are
// unguessable, pero acotamos brute-force y scraping por IP (req.ip viene del
// proxy confiable vía `trust proxy`; NO leemos X-Forwarded-For a mano porque
// el cliente puede falsificarlo). Sin cupo global: un cap global compartido
// permitiría a un atacante agotar el servicio para todos los deudores.
const WINDOW_MS = 60_000;
const PER_IP_MAX = 30;

type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
const tokenBuckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of ipBuckets) {
    if (now > b.resetAt) ipBuckets.delete(k);
  }
  for (const [k, b] of tokenBuckets) {
    if (now > b.resetAt) tokenBuckets.delete(k);
  }
}, WINDOW_MS).unref();

function bumpBucket(map: Map<string, Bucket>, key: string, max: number): boolean {
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > max;
}

function isRateLimited(req: Request): boolean {
  return bumpBucket(ipBuckets, req.ip ?? "unknown", PER_IP_MAX);
}

// Cupo adicional por token para el POST de comprobantes (payloads grandes):
// aísla el abuso a un portal sin afectar al resto.
function isTokenRateLimited(token: string): boolean {
  return bumpBucket(tokenBuckets, token, 10);
}

function montoACobrarDe(c: { monto: string; montoDescuento: string | null }): number {
  return Number(c.monto) - Number(c.montoDescuento ?? 0);
}

// ---- Public endpoint: debtor portal data for a magic-link token -------------
portalRouter.get("/public/portal/:token", async (req, res) => {
  if (isRateLimited(req)) {
    res.status(429).json({ error: "Demasiadas solicitudes. Inténtalo más tarde." });
    return;
  }

  const token = (req.params.token ?? "").trim();
  if (!token) {
    res.status(404).json({ error: "Portal no encontrado." });
    return;
  }

  try {
    const [cliente] = await db
      .select()
      .from(clientesTable)
      .where(eq(clientesTable.portalToken, token));

    if (!cliente) {
      res.status(404).json({
        error:
          "Este enlace ya no está disponible: es posible que haya sido reemplazado por uno nuevo. Pide el enlace actualizado a la empresa que te contactó.",
      });
      return;
    }

    // Resolve the collecting business name.
    let empresa = "NextCob";
    if (cliente.organizationId != null) {
      const [org] = await db
        .select({ nombre: organizacionesTable.nombre })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, cliente.organizationId));
      if (org?.nombre) empresa = org.nombre;
    }

    const cobros = await db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.clienteId, cliente.id));

    // Sum of confirmed abonos per cobro (for saldo on partial payments).
    const abonosPorCobro = new Map<number, number>();
    if (cobros.length > 0) {
      const sums = await db
        .select({
          cobroId: pagosParciales.cobroId,
          total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)`,
        })
        .from(pagosParciales)
        .where(eq(pagosParciales.estado, "confirmado"))
        .groupBy(pagosParciales.cobroId);
      for (const s of sums) abonosPorCobro.set(s.cobroId, s.total);
    }

    const hoy = new Date().toISOString().slice(0, 10);

    const pendientes: unknown[] = [];
    const pagados: unknown[] = [];

    for (const c of cobros) {
      if (c.estado === "fallido" || c.estado === "cancelado") continue;
      const montoACobrar = montoACobrarDe(c);
      const pagado = abonosPorCobro.get(c.id) ?? 0;
      const saldo = Math.max(montoACobrar - pagado, 0);
      const linkPago = c.flowLinkPago || c.mpPaymentLinkUrl || null;

      if (c.estado === "pagado") {
        pagados.push({
          id: c.id,
          descripcion: c.descripcion,
          montoACobrar,
          saldo: 0,
          estado: "pagado",
          fechaVencimiento: c.fechaVencimiento ?? null,
          linkPago: null,
        });
        continue;
      }

      let estado: "pendiente" | "vencido" | "parcial" = "pendiente";
      if (c.estado === "parcial") estado = "parcial";
      else if (c.fechaVencimiento && c.fechaVencimiento < hoy) estado = "vencido";

      pendientes.push({
        id: c.id,
        descripcion: c.descripcion,
        montoACobrar,
        saldo,
        estado,
        fechaVencimiento: c.fechaVencimiento ?? null,
        linkPago,
      });
    }

    res.json({
      empresa,
      clienteNombre: cliente.nombre,
      pendientes,
      pagados,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching portal data");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---- Public endpoint: debtor uploads a transfer receipt ---------------------

const SubirComprobanteSchema = z.object({
  cobroId: z.number().int().positive(),
  archivo: z.string().min(1).max(1_500_000),
  nombreArchivo: z.string().max(200).nullish(),
  comentario: z.string().max(500).nullish(),
});

function esArchivoComprobanteValido(archivo: string): boolean {
  return /^data:(image\/(png|jpe?g|webp|gif)|application\/pdf);base64,/.test(archivo);
}

portalRouter.post("/public/portal/:token/comprobante", async (req, res) => {
  if (isRateLimited(req)) {
    res.status(429).json({ error: "Demasiadas solicitudes. Inténtalo más tarde." });
    return;
  }

  const token = (req.params.token ?? "").trim();
  if (!token) {
    res.status(404).json({ error: "Portal no encontrado." });
    return;
  }
  if (isTokenRateLimited(token)) {
    res.status(429).json({ error: "Demasiadas solicitudes. Inténtalo más tarde." });
    return;
  }

  const parsed = SubirComprobanteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos." });
    return;
  }
  if (!esArchivoComprobanteValido(parsed.data.archivo)) {
    res.status(400).json({ error: "El archivo debe ser una imagen (JPG, PNG, WebP) o un PDF." });
    return;
  }

  try {
    const [cliente] = await db
      .select()
      .from(clientesTable)
      .where(eq(clientesTable.portalToken, token));
    if (!cliente) {
      res.status(404).json({ error: "Portal no encontrado." });
      return;
    }

    // El cobro debe pertenecer a este cliente y seguir por cobrar.
    const [cobro] = await db
      .select()
      .from(cobrosTable)
      .where(and(eq(cobrosTable.id, parsed.data.cobroId), eq(cobrosTable.clienteId, cliente.id)));
    if (!cobro) {
      res.status(404).json({ error: "Cobro no encontrado." });
      return;
    }
    if (cobro.estado !== "pendiente" && cobro.estado !== "parcial") {
      res.status(400).json({ error: "Este cobro ya no está pendiente de pago." });
      return;
    }

    const [comprobante] = await db
      .insert(comprobantesTransferenciaTable)
      .values({
        cobroId: cobro.id,
        archivo: parsed.data.archivo,
        nombreArchivo: parsed.data.nombreArchivo ?? null,
        comentario: parsed.data.comentario ?? null,
      })
      .returning({ id: comprobantesTransferenciaTable.id });

    // Notificar al ejecutivo responsable del cobro.
    if (cobro.responsableId) {
      await db.insert(notificacionesTable).values({
        userId: cobro.responsableId,
        cobroId: cobro.id,
        tipo: "comprobante",
        titulo: `El cliente ${cliente.nombre} envió un comprobante para el cobro "${cobro.descripcion}"`,
        mensaje: "Revisa el comprobante de transferencia y confirma el pago.",
      });
    }

    req.log.info(
      { cobroId: cobro.id, comprobanteId: comprobante.id },
      "Comprobante de transferencia recibido desde el portal",
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error uploading transfer receipt");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default portalRouter;
