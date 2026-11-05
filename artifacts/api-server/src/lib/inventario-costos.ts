import { historialCostosTable } from "@workspace/db";
import type { InventoryTx } from "./inventario-bodegas";

export async function registrarCosto(tx: InventoryTx, input: {
  productoId: number; anterior: number | null; nuevo: number; usuarioId: string;
  moneda: string; decimales: number; compra?: { id: number; numeroFactura: string };
}) {
  if (input.anterior === input.nuevo || (input.anterior == null && input.nuevo === 0)) return;
  await tx.insert(historialCostosTable).values({
    productoId: input.productoId,
    costoAnterior: input.anterior == null ? null : String(input.anterior),
    costoNuevo: String(input.nuevo), usuarioId: input.usuarioId,
    moneda: input.moneda,
    // A source invoice may keep fractional historical costs after prefs switch OFF.
    decimales: Math.max(input.decimales, [input.anterior, input.nuevo].some(n => n != null && !Number.isInteger(n)) ? 2 : 0),
    origen: input.compra ? "compra" : "manual", compraId: input.compra?.id ?? null,
    numeroFactura: input.compra?.numeroFactura ?? null,
  });
}
