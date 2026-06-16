---
name: Abonos / pagos parciales
description: Pattern for partial payment (abono) creation, confirmation, and webhook dispatch in Cobro Simple
---

## Schema
`pagosParciales` table: id, cobroId (FK cobros), monto (numeric), metodo (flow/mp/manual enum), estado (pendiente/confirmado/fallido enum), linkPago, flowToken, flowOrdenId, mpPreferenceId, mpPaymentId, notas, creadoEn, confirmadoEn.

## Routes (cobros.ts)
- `GET /cobros/:id/abonos` — list abonos for cobro
- `POST /cobros/:id/abonos` — body: { monto, metodo, notas?, emailPagador? }
  - manual: insert confirmed immediately → recalculate cobro estado
  - flow: insert pending → call crearOrdenFlow with commerceOrder `abono-{id}` → update abono with token/url; roll back insert on Flow error
  - mp: insert pending → call crearPreferenciaMp with externalReference `abono-{id}` → update abono; roll back on MP error
- `POST /cobros/:id/abonos/:abonoId/confirmar` — manually confirm a pending abono

## recalcularEstadoCobro helper (inline, not shared)
Sum confirmed abono montos → compare to cobro.monto → set pagado/parcial/pendiente. Defined both in cobros.ts and inlined in webhooks.ts.

## Webhook dispatch (webhooks.ts)
**Flow webhook**: check pagosParciales.flowToken FIRST (before cobrosTable.flowToken). If abono found: verify payment → confirm abono + recalculate cobro.
**MP webhook**: check external_reference for `abono-{id}` pattern BEFORE `cobro-{id}` pattern. Route accordingly.

**Why:** Separating abono vs cobro dispatch at webhook level prevents double-processing and keeps each path independent.

## Frontend (cobro-detail.tsx)
`useListAbonos(id)` + `useCrearAbono()` + `useConfirmarAbono()`. Shows monto total / pagado / saldo summary. Form collapses with showAbonoForm state. Flow abonos need emailPagador — falls back to cobro.emailPagador.
