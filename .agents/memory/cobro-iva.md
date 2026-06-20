---
name: Cobro IVA (Chilean VAT 19%)
description: Optional IVA on cobros — how net/iva/total are computed, stored, and where monto semantics shift.
---

Optional Chilean VAT (IVA 19%) on a cobro, chosen at creation time in "Nuevo cobro".

**Model:**
- `cobros.incluyeIva` boolean (default false). `montoNeto`/`montoIva` numeric, nullable.
- When `incluyeIva=true`: the user enters the NETO; the SERVER computes
  `montoNeto = round(entered)`, `montoIva = round(neto * 0.19)`, and stores
  `monto = neto + iva` (the charged total). Frontend only sends `monto` (= neto) + `incluyeIva`.
- When `incluyeIva=false`: `monto` = entered amount, `montoNeto`/`montoIva` are null (unchanged behavior).

**Why:** Keep CLP integer rounding server-side (single source of truth) and keep `monto` as the
canonical charged total so existing discount math (`montoACobrar = monto - montoDescuento`) and Flow/MP
payment-link generation work unchanged — links always charge the IVA-inclusive total.

**How to apply:**
- Detail view shows a Neto / IVA / Total breakdown when `incluyeIva`; the discount block also surfaces
  the Neto/IVA lines when both IVA and a discount apply (discount is applied on the IVA-inclusive total).
- Informes Excel export has "Neto (sin IVA)" and "IVA (19%)" columns (blank when no IVA).
- Discounts are applied AFTER creation, so an IVA cobro can later also have a discount.
