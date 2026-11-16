import { db, cobrosTable, cotizacionesTable, pedidosTable } from "@workspace/db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { getOrgContext } from "./org";
import { hoySantiago } from "./preferencias";
import { chileDay } from "./informes-calculos";

export interface KpiArea {
  areaId: number;
  moneda: string;
  // cobros
  totalCobrado: number;
  totalCobros: number;
  cobrosPageados: number;
  cobrosPendientes: number;
  ticketPromedioCobros: number;
  // cotizaciones
  totalCotizaciones: number;
  montoCotizaciones: number;
  tasaConversionCotizaciones: number | null; // % convertidas a pedido/cobro
  // pedidos
  totalPedidos: number;
  montoPedidos: number;
  pedidosPendientes: number;
  pedidosEntregados: number;
  // utilidad estimada (cobrado - costo items)
  utilidadEstimada: number | null;
  // Período
  desde: string;
  hasta: string;
}

/** Scope de cobros para un usuario: retorna condición SQL de acceso */
async function buildCobroScope(userId: string) {
  const ctx = await getOrgContext(userId);
  if (ctx.organizationId != null) {
    if (ctx.isOrgAdmin) return { ctx, cobroCond: eq(cobrosTable.organizationId, ctx.organizationId) };
    if (ctx.isSupervisor || ctx.isGerente) {
      const team = ctx.teamMemberIds.length > 0 ? ctx.teamMemberIds : [userId];
      return { ctx, cobroCond: inArray(cobrosTable.responsableId, team) };
    }
  }
  return { ctx, cobroCond: eq(cobrosTable.responsableId, userId) };
}

export async function kpiPorArea(userId: string, areaId: number, moneda = "CLP"): Promise<KpiArea> {
  const { cobroCond } = await buildCobroScope(userId);
  const hoy = hoySantiago();

  return db.transaction(async tx => {
    // ── cobros ───────────────────────────────────────────────────────────────
    const cobros = await tx
      .select()
      .from(cobrosTable)
      .where(and(cobroCond, eq(cobrosTable.areaId, areaId), eq(cobrosTable.moneda, moneda)));

    const cobrosPageados = cobros.filter(c => c.estado === "pagado" && chileDay(c.pagadoEn ?? c.creadoEn) <= hoy);
    const cobrosPendientes = cobros.filter(c => c.estado !== "pagado" && c.estado !== "anulado");
    const totalCobrado = cobrosPageados.reduce((sum, c) => sum + Number(c.monto), 0);

    // ── cotizaciones ─────────────────────────────────────────────────────────
    // Scope: mismo criterio que cobros pero sobre cotizaciones
    const ctx2 = await getOrgContext(userId);
    let cotizCond;
    if (ctx2.organizationId != null) {
      if (ctx2.isOrgAdmin) {
        cotizCond = and(eq(cotizacionesTable.organizationId, ctx2.organizationId), eq(cotizacionesTable.areaId, areaId));
      } else if (ctx2.isSupervisor || ctx2.isGerente) {
        const team = ctx2.teamMemberIds.length > 0 ? ctx2.teamMemberIds : [userId];
        cotizCond = and(inArray(cotizacionesTable.responsableId, team), eq(cotizacionesTable.areaId, areaId));
      } else {
        cotizCond = and(eq(cotizacionesTable.responsableId, userId), eq(cotizacionesTable.areaId, areaId));
      }
    } else {
      cotizCond = and(
        eq(cotizacionesTable.responsableId, userId),
        isNull(cotizacionesTable.organizationId),
        eq(cotizacionesTable.areaId, areaId),
      );
    }

    const cotizaciones = await tx.select().from(cotizacionesTable).where(cotizCond);
    const montoCotizaciones = cotizaciones.filter(c => c.moneda === moneda).reduce((sum, c) => sum + Number(c.total), 0);
    const cotizConvertidas = cotizaciones.filter(c => c.estado === "aceptada" || c.estado === "facturada").length;
    const tasaConversionCotizaciones = cotizaciones.length > 0 ? (cotizConvertidas / cotizaciones.length) * 100 : null;

    // ── pedidos ───────────────────────────────────────────────────────────────
    let pedidosCond;
    if (ctx2.organizationId != null) {
      if (ctx2.isOrgAdmin) {
        pedidosCond = and(eq(pedidosTable.organizationId, ctx2.organizationId), eq(pedidosTable.areaId, areaId));
      } else if (ctx2.isSupervisor || ctx2.isGerente) {
        const team = ctx2.teamMemberIds.length > 0 ? ctx2.teamMemberIds : [userId];
        pedidosCond = and(inArray(pedidosTable.responsableId, team), eq(pedidosTable.areaId, areaId));
      } else {
        pedidosCond = and(eq(pedidosTable.responsableId, userId), eq(pedidosTable.areaId, areaId));
      }
    } else {
      pedidosCond = and(
        eq(pedidosTable.responsableId, userId),
        isNull(pedidosTable.organizationId),
        eq(pedidosTable.areaId, areaId),
      );
    }

    const pedidos = await tx.select().from(pedidosTable).where(pedidosCond);
    const montoPedidos = pedidos.filter(p => p.moneda === moneda).reduce((sum, p) => sum + Number(p.total), 0);
    const pedidosPendientes = pedidos.filter(p => p.estado === "pendiente" || p.estado === "aprobado").length;
    const pedidosEntregados = pedidos.filter(p => p.estado === "entregado").length;

    // ── utilidad estimada ─────────────────────────────────────────────────────
    // Suma de (monto cobrado - costo según items de inventario en cotizaciones) para pagados del área
    let utilidadEstimada: number | null = null;
    if (cobrosPageados.length > 0) {
      let ingresos = 0, costos = 0;
      for (const cobro of cobrosPageados) {
        const items = cobro.itemsInventario ?? [];
        ingresos += Number(cobro.monto);
        for (const item of items) {
          if (typeof item === "object" && item !== null && "costoUnitario" in item && "cantidad" in item) {
            costos += Number((item as { costoUnitario: number; cantidad: number }).costoUnitario) *
              Number((item as { costoUnitario: number; cantidad: number }).cantidad);
          }
        }
      }
      utilidadEstimada = ingresos - costos;
    }

    // ── período ───────────────────────────────────────────────────────────────
    const allDates = [
      ...cobros.map(c => chileDay(c.creadoEn)),
      ...cotizaciones.map(c => chileDay(c.creadoEn)),
      ...pedidos.map(p => chileDay(p.creadoEn)),
    ].sort();
    const desde = allDates[0] ?? hoy;

    return {
      areaId,
      moneda,
      totalCobrado,
      totalCobros: cobros.length,
      cobrosPageados: cobrosPageados.length,
      cobrosPendientes: cobrosPendientes.length,
      ticketPromedioCobros: cobrosPageados.length > 0 ? totalCobrado / cobrosPageados.length : 0,
      totalCotizaciones: cotizaciones.length,
      montoCotizaciones,
      tasaConversionCotizaciones,
      totalPedidos: pedidos.length,
      montoPedidos,
      pedidosPendientes,
      pedidosEntregados,
      utilidadEstimada,
      desde,
      hasta: hoy,
    };
  }, { isolationLevel: "read committed", accessMode: "read only" });
}
