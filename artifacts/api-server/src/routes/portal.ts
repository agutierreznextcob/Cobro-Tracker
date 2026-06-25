import { Router, type IRouter, type Request } from "express";
import {
  db,
  cobrosTable,
  clientesTable,
  organizacionesTable,
  pagosParciales,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const portalRouter: IRouter = Router();

// ---- Abuse protection for the unauthenticated portal endpoint --------------
// Fixed-window limiter: tokens are unguessable, but we still bound brute-force
// and scraping. Per-IP cap stops one source; global cap bounds total volume.
const WINDOW_MS = 60_000;
const PER_IP_MAX = 30;
const GLOBAL_MAX = 300;

type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { count: 0, resetAt: Date.now() + WINDOW_MS };

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of ipBuckets) {
    if (now > b.resetAt) ipBuckets.delete(ip);
  }
}, WINDOW_MS).unref();

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim();
  return req.ip ?? "unknown";
}

function isRateLimited(req: Request): boolean {
  const now = Date.now();
  if (now > globalBucket.resetAt) globalBucket = { count: 0, resetAt: now + WINDOW_MS };
  globalBucket.count += 1;
  if (globalBucket.count > GLOBAL_MAX) return true;

  const ip = getClientIp(req);
  let bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count > PER_IP_MAX;
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
      res.status(404).json({ error: "Portal no encontrado o enlace expirado." });
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

export default portalRouter;
