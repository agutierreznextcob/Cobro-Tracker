---
name: Modelo de suscripción de la plataforma
description: Cómo se cobra la suscripción NextCob (Reveniu mensual) y qué NO reintroducir.
---

- **Estado actual (ago 2026):** suscripción mensual automática vía **Reveniu** (Transbank OneClick), ACTIVA con checkout desde la UI (form POST TBK_TOKEN a completionUrl). La mención anterior a "botón deshabilitado hasta Fintoc" quedó obsoleta: Reveniu reemplazó ese plan.
- El pago anticipado de N meses (prepago vía Flow one-off) fue implementado y luego **revertido a pedido explícito del usuario** — no reintroducirlo. Un único modelo de cobro mensual.
- Perfil>Suscripción muestra: plan actual (ver [planes-suscripcion.md](planes-suscripcion.md)), desglose en tiempo real desde `/subscription/status` (plan base + usuarios extra 9.990+1.898=11.888 c/u + total mensual) y botón "Ver planes" (selector Starter/NextCob/Pro-waitlist). team-section invalida esa query al cambiar asientos.
- Los precios per-seat siguen duplicados en `lib/org.ts` ↔ `lib/subscription.ts` (import circular) — mantener en sync. Los precios base ahora dependen del plan (PLANES en lib/plans.ts).
- Reveniu es custom-amount: NO se crean planes en Reveniu; upgrade/downgrade = `setReveniuAmount` + `reveniuMontoSync` (transaccional, ver planes-suscripcion.md).
