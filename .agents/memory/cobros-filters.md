---
name: Cobros list filters
description: Query params for GET /cobros and how metodo maps to DB conditions
---

## Estado filter
`?estado=pendiente|pagado|parcial|fallido|cancelado` — direct eq on cobrosTable.estado.

## Metodo filter
`?metodo=flow` → isNotNull(cobrosTable.flowLinkPago)
`?metodo=mp` → isNotNull(cobrosTable.mpPaymentLinkUrl)
`?metodo=link` → OR(flow, mp)
`?metodo=manual` → AND(isNull(flow), isNull(mp))

**Why:** "metodo" is inferred from which payment link columns are populated, not a stored enum — cobros don't store a metodo field, they store the actual link URLs.
