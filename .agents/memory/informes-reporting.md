---
name: Informes (reporting) page design
description: How the Cobros > Informes analytics/export page sources and aggregates data.
---

# Informes (reporting) page

The Informes page (`/cobros/informes`, under the Cobros sidebar section) does NOT have its own API/aggregation endpoint. It reuses the existing generated `useListCobros` hook (returns all cobros with every field) and computes everything client-side: date-range filtering, time bucketing, per-status/per-method aggregation, the numeric summary, and the Excel export.

**Why:** keeps the report consistent with what the Cobros list shows (same global, non-user-scoped dataset), and avoids new OpenAPI/codegen churn for a small-scale app. The dashboard metrics endpoint IS user-scoped (responsableId) — Informes intentionally is not, to match the list.

**How to apply:**
- "Recaudado" = sum of `monto` where `estado === "pagado"`, bucketed by `creadoEn`.
- Effective collection rate = paid count / total count in period.
- Payment-method classification precedence for the pie chart: Flow > MercadoPago > Manual (a cobro with both Flow and MP links counts as Flow). The Excel detail labels the both-links case as "Flow + MercadoPago".
- Granularity (día/semana/mes) auto-picks from range span (≤31d day, ≤180d week, else month) unless manually overridden.
- Excel via dynamically-imported `xlsx` (devDependency in cobros-app) — keeps it out of the main bundle.
- Route `/cobros/informes` MUST be registered before `/cobros/:id` in the wouter Switch, or it gets captured as an id.
