import { cobrosTable, db, pagosParciales } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

type CambiosAbono = Partial<typeof pagosParciales.$inferInsert>;
type EstadoCobro = "pagado" | "parcial" | "pendiente";

async function recalcularDentroDeTransaccion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  cobroId: number,
): Promise<EstadoCobro | null> {
  const [sumResult] = await tx
    .select({ total: sql<number>`coalesce(sum(${pagosParciales.monto})::float, 0)` })
    .from(pagosParciales)
    .where(and(
      eq(pagosParciales.cobroId, cobroId),
      eq(pagosParciales.estado, "confirmado"),
    ));
  const [cobro] = await tx
    .select({
      monto: cobrosTable.monto,
      montoDescuento: cobrosTable.montoDescuento,
      estado: cobrosTable.estado,
      pagadoOrigen: cobrosTable.pagadoOrigen,
    })
    .from(cobrosTable)
    .where(eq(cobrosTable.id, cobroId));
  if (!cobro) return null;

  const totalPagado = sumResult?.total ?? 0;
  const montoTotal = Math.max(
    Number(cobro.monto) - Number(cobro.montoDescuento ?? 0),
    0,
  );
  const estado: EstadoCobro =
    totalPagado >= montoTotal && montoTotal > 0
      ? "pagado"
      : totalPagado > 0
        ? "parcial"
        : "pendiente";
  // A full/direct payment is authoritative over partial-payment links. Only a
  // parent whose paid state was produced by abonos may be downgraded by an
  // abono reversal.
  if (cobro.estado === "pagado" && cobro.pagadoOrigen !== "abonos" && estado !== "pagado") {
    return "pagado";
  }
  const pagadoOrigen = estado === "pagado"
    ? (cobro.estado === "pagado" && cobro.pagadoOrigen !== "abonos"
        ? cobro.pagadoOrigen
        : "abonos")
    : null;
  await tx
    .update(cobrosTable)
    .set({
      estado,
      actualizadoEn: new Date(),
      pagadoEn: estado === "pagado"
        ? sql`coalesce(${cobrosTable.pagadoEn}, now())`
        : null,
      pagadoOrigen,
    })
    .where(eq(cobrosTable.id, cobroId));
  return estado;
}

export async function recalcularCobroDesdeAbonosSeguro(
  cobroId: number,
): Promise<EstadoCobro | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${cobroId})`);
    return recalcularDentroDeTransaccion(tx, cobroId);
  });
}

/**
 * Applies a provider/manual observation and recomputes the parent under one
 * per-cobro lock. An older verification can never overwrite a newer one.
 */
export async function transicionarAbonoYRecalcularCobro(input: {
  abonoId: number;
  cobroId: number;
  cambios: CambiosAbono;
  verificadoEn: Date;
}): Promise<{
  aplicado: boolean;
  estadoCobro: EstadoCobro | null;
  abono: typeof pagosParciales.$inferSelect | null;
}> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${input.cobroId})`);
    const [actual] = await tx
      .select()
      .from(pagosParciales)
      .where(and(
        eq(pagosParciales.id, input.abonoId),
        eq(pagosParciales.cobroId, input.cobroId),
      ));
    if (!actual) {
      return { aplicado: false, estadoCobro: null, abono: null };
    }
    if (
      actual.estadoVerificadoEn &&
      actual.estadoVerificadoEn.getTime() > input.verificadoEn.getTime()
    ) {
      const [parent] = await tx
        .select({ estado: cobrosTable.estado })
        .from(cobrosTable)
        .where(eq(cobrosTable.id, input.cobroId));
      const estadoCobro = parent?.estado === "pagado" ||
          parent?.estado === "parcial" ||
          parent?.estado === "pendiente"
        ? parent.estado
        : null;
      return { aplicado: false, estadoCobro, abono: actual };
    }
    const [abono] = await tx
      .update(pagosParciales)
      .set({
        ...input.cambios,
        actualizadoEn: input.verificadoEn,
        estadoVerificadoEn: input.verificadoEn,
      })
      .where(eq(pagosParciales.id, input.abonoId))
      .returning();
    const estadoCobro = await recalcularDentroDeTransaccion(tx, input.cobroId);
    return { aplicado: true, estadoCobro, abono: abono ?? null };
  });
}