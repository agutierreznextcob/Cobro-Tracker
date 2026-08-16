---
name: Salud de cartera dashboard
description: Contract and math for GET /dashboard/salud-cartera (semáforo, acciones, tendencia semanal)
---

# Salud de cartera (dashboard)

- Classification of OPEN cobros (pendiente/parcial) by `fechaVencimiento` (date-only string, compared lexically): `< hoy` = crítica, `<= hoy+7` = riesgo, else (or null venc) = sana. Amounts use `saldo` (net of confirmed abonos), never raw monto.
- **Day boundaries must use America/Santiago** (Intl en-CA → YYYY-MM-DD), not server-local/UTC midnight; day arithmetic on a UTC-noon anchor (DST-safe).
- **Trend prefers a stored daily snapshot** (`salud_cartera_snapshots`, one row per user per Santiago day, written by the daily scheduler sweep; unique usuario+fecha, ON CONFLICT DO NOTHING). Route picks the snapshot closest to hoy-7 within ±2 days; only when none exists does it fall back to the reconstruction below. Snapshots are per-viewer (admin=org, supervisor=team, ejecutivo=own) — shared math lives in lib/salud-cartera.ts.
- **Fallback week-over-week reconstruction**: exclude cobros with `creadoEn` after the 7-day cutoff; open cobros valued at saldo + abonos confirmed during the week; terminal cobros count only if closed after the cutoff (pagadoEn for pagado, actualizadoEn otherwise). "Mejor" = money leaves riesgo/crítica or enters sana; threshold max(5%, $1.000) → "igual".
- Acciones: open cobros grouped per cliente, priority = weighted monto 35% / mora-o-urgencia 30% / score-riesgo 20% / días sin contacto 15%; top 5. Cliente names query MUST also apply `clienteScopeCondition` (not just ids from scoped cobros). Contactar button links to the client's most urgent cobro detail.

**Why:** review found the naive prior-snapshot counted newly created cobros as "worsening" and UTC midnight misclassified due dates for hours daily.
**How to apply:** any new date-only due-date logic or historical comparison on cobros should follow the same timezone + cutoff rules.
