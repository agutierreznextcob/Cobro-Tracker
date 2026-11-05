import { db, cobrosTable, flowCredencialesTable, mpCredencialesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildDatosBancariosHtml, getDatosBancariosUsuario } from "./datos-bancarios";

export interface CobroEmailOptions {
  moneda?: string;
  decimales?: number;
  linkPago?: string | null;
  proveedor?: "Flow" | "MercadoPago";
  datosBancariosHtml?: string | null;
  fechaVencimiento?: string | null;
}

/** Resolve from the charge's responsible user, never from the current sender
 * or a global platform account. A debtor portal is not a processor payment URL. */
export async function resolveCobroEmailOptions(
  cobroId: number,
  log: { warn: (obj: object, msg: string) => void },
): Promise<CobroEmailOptions> {
  const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));
  if (!cobro) throw new Error("No se encontró el cobro para preparar su correo.");
  if (!cobro.responsableId) return { fechaVencimiento: cobro.fechaVencimiento, moneda: cobro.moneda, decimales: cobro.decimales };
  const [flow, mp, banco] = await Promise.all([
    db.select({ userId: flowCredencialesTable.userId }).from(flowCredencialesTable)
      .where(eq(flowCredencialesTable.userId, cobro.responsableId)),
    db.select({ userId: mpCredencialesTable.userId }).from(mpCredencialesTable)
      .where(eq(mpCredencialesTable.userId, cobro.responsableId)),
    getDatosBancariosUsuario(cobro.responsableId),
  ]);
  let prepared = cobro;
  if ((flow.length || mp.length) && !cobro.flowLinkPago && !cobro.mpPaymentLinkUrl && cobro.estado === "pendiente") {
    // Existing provisioning keeps credentials scoped to the responsible user.
    // Do not create full-amount orders for partially paid or terminal charges.
    const { asegurarLinkPagoCobro } = await import("./cobro-payment-link");
    prepared = (await asegurarLinkPagoCobro(cobro, log)).cobro;
  }
  const linkPago = flow.length && prepared.flowLinkPago
    ? prepared.flowLinkPago
    : mp.length && prepared.mpPaymentLinkUrl ? prepared.mpPaymentLinkUrl : null;
  return {
    moneda: cobro.moneda, decimales: cobro.decimales,
    linkPago,
    proveedor: linkPago ? (linkPago === prepared.flowLinkPago ? "Flow" : "MercadoPago") : undefined,
    datosBancariosHtml: banco ? buildDatosBancariosHtml(banco) : null,
    fechaVencimiento: cobro.fechaVencimiento,
  };
}
