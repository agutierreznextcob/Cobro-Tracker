---
name: Gestiones agenda contract invariant
description: Why /gestiones/agenda must only emit gestiones that scheduled a próxima gestión
---

The `/gestiones/agenda` endpoint builds one agenda item per in-progress cobro from its
latest gestión. An agenda item's `proximaGestionTipo` is **required non-null** by the
OpenAPI contract (`GestionAgendaItem`), and the dashboard indexes a label map by it
(`GESTION_TIPO_LABEL[g.proximaGestionTipo]`).

**Rule:** when selecting the latest gestión per cobro for the agenda, filter to rows
where BOTH `proximaGestionEn` AND `proximaGestionTipo` are non-null (a scheduled
próxima gestión). Do not take "latest gestión overall then drop if no fecha" — that
both violates the contract (null tipo) and can miss a cobro whose latest gestión
didn't schedule a follow-up even though an earlier one did.

**Why:** `proximaGestionTipo` is nullable in the DB (set only when the user checks
"programar próxima gestión"). Emitting an item with null tipo breaks the typed client
and renders a blank label.

**How to apply:** in `artifacts/api-server/src/routes/gestiones.ts` agenda query, use
`isNotNull(proximaGestionEn)` + `isNotNull(proximaGestionTipo)` in the WHERE.
