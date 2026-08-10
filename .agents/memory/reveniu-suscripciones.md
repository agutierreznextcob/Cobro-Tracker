---
name: Reveniu suscripciones plataforma
description: Cómo funciona el cobro de suscripciones NextCob vía Reveniu (checkout, webhooks, idempotencia, gracia).
---

# Reveniu (suscripciones de la plataforma)

- Checkout: plan mensual custom-amount (id cacheado en `app_config`, prioridad env `REVENIU_PLAN_ID` → app_config → crear). `POST /subscriptions/` con `external_id=userId` devuelve `{id, completion_url, security_token}`; el frontend hace **form POST** a completion_url con hidden `TBK_TOKEN=security_token`. Rechazar checkout sin security_token.
- Webhooks (`/api/webhooks/reveniu`, público antes del blanket auth): se validan comparando el header `Reveniu-Secret-Key` (timing-safe) — Reveniu no firma payloads. 401 si no coincide; si no, siempre 200.
- **Idempotencia**: el payload NO trae payment id ni período. El fin de período autoritativo es `next_due` de `GET /subscriptions/{id}`; se usa como `periodo_hasta` (estable ante retries → UNIQUE user+período deduplica). Sin next_due: activar acceso pero NO insertar en libro de ingresos ni mover período.
- **Transiciones en SQL, no en JS**: `status` con `CASE` sobre la fila actual (cancelada nunca vuelve a activa por eventos rezagados; deactivated → cancelada si período vigente, si no vencida). Períodos solo con `greatest()` (nunca acortar).
- No existe evento de pago fallido: Reveniu reintenta ~4 días. La gracia de 3 días se detecta por período vencido sin pago (barrido diario, claim atómico en `avisoPagoFallidoEn`).
- Cancelar = `POST /subscriptions/{id}/disablerenew/` + status cancelada (acceso hasta periodEnd). Método de pago: `https://app.reveniu.com/renew/{id}`. Cambio de monto mensual: `POST /subscriptions/{id}/amount/` (sync diario vs `reveniuMontoSync`).
- **Why:** los webhooks se reenvían y llegan fuera de orden; sin período estable ni transiciones condicionales se duplican ingresos y se pisan cancelaciones.
- **How to apply:** cualquier cambio al handler de webhooks o al libro `pagos_suscripcion` debe preservar periodo_hasta=next_due, greatest() y los CASE de estado.
