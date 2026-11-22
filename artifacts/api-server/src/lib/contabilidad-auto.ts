/**
 * Generación automática de asientos contables desde cobros y compras.
 *
 * Lógica de partida doble:
 *
 * COBRO PAGADO (venta):
 *   DEBE  1.1.03 Deudores comerciales / Clientes (o 1.1.01 Caja si pago inmediato)
 *   DEBE  2.1.01 IVA Débito Fiscal  (si incluye IVA)
 *   HABER 4.1.01 Ventas de productos  -OR-  4.1.02 Prestación de servicios
 *   HABER 2.1.01 IVA Débito Fiscal    (si incluye IVA, como cuenta de pasivo)
 *
 * Simplificado (práctico para pymes):
 *   DEBE  1.1.01 Caja / Banco (monto total recibido)
 *   HABER 4.1.02 Prestación de servicios (monto neto)
 *   HABER 2.1.01 IVA Débito Fiscal (monto IVA)
 *
 * COMPRA RECIBIDA (gasto/costo):
 *   DEBE  5.2.xx Cuenta de gasto  (monto neto)
 *   DEBE  2.1.02 IVA Crédito Fiscal (monto IVA)
 *   HABER 2.1.03 Proveedores / Cuentas por pagar (total)
 */
import { db, cobrosTable, comprasTable, compraItemsTable, planCuentasTable, asientosContablesTable, asientoLineasTable } from "@workspace/db";
import { eq, and, inArray, like, isNull, sql, asc } from "drizzle-orm";

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

/** Inserta asiento + lineas y lo deja en estado "contabilizado" directamente */
async function insertarAsientoContabilizado(input: AsientoInput): Promise<GenerarResult> {
  const { scope, userId, fecha, periodo, descripcion, origen, origenId, moneda, lineas } = input;

  const totalDebe = lineas.reduce((s, l) => s + l.debe, 0);
  const totalHaber = lineas.reduce((s, l) => s + l.haber, 0);
  if (Math.abs(totalDebe - totalHaber) > 0.5) {
    return { ok: false, error: `Asiento descuadrado: debe=${totalDebe.toFixed(2)} haber=${totalHaber.toFixed(2)}` };
  }

  const anio = periodo.substring(0, 4);
  const numero = await nextNumero(scope, anio);

  const [asiento] = await db.insert(asientosContablesTable).values({
    scope, numero, fecha, periodo, descripcion,
    estado: "contabilizado",
    origen,
    origenId,
    moneda,
    usuarioId: userId,
  }).returning();

  await db.insert(asientoLineasTable).values(
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
}

// ─── Mapa de cuentas por código ───────────────────────────────────────────────

/** Busca cuentas del plan por sus códigos. Retorna map codigo→cuenta. */
async function getCuentasPorCodigo(scope: string, codigos: string[]): Promise<Map<string, { id: number; codigo: string; nombre: string }>> {
  const rows = await db.select({ id: planCuentasTable.id, codigo: planCuentasTable.codigo, nombre: planCuentasTable.nombre })
    .from(planCuentasTable)
    .where(and(eq(planCuentasTable.scope, scope), inArray(planCuentasTable.codigo, codigos), eq(planCuentasTable.activa, true)));
  return new Map(rows.map(r => [r.codigo, r]));
}

// ─── Generador para un cobro ──────────────────────────────────────────────────

/**
 * Genera el asiento contable para un cobro pagado o parcial.
 * Si ya existe un asiento con origen="cobro" y origenId=cobro.id, lo salta.
 *
 * Partida:
 *   DEBE  1.1.01 Caja y banco (monto total pagado hasta ahora)
 *   HABER 4.1.02 Prestación de servicios (monto neto)
 *   HABER 2.1.01 IVA Débito Fiscal (monto IVA, si aplica)
 */
export async function generarAsientoCobro(
  scope: string,
  userId: string,
  cobroId: number,
): Promise<GenerarResult> {
  // Verificar si ya tiene asiento
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

  const fecha = cobro.pagadoEn
    ? cobro.pagadoEn.toISOString().slice(0, 10)
    : (cobro.fechaVencimiento ?? new Date().toISOString().slice(0, 10));
  const periodo = fecha.replace(/-/g, "").slice(0, 6); // AAAAMM

  // Montos
  const montoTotal = Number(cobro.monto);
  const incluyeIva = cobro.incluyeIva;
  const montoNeto = incluyeIva && cobro.montoNeto ? Number(cobro.montoNeto) : montoTotal;
  const montoIva = incluyeIva && cobro.montoIva ? Number(cobro.montoIva) : 0;

  // Para cobros parciales: usar monto total (lo que se debe, luego se ajusta)
  // La partida representa la venta reconocida
  const descripcion = `Venta ${cobro.clienteNombre ?? "cliente"} - ${cobro.descripcion?.slice(0, 60) ?? `Cobro #${cobro.id}`}`;

  // Obtener cuentas del plan
  const codigosNecesarios = ["1.1.01", "4.1.02", "2.1.01"];
  const cuentas = await getCuentasPorCodigo(scope, codigosNecesarios);

  const cCaja = cuentas.get("1.1.01");
  const cVentas = cuentas.get("4.1.02");
  const cIva = cuentas.get("2.1.01");

  if (!cCaja || !cVentas) {
    return { ok: false, error: `Faltan cuentas en el plan de cuentas: ${!cCaja ? "1.1.01 (Caja)" : ""} ${!cVentas ? "4.1.02 (Ventas)" : ""}`.trim() };
  }

  const lineas: LineaInput[] = [];

  // DEBE: Caja/Banco por el total
  lineas.push({ cuentaId: cCaja.id, cuentaCodigo: cCaja.codigo, cuentaNombre: cCaja.nombre, debe: montoTotal, haber: 0, orden: 0 });

  if (incluyeIva && montoIva > 0 && cIva) {
    // HABER: Ventas (neto)
    lineas.push({ cuentaId: cVentas.id, cuentaCodigo: cVentas.codigo, cuentaNombre: cVentas.nombre, debe: 0, haber: montoNeto, orden: 1 });
    // HABER: IVA Débito Fiscal
    lineas.push({ cuentaId: cIva.id, cuentaCodigo: cIva.codigo, cuentaNombre: cIva.nombre, debe: 0, haber: montoIva, orden: 2 });
  } else {
    // HABER: Ventas (monto total)
    lineas.push({ cuentaId: cVentas.id, cuentaCodigo: cVentas.codigo, cuentaNombre: cVentas.nombre, debe: 0, haber: montoTotal, orden: 1 });
  }

  return insertarAsientoContabilizado({
    scope, userId, fecha, periodo, descripcion,
    origen: cobro.estado === "parcial" ? "pago_parcial" : "cobro",
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
    return { ok: false, error: `Faltan cuentas en el plan de cuentas: ${!cGasto ? "5.2.04 (Materiales)" : ""} ${!cProveedores ? "2.1.03 (Proveedores)" : ""}`.trim() };
  }

  const lineas: LineaInput[] = [];

  // DEBE: Gasto/Costo (subtotal neto)
  lineas.push({ cuentaId: cGasto.id, cuentaCodigo: cGasto.codigo, cuentaNombre: cGasto.nombre, debe: subtotal, haber: 0, orden: 0 });

  // DEBE: IVA Crédito Fiscal (si existe y si hay cuenta)
  if (montoIva > 0 && cIvaCredito) {
    lineas.push({ cuentaId: cIvaCredito.id, cuentaCodigo: cIvaCredito.codigo, cuentaNombre: cIvaCredito.nombre, debe: montoIva, haber: 0, orden: 1 });
    // HABER: Proveedores (total con IVA)
    lineas.push({ cuentaId: cProveedores.id, cuentaCodigo: cProveedores.codigo, cuentaNombre: cProveedores.nombre, debe: 0, haber: total, orden: 2 });
  } else {
    // HABER: Proveedores (total sin IVA)
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
 */
export async function backfillAsientosHistoricos(
  scope: string,
  userId: string,
): Promise<BackfillResult> {
  // ── Cobros pagados/parciales sin asiento ─────────────────────────────────
  // IDs de cobros que ya tienen asiento
  const cobrosConAsiento = await db.select({ origenId: asientosContablesTable.origenId })
    .from(asientosContablesTable)
    .where(and(
      eq(asientosContablesTable.scope, scope),
      inArray(asientosContablesTable.origen, ["cobro", "pago_parcial"]),
    ));
  const cobrosConAsientoIds = new Set(cobrosConAsiento.map(r => r.origenId).filter((id): id is number => id != null));

  // Cobros pagados/parciales según scope
  // Para scope org:X → organizationId; para user:X → responsableId
  let cobrosCond;
  if (scope.startsWith("org:")) {
    const orgId = parseInt(scope.replace("org:", ""));
    cobrosCond = and(
      eq(cobrosTable.organizationId, orgId),
      inArray(cobrosTable.estado, ["pagado", "parcial"]),
    );
  } else {
    const uid = scope.replace("user:", "");
    cobrosCond = and(
      eq(cobrosTable.responsableId, uid),
      inArray(cobrosTable.estado, ["pagado", "parcial"]),
    );
  }

  const cobros = await db.select({ id: cobrosTable.id }).from(cobrosTable).where(cobrosCond);
  const cobrosSinAsiento = cobros.filter(c => !cobrosConAsientoIds.has(c.id));

  const cobrosResult = { total: cobros.length, generados: 0, saltados: cobrosConAsientoIds.size, errores: [] as { id: number; error: string }[] };

  for (const { id } of cobrosSinAsiento) {
    const r = await generarAsientoCobro(scope, userId, id);
    if (r.skipped) { cobrosResult.saltados++; continue; }
    if (r.ok) cobrosResult.generados++;
    else cobrosResult.errores.push({ id, error: r.error ?? "error desconocido" });
  }

  // ── Compras recibidas/contabilizadas sin asiento ──────────────────────────
  const comprasConAsiento = await db.select({ origenId: asientosContablesTable.origenId })
    .from(asientosContablesTable)
    .where(and(
      eq(asientosContablesTable.scope, scope),
      eq(asientosContablesTable.origen, "compra"),
    ));
  const comprasConAsientoIds = new Set(comprasConAsiento.map(r => r.origenId).filter((id): id is number => id != null));

  let comprasCond;
  if (scope.startsWith("org:")) {
    const orgId = parseInt(scope.replace("org:", ""));
    comprasCond = and(
      eq(comprasTable.organizationId, orgId),
      inArray(comprasTable.estado, ["recibida", "contabilizada"]),
    );
  } else {
    const uid = scope.replace("user:", "");
    comprasCond = and(
      eq(comprasTable.usuarioId, uid),
      inArray(comprasTable.estado, ["recibida", "contabilizada"]),
    );
  }

  const compras = await db.select({ id: comprasTable.id }).from(comprasTable).where(comprasCond);
  const comprasSinAsiento = compras.filter(c => !comprasConAsientoIds.has(c.id));

  const comprasResult = { total: compras.length, generados: 0, saltados: comprasConAsientoIds.size, errores: [] as { id: number; error: string }[] };

  for (const { id } of comprasSinAsiento) {
    const r = await generarAsientoCompra(scope, userId, id);
    if (r.skipped) { comprasResult.saltados++; continue; }
    if (r.ok) comprasResult.generados++;
    else comprasResult.errores.push({ id, error: r.error ?? "error desconocido" });
  }

  return { cobros: cobrosResult, compras: comprasResult };
}
