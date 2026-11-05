---
name: Inventario y pagos
description: Decisiones de consistencia y alcance del catálogo y del descuento de stock.
---

El catálogo es compartido dentro de cada organización; las cuentas sin organización tienen catálogo propio.
**Why:** los productos representan existencias del negocio, no la cartera individual de un ejecutivo.
**How to apply:** mantener aislamiento entre organizaciones sin aplicar el alcance de clientes o cobros al catálogo.

Un pago confirmado descuenta existencias incluso si deja stock negativo. Las salidas manuales rechazan cantidades superiores al disponible. No se resta otra vez por notificaciones repetidas ni se repone automáticamente por reversar un estado.
**Why:** no se debe rechazar dinero ya recibido por falta de stock; una devolución física requiere una decisión explícita y auditable.
**How to apply:** conservar la atomicidad entre pago y movimiento en todos los escritores de estado, incluidos webhooks y abonos. Para reponer existencias usar movimientos manuales.

La integridad de pago y stock se mantiene en la base de datos, no en un único controlador HTTP.
**Why:** hay múltiples caminos de pago existentes y futuros. Además, el despliegue del esquema por sí solo no instala las funciones y triggers SQL.
**How to apply:** mantener la inicialización idempotente antes de aceptar tráfico y cubrir cambios de pago con pruebas de concurrencia e idempotencia.
