---
name: Prepago de suscripción (Flow one-off)
description: Pago anticipado 1/3/6/12 meses de la suscripción plataforma vía orden one-off Flow; extensión de periodo, interacción con webhook recurrente y aviso de renovación 7 días.
---

- Tabla `prepagos_suscripcion`: snapshot de montos (neto/iva/total, usuarios extra), `commerceOrder` único, estado pendiente→pagado/rechazado.
- Webhook público `/webhooks/flow-prepago`: re-verifica con creds admin (`verificarPagoFlow`), y el claim (pendiente→pagado) + la extensión de `subscription_period_end` van en **UNA transacción** — si no, un crash deja la fila "pagada" sin meses aplicados (hallazgo del architect). Extensión: `GREATEST(now, periodEnd, trialEnd) + N meses` en SQL.
- **El webhook recurrente `/webhooks/flow-subscription` nunca debe ACHICAR el entitlement**: usa GREATEST con el periodEnd existente y mantiene `activa` mientras la fecha mayor sea futura; si no, un cobro recurrente pisa los meses prepagados.
- Precios: desglose siempre por componentes redondeados (base 24.990+4.748; extra 9.990+1.898 = 11.888). Los mismos números viven en `lib/org.ts` (COSTO_USUARIO_ADICIONAL_*) y duplicados en `lib/subscription.ts` para evitar import circular — mantener en sync.
- `/subscription/status` expone desglose en tiempo real (usuariosAdicionales, totalMensual, etc.); team-section invalida esa query al cambiar asientos.
- UI: PrepagoSection visible en activa, prueba y vencida (el router de subscription solo exige auth, NO requireSubscription — necesario para reactivar vencidos).
- Aviso de renovación 7 días antes: `renovacion_aviso_para_el` guarda el periodEnd ya avisado (claim-first, idempotente por período), barrido en el tick diario; excluye esDemo.
