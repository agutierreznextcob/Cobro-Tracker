/**
 * Generación automática de asientos contables desde cobros y compras.
 *
 * Lógica de partida doble:
 *
 * ABONO / PAGO PARCIAL (cada abono genera su propio asiento):
 *   DEBE  1.1.01 Caja / Banco (monto del abono)
 *   HABER 4.1.02 Prestación de servicios (monto neto del abono)
 *   HABER 2.1.01 IVA Débito Fiscal (IVA proporcional del abono, si aplica)
 *
 * COBRO PAGADO COMPLETO (si no tiene abonos previos, genera asiento único):
 *   DEBE  1.1.01 Caja / Banco (monto total)
 *   HABER 4.1.02 Prestación de servicios (monto neto)
 *   HABER 2.1.01 IVA Débito Fiscal (monto IVA, si aplica)
 *
 * COMPRA RECIBIDA:
 *   DEBE  5.2.04 Materiales / costo (monto neto)
 *   DEBE  2.1.02 IVA Crédito Fiscal (monto IVA)
 *   HABER 2.1.03 Proveedores / Cuentas por pagar (total)
 */
import { db, cobrosTable, comprasTable, pagosParciales, planCuentasTable, asientosContablesTable, asientoLineasTable } from "@workspace/db";
import { eq, and, inArray, like, sql } from "drizzle-orm";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface AsientoInput {
  scope: string;
  userId: string;
  fecha: string;         // YYYY-MM-DD
  periodo: string;       // AAAAMM
  descripcion: string;
  origen: "cobro" | "compra" | "pago_parcial";
  origenId: number;
  moneda: string;
  lineas: LineaInput[];
}

export interface LineaInput {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  debe: number;
  haber: number;
  descripcion?: string;
  orden: number;
}

export interface GenerarResult {
  ok: boolean;
  asientoId?: number;
  numero?: string;
  error?: string;
  skipped?: boolean;  // ya tenía asiento
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Genera número correlativo dentro del scope para el año dado */
async function nextNumero(scope: string, anio: string): Promise<string> {
  const [row] = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(asientosContablesTable)
    .where(and(eq(asientosContablesTable.scope, scope), like(asientosContablesTable.numero, `${anio}-%`)));
  const nextNum = (row?.cnt ?? 0) + 1;
  return `${anio}-${String(nextNum).padStart(4, "0")}`;
}

/**
 * Inserta asiento + líneas en una sola transacción atómica.
 * Deja el asiento en estado "contabilizado" directamente.
 */
async function insertarAsientoContabilizado(input: AsientoInput): Promise<GenerarResult> {
  const { scope, userId, fecha, periodo, descripcion, origen, origenId, moneda, lineas } = input;

  const totalDebe = lineas.reduce((s, l) => s + l.debe, 0);
  const totalHaber = lineas.reduce((s, l) => s + l.haber, 0);
  if (Math.abs(totalDebe - totalHaber) > 0.5) {
    return { ok: false, error: `Asiento descuadrado: debe=${totalDebe.toFixed(2)} haber=${totalHaber.toFixed(2)}` };
  }

  const anio = periodo.substring(0, 4);

  // Transacción atómica: número correlativo + cabecera + líneas juntos
  return await db.transaction(async (tx) => {
    // Calcular el próximo número dentro de la transacción para evitar race conditions
    const [row] = await tx
      .select({ cnt: sql<number>`count(*)` })
      .from(asientosContablesTable)
      .where(and(eq(asientosContablesTable.scope, scope), like(asientosContablesTable.numero, `${anio}-%`)));
    const nextNum = ((row?.cnt ?? 0) as number) + 1;
    const numero = `${anio}-${String(nextNum).padStart(4, "0")}`;

    const [asiento] = await tx.insert(asientosContablesTable).values({
      scope, numero, fecha, periodo, descripcion,
      estado: "contabilizado",
      origen,
      origenId,
      moneda,
      usuarioId: userId,
    }).returning();

    await tx.insert(asientoLineasTable).values(
      lineas.map((l, i) => ({
        asientoId: asiento.id,
        cuentaId: l.cuentaId,
        cuentaCodigo: l.cuentaCodigo,
        cuentaNombre: l.cuentaNombre,
        debe: String(l.debe.toFixed(2)),
        haber: String(l.haber.toFixed(2)),
        descripcion: l.descripcion,
        orden: l.orden ?? i,
      }))
    );

    return { ok: true, asientoId: asiento.id, numero };
  });
}

// ─── Mapa de cuentas por código ───────────────────────────────────────────────

/** Busca cuentas del plan por sus códigos. Retorna map codigo→cuenta. */
async function getCuentasPorCodigo(scope: string, codigos: string[]): Promise<Map<string, { id: number; codigo: string; nombre: string }>> {
  const rows = await db.select({ id: planCuentasTable.id, codigo: planCuentasTable.codigo, nombre: planCuentasTable.nombre })
    .from(planCuentasTable)
    .where(and(eq(planCuentasTable.scope, scope), inArray(planCuentasTable.codigo, codigos), eq(planCuentasTable.activa, true)));
  return new Map(rows.map(r => [r.codigo, r]));
}

// ─── Generador para un abono individual ──────────────────────────────────────

/**
 * Genera el asiento contable para un abono (pago parcial) específico.
 * Cada abono genera su propio asiento de tipo "pago_parcial" con origenId=abono.id.
 * Si ya existe asiento para ese abono, lo salta (idempotente).
 *
 * Partida:
 *   DEBE  1.1.01 Caja/Banco (monto del abono)
 *   HABER 4.1.02 Ventas/Servicios (monto neto proporcional)
 *   HABER 2.1.01 IVA Débito Fiscal (IVA proporcional, si aplica)
 */
export async function generarAsientoAbono(
  scope: string,
  userId: string,
  abonoId: number,
): Promise<GenerarResult> {
  // Verificar si ya tiene asiento este abono específico
  const [existente] = await db.select({ id: asientosContablesTable.id })
    .from(asientosContablesTable)
    .where(and(
      eq(asientosContablesTable.scope, scope),
      eq(asientosContablesTable.origen, "pago_parcial"),
      eq(asientosContablesTable.origenId, abonoId),
    ));
  if (existente) return { ok: true, skipped: true, asientoId: existente.id };

  // Cargar abono y su cobro asociado
  const [abono] = await db.select().from(pagosParciales).where(eq(pagosParciales.id, abonoId));
  if (!abono) return { ok: false, error: `Abono ${abonoId} no encontrado` };
  if (abono.estado !== "confirmado") {
    return { ok: false, error: `Abono ${abonoId} no está confirmado (estado: ${abono.estado})` };
  }

  const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, abono.cobroId));
  if (!cobro) return { ok: false, error: `Cobro ${abono.cobroId} no encontrado para el abono ${abonoId}` };

  const montoAbono = Number(abono.monto);
  if (montoAbono <= 0) return { ok: false, error: `Abono ${abonoId} tiene monto inválido: ${montoAbono}` };

  // Calcular IVA proporcional al monto del abono
  const incluyeIva = cobro.incluyeIva;
  let montoNeto = montoAbono;
  let montoIva = 0;

  if (incluyeIva && cobro.montoNeto && cobro.monto && Number(cobro.monto) > 0) {
    // Proporción IVA del cobro original aplicada al abono
    const tasaIva = Number(cobro.montoIva ?? 0) / Number(cobro.monto);
    montoIva = Math.round(montoAbono * tasaIva);
    montoNeto = montoAbono - montoIva;
  }

  // Usar confirmadoEn como fecha contable del abono
  const fecha = abono.confirmadoEn
    ? abono.confirmadoEn.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const periodo = fecha.replace(/-/g, "").slice(0, 6);

  const descripcion = `Abono ${cobro.clienteNombre ?? "cliente"} - ${cobro.descripcion?.slice(0, 50) ?? `Cobro #${cobro.id}`}`;

  const codigosNecesarios = ["1.1.01", "4.1.02", "2.1.01"];
  const cuentas = await getCuentasPorCodigo(scope, codigosNecesarios);

  const cCaja = cuentas.get("1.1.01");
  const cVentas = cuentas.get("4.1.02");
  const cIva = cuentas.get("2.1.01");

  if (!cCaja || !cVentas) {
    return { ok: false, error: `Faltan cuentas: ${!cCaja ? "1.1.01 (Caja)" : ""} ${!cVentas ? "4.1.02 (Ventas)" : ""}`.trim() };
  }

  const lineas: LineaInput[] = [];
  lineas.push({ cuentaId: cCaja.id, cuentaCodigo: cCaja.codigo, cuentaNombre: cCaja.nombre, debe: montoAbono, haber: 0, orden: 0 });

  if (incluyeIva && montoIva > 0 && cIva) {
    lineas.push({ cuentaId: cVentas.id, cuentaCodigo: cVentas.codigo, cuentaNombre: cVentas.nombre, debe: 0, haber: montoNeto, orden: 1 });
    lineas.push({ cuentaId: cIva.id, cuentaCodigo: cIva.codigo, cuentaNombre: cIva.nombre, debe: 0, haber: montoIva, orden: 2 });
  } else {
    lineas.push({ cuentaId: cVentas.id, cuentaCodigo: cVentas.codigo, cuentaNombre: cVentas.nombre, debe: 0, haber: montoAbono, orden: 1 });
  }

  return insertarAsientoContabilizado({
    scope, userId, fecha, periodo, descripcion,
    origen: "pago_parcial",
    origenId: abonoId,
    moneda: cobro.moneda ?? "CLP",
    lineas,
  });
}

// ─── Generador para un cobro completo ────────────────────────────────────────

/**
 * Genera el asiento contable para un cobro pagado en su totalidad.
 *
 * IMPORTANTE: Si el cobro tiene abonos registrados, NO genera asiento nuevo —
 * cada abono ya tiene su propio asiento de tipo "pago_parcial".
 * Solo genera un asiento de tipo "cobro" si NO hay abonos (pago directo total).
 *
 * Idempotente: si ya existe asiento con origen="cobro" y origenId=cobro.id, lo salta.
 */
export async function generarAsientoCobro(
  scope: string,
  userId: string,
  cobroId: number,
): Promise<GenerarResult> {
  // Verificar si ya tiene asiento de tipo "cobro"
  const [existente] = await db.select({ id: asientosContablesTable.id })
    .from(asientosContablesTable)
    .where(and(
      eq(asientosContablesTable.scope, scope),
      eq(asientosContablesTable.origen, "cobro"),
      eq(asientosContablesTable.origenId, cobroId),
    ));
  if (existente) return { ok: true, skipped: true, asientoId: existente.id };

  // Cargar cobro
  const [cobro] = await db.select().from(cobrosTable).where(eq(cobrosTable.id, cobroId));
  if (!cobro) return { ok: false, error: `Cobro ${cobroId} no encontrado` };
  if (cobro.estado !== "pagado" && cobro.estado !== "parcial") {
    return { ok: false, error: `Cobro ${cobroId} no está pagado (estado: ${cobro.estado})` };
  }

  // Si tiene abonos confirmados, NO generar asiento único — cada abono tiene el suyo
  const abonos = await db.select({ id: pagosParciales.id })
    .from(pagosParciales)
    .where(and(eq(pagosParciales.cobroId, cobroId), eq(pagosParciales.estado, "confirmado")));

  if (abonos.length > 0) {
    // Generar asientos para cada abono que no lo tenga
    let generados = 0;
    for (const { id } of abonos) {
      const r = await generarAsientoAbono(scope, userId, id);
      if (r.ok && !r.skipped) generados++;
    }
    return { ok: true, skipped: generados === 0, numero: `${generados} abonos procesados` };
  }

  // Sin abonos: pago directo total → generar asiento único de tipo "cobro"
  const fecha = cobro.pagadoEn
    ? cobro.pagadoEn.toISOString().slice(0, 10)
    : (cobro.fechaVencimiento ?? new Date().toISOString().slice(0, 10));
  const periodo = fecha.replace(/-/g, "").slice(0, 6);

  const montoTotal = Number(cobro.monto);
  const incluyeIva = cobro.incluyeIva;
  const montoNeto = incluyeIva && cobro.montoNeto ? Number(cobro.montoNeto) : montoTotal;
  const montoIva = incluyeIva && cobro.montoIva ? Number(cobro.montoIva) : 0;

  const descripcion = `Venta ${cobro.clienteNombre ?? "cliente"} - ${cobro.descripcion?.slice(0, 60) ?? `Cobro #${cobro.id}`}`;

  const codigosNecesarios = ["1.1.01", "4.1.02", "2.1.01"];
  const cuentas = await getCuentasPorCodigo(scope, codigosNecesarios);

  const cCaja = cuentas.get("1.1.01");
  const cVentas = cuentas.get("4.1.02");
  const cIva = cuentas.get("2.1.01");

  if (!cCaja || !cVentas) {
    return { ok: false, error: `Faltan cuentas: ${!cCaja ? "1.1.01 (Caja)" : ""} ${!cVentas ? "4.1.02 (Ventas)" : ""}`.trim() };
  }

  const lineas: LineaInput[] = [];
  lineas.push({ cuentaId: cCaja.id, cuentaCodigo: cCaja.codigo, cuentaNombre: cCaja.nombre, debe: montoTotal, haber: 0, orden: 0 });

  if (incluyeIva && montoIva > 0 && cIva) {
    lineas.push({ cuentaId: cVentas.id, cuentaCodigo: cVentas.codigo, cuentaNombre: cVentas.nombre, debe: 0, haber: montoNeto, orden: 1 });
    lineas.push({ cuentaId: cIva.id, cuentaCodigo: cIva.codigo, cuentaNombre: cIva.nombre, debe: 0, haber: montoIva, orden: 2 });
  } else {
    lineas.push({ cuentaId: cVentas.id, cuentaCodigo: cVentas.codigo, cuentaNombre: cVentas.nombre, debe: 0, haber: montoTotal, orden: 1 });
  }

  return insertarAsientoContabilizado({
    scope, userId, fecha, periodo, descripcion,
    origen: "cobro",
    origenId: cobro.id,
    moneda: cobro.moneda ?? "CLP",
    lineas,
  });
}

// ─── Generador para una compra ────────────────────────────────────────────────

/**
 * Genera el asiento contable para una compra recibida.
 * Si ya existe asiento con origen="compra" y origenId=compra.id, lo salta.
 *
 * Partida:
 *   DEBE  5.2.04 Materiales / costo (monto neto)
 *   DEBE  2.1.02 IVA Crédito Fiscal (monto IVA)
 *   HABER 2.1.03 Proveedores (total)
 */
export async function generarAsientoCompra(
  scope: string,
  userId: string,
  compraId: number,
): Promise<GenerarResult> {
  // Verificar si ya tiene asiento
  const [existente] = await db.select({ id: asientosContablesTable.id })
    .from(asientosContablesTable)
    .where(and(
      eq(asientosContablesTable.scope, scope),
      eq(asientosContablesTable.origen, "compra"),
      eq(asientosContablesTable.origenId, compraId),
    ));
  if (existente) return { ok: true, skipped: true, asientoId: existente.id };

  // Cargar compra
  const [compra] = await db.select().from(comprasTable).where(eq(comprasTable.id, compraId));
  if (!compra) return { ok: false, error: `Compra ${compraId} no encontrada` };
  if (compra.estado !== "recibida" && compra.estado !== "contabilizada") {
    return { ok: false, error: `Compra ${compraId} no está recibida (estado: ${compra.estado})` };
  }

  const fecha = compra.fechaRecepcion ?? compra.fechaEmision ?? new Date().toISOString().slice(0, 10);
  const periodo = fecha.replace(/-/g, "").slice(0, 6);

  const total = Number(compra.total);
  const subtotal = Number(compra.subtotal);
  const montoIva = Number(compra.montoIva);

  const descripcion = `Compra ${compra.proveedorNombre ?? "proveedor"} - Fact. ${compra.numeroFactura}`;

  const codigosNecesarios = ["5.2.04", "2.1.02", "2.1.03"];
  const cuentas = await getCuentasPorCodigo(scope, codigosNecesarios);

  const cGasto = cuentas.get("5.2.04");
  const cIvaCredito = cuentas.get("2.1.02");
  const cProveedores = cuentas.get("2.1.03");

  if (!cGasto || !cProveedores) {
    return { ok: false, error: `Faltan cuentas: ${!cGasto ? "5.2.04 (Materiales)" : ""} ${!cProveedores ? "2.1.03 (Proveedores)" : ""}`.trim() };
  }

  const lineas: LineaInput[] = [];
  lineas.push({ cuentaId: cGasto.id, cuentaCodigo: cGasto.codigo, cuentaNombre: cGasto.nombre, debe: subtotal, haber: 0, orden: 0 });

  if (montoIva > 0 && cIvaCredito) {
    lineas.push({ cuentaId: cIvaCredito.id, cuentaCodigo: cIvaCredito.codigo, cuentaNombre: cIvaCredito.nombre, debe: montoIva, haber: 0, orden: 1 });
    lineas.push({ cuentaId: cProveedores.id, cuentaCodigo: cProveedores.codigo, cuentaNombre: cProveedores.nombre, debe: 0, haber: total, orden: 2 });
  } else {
    lineas.push({ cuentaId: cProveedores.id, cuentaCodigo: cProveedores.codigo, cuentaNombre: cProveedores.nombre, debe: 0, haber: subtotal, orden: 1 });
  }

  return insertarAsientoContabilizado({
    scope, userId, fecha, periodo, descripcion,
    origen: "compra",
    origenId: compra.id,
    moneda: compra.moneda ?? "CLP",
    lineas,
  });
}

// ─── Backfill histórico ───────────────────────────────────────────────────────

export interface BackfillResult {
  cobros: { total: number; generados: number; saltados: number; errores: { id: number; error: string }[] };
  compras: { total: number; generados: number; saltados: number; errores: { id: number; error: string }[] };
}

/**
 * Genera asientos para todos los cobros pagados/parciales y compras recibidas
 * que aún no tienen asiento contable, dentro del scope dado.
 * Idempotente: no duplica si ya existen asientos.
 */
export async function backfillAsientosHistoricos(
  scope: string,
  userId: string,
): Promise<BackfillResult> {
  // ── Cobros pagados/parciales ──────────────────────────────────────────────
  let cobrosCond;
  if (scope.startsWith("org:")) {
    const orgId = parseInt(scope.replace("org:", ""));
    cobrosCond = and(eq(cobrosTable.organizationId, orgId), inArray(cobrosTable.estado, ["pagado", "parcial"]));
  } else {
    const uid = scope.replace("user:", "");
    cobrosCond = and(eq(cobrosTable.responsableId, uid), inArray(cobrosTable.estado, ["pagado", "parcial"]));
  }

  const cobros = await db.select({ id: cobrosTable.id }).from(cobrosTable).where(cobrosCond);
  const cobrosResult = { total: cobros.length, generados: 0, saltados: 0, errores: [] as { id: number; error: string }[] };

  for (const { id } of cobros) {
    const r = await generarAsientoCobro(scope, userId, id);
    if (r.skipped) { cobrosResult.saltados++; continue; }
    if (r.ok) {
      // puede haber generado N asientos de abonos; contamos como 1 cobro procesado
      cobrosResult.generados++;
    } else {
      cobrosResult.errores.push({ id, error: r.error ?? "error desconocido" });
    }
  }

  // ── Compras recibidas/contabilizadas ─────────────────────────────────────
  let comprasCond;
  if (scope.startsWith("org:")) {
    const orgId = parseInt(scope.replace("org:", ""));
    comprasCond = and(eq(comprasTable.organizationId, orgId), inArray(comprasTable.estado, ["recibida", "contabilizada"]));
  } else {
    const uid = scope.replace("user:", "");
    comprasCond = and(eq(comprasTable.usuarioId, uid), inArray(comprasTable.estado, ["recibida", "contabilizada"]));
  }

  const compras = await db.select({ id: comprasTable.id }).from(comprasTable).where(comprasCond);
  const comprasResult = { total: compras.length, generados: 0, saltados: 0, errores: [] as { id: number; error: string }[] };

  for (const { id } of compras) {
    const r = await generarAsientoCompra(scope, userId, id);
    if (r.skipped) { comprasResult.saltados++; continue; }
    if (r.ok) comprasResult.generados++;
    else comprasResult.errores.push({ id, error: r.error ?? "error desconocido" });
  }

  return { cobros: cobrosResult, compras: comprasResult };
}
