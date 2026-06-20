---
name: Flow plan pricing & IVA-inclusive model
description: How platform subscription pricing works and the Flow plan-id versioning rule for price changes
---

# Platform subscription pricing (Cobro Simple's own plan)

Prices shown and charged are **IVA-inclusive** (Chilean VAT 19%). Single source of
truth lives in `flow-subscriptions.ts` and `org.ts`:
- Base plan: neto + IVA = charged total (`PLAN_NETO` + `PLAN_IVA` = `PLAN_AMOUNT`).
- Additional seat: neto + IVA = total (`COSTO_USUARIO_ADICIONAL_*`). Seat pricing is
  DISPLAY-ONLY — Flow only charges `PLAN_AMOUNT`; extra seats are not separately billed yet.
- IVA computed with `Math.round(neto * IVA_RATE)`, CLP integers.
- Backend exposes neto/iva/total via OpenAPI (`SubscriptionStatus.precioNeto/precioIva`,
  `OrganizacionInfo.planBase*/costoUsuarioAdicional*`) so the UI renders a transparent
  "Neto + IVA = Total" breakdown everywhere prices appear.

## Critical rule: changing the plan price requires bumping `PLAN_ID`

`ensurePlan()` only calls Flow `/plans/create` and **swallows the "already exists" error**.
Flow does NOT update the price of an existing planId. So editing `PLAN_AMOUNT` alone does
NOT change what real subscriptions are charged — the old plan keeps its old price.

**How to apply:** Any time you change the charged amount, also bump `PLAN_ID` (e.g. add a
suffix like `_iva19`) so a fresh Flow plan is created at the new amount. New subscriptions
bind to the new plan; existing subscribers stay on their old plan until they re-subscribe.

**Why:** A prior price change (18.990 → 22.598 IVA-incl.) would have silently kept charging
the old price in production because the plan id already existed in Flow.
