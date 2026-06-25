---
name: Cobro saldo field
description: Where outstanding balance (saldo) comes from and why aging/receivables must use it instead of montoACobrar.
---

# Cobro `saldo`

`GET /cobros` and `GET /cobros/:id` return an optional `saldo` = `montoACobrar` minus the sum of
confirmed `pagosParciales` (abonos); it is `0` for terminal states (pagado/cancelado/fallido).
`saldo` is omitted (undefined) on serialization paths that don't pass the abono total (e.g. PATCH responses).

**Why:** the aging / "Cuentas por Cobrar" report and any receivables total must NOT use `montoACobrar`
for `parcial` cobros — that overstates what is owed by ignoring confirmed abonos. Frontend uses
`c.saldo ?? c.montoACobrar ?? fallback` so it degrades safely when `saldo` is absent.

**How to apply:** when summing "what is still owed" for `pendiente`/`parcial` cobros, read `saldo`.
The public debtor portal computes the same value independently in `routes/portal.ts`.
