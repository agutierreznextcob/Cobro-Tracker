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

**Tipo de documento (DTE) gating IVA:**
- `cobros.tipoDocumento` enum: factura_afecta, factura_exenta, boleta_afecta, boleta_exenta, sin_documento
  (default sin_documento). Only `*_afecta` may carry IVA — single source of truth is
  `tipoDocumentoPermiteIva()` duplicated server-side (cobros.ts) and client-side
  (cobros-app/src/lib/tipo-documento.ts); keep both in sync.
- **Why:** Chilean exenta/boleta-exenta/informal documents are legally VAT-free, so IVA must be
  forced off — never trust the client's `incluyeIva` for non-afecta types.
- Server invariant: POST forces `incluyeIva = permiteIva && client.incluyeIva===true`. PATCH that
  switches tipo to a non-afecta type must NORMALIZE unconditionally (incluyeIva=false, montoNeto/montoIva=null)
  and revert `monto` to net — falling back to `monto - montoIva` when a legacy row has incluyeIva=true but
  a null montoNeto, so an IVA-inclusive total is never left behind.
- PATCH does NOT auto-enable/recompute IVA when switching TO an afecta type (stays off by design).
