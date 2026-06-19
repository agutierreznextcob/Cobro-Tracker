---
name: Cobro descuentos (discount) model
description: How discounts/negotiation work on cobros — amount derivation, history, and where montoACobrar must be used.
---

Discount/negotiation feature on cobros.

**Model:**
- `cobros.monto` always stays the ORIGINAL amount — never overwritten by a discount.
- `cobros.montoDescuento` = current effective ABSOLUTE discount (CLP integer), nullable.
- `montoACobrar = monto - (montoDescuento ?? 0)` — the amount actually owed/charged.
- `cobro_descuentos` is an append-only history table (tipo porcentaje|fijo, valor, montoDescuento,
  montoOriginal, montoFinal, motivo, fechaVigencia, aplicadoPorId/Nombre, creadoEn).
- Each new discount REPLACES `cobros.montoDescuento` AND inserts a new history row. The discount is
  always computed off the ORIGINAL `monto`, not the previously discounted value.

**Why:** Keeps an auditable trail of every negotiation while the canonical original price is
preserved for reporting (recovery rate = recaudado vs original).

**How to apply:**
- Validation: porcentaje <= 100, absolute discount > 0 and < montoOriginal; blocked when estado is
  pagado or cancelado.
- ALWAYS use `montoACobrar` (not `monto`) for: payment-link amounts (Flow/MP, via
  `Math.round`), saldo/abono math, `recalcularEstadoCobro`, and customer-facing amount text.
- In Informes, recaudado/recovery aggregates must use `montoACobrar` for paid cobros so reports stay
  consistent with discounted collection; `monto` is only the "original" reference column.
- Backend serialization exposes both `montoDescuento` and computed `montoACobrar` on every Cobro.
