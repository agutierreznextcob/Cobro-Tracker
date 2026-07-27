---
name: pagadoEn & revenue accounting
description: How paid-date and partial-payment revenue is tracked; rules any new payment path must follow.
---

# pagadoEn & revenue accounting

**Rule:** `cobros.pagadoEn` records the first transition to `pagado` (kept via `coalesce(pagadoEn, now())`), preserved on `parcial`, cleared when estado drops to a no-money state. EVERY code path that writes `cobros.estado` must maintain it: `aplicarEstadoCobro` + `recalcularCobroDesdeAbonos` (webhooks), `recalcularEstadoCobro` + PATCH estado (cobros routes).

**Why:** Informes revenue was bucketed by `creadoEn` and ignored abonos of `parcial` cobros — misleading financial reports. Now: pagado cobros are filtered/bucketed by `pagadoEn ?? creadoEn`; parcial revenue = `montoACobrar - saldo`.

**Also:** all recaudado/pendiente aggregates (e.g. /organization/rendimiento) must use net amount (`monto - montoDescuento`) plus confirmed abonos — never raw `monto`.

**How to apply:** any new estado-writing path or revenue report: set/clear `pagadoEn` consistently and account for abonos + descuentos.
