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

Al crear la primera bodega de un negocio, se asigna allí todo su stock general existente, incluidos saldos negativos y productos archivados, sin variar totales. Sin bodegas, el negocio sigue operando con stock general.
**Why:** la adopción de bodegas no debe perder ni duplicar existencias anteriores. La asignación automática evita dejar stock fuera de la suma por bodegas.
**How to apply:** serializar la creación de bodegas y productos por negocio y bloquear productos durante la primera asignación para no competir con pagos. Los traslados son una sola operación atómica con ambos extremos.

El usuario pide descuento desde la bodega elegida en el cobro y, si no elige, desde la de mayor stock disponible en el momento del pago. Los umbrales críticos son individuales por bodega.
**Why:** una alerta local no debe desaparecer por existir más unidades en otro local.
**How to apply:** no repartir automáticamente una línea entre bodegas; conservar la bodega efectiva en el movimiento. Los totales de un local suman cantidades de unidades distintas y no representan una magnitud física homogénea.
