---
name: Modelo de suscripción de la plataforma
description: Decisión del usuario sobre cómo se cobra la suscripción NextCob y qué NO reintroducir.
---

- **Decisión (ago 2026):** la suscripción será exclusivamente mensual automática vía **Fintoc** (integración pendiente). El pago anticipado de N meses (prepago vía Flow one-off) fue implementado y luego **revertido a pedido explícito del usuario** — no reintroducirlo.
- **Why:** el usuario quiere un único modelo de cobro simple; Fintoc reemplazará a Flow para la suscripción de la plataforma.
- **How to apply:** en Perfil>Suscripción solo debe haber: plan actual, desglose en tiempo real (Plan base 24.990+4.748=29.738; +N usuarios extra 9.990+1.898=11.888 c/u; Total mensual) y un botón "Suscribirse" **deshabilitado** hasta integrar Fintoc. El desglose viene de `/subscription/status` (totalMensual, usuariosAdicionales, costoUsuarioAdicional*) y se refresca porque team-section invalida esa query al cambiar asientos.
- Los precios per-seat siguen duplicados en `lib/org.ts` ↔ `lib/subscription.ts` (import circular) — mantener en sync.
- El backend de la suscripción recurrente Flow existente (subscribe/webhook flow-subscription) sigue vivo pero sin entrada desde la UI; se eliminará al integrar Fintoc.
