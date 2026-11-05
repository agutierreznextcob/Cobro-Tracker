---
name: Compras y recepción
description: Permisos confirmados y decisiones sobre inventario, costos y preparación para SII.
---

Compras debe ser un módulo independiente en el menú principal, no un submenú de Ventas.
**Why:** el usuario pidió expresamente separarlo de Ventas.
**How to apply:** mantener esta separación al reorganizar la navegación.

El usuario eligió que administradores y supervisores puedan confirmar recepciones y actualizar costos; los ejecutivos preparan borradores. Las cuentas independientes actúan como administradoras de su negocio.
**Why:** la recepción modifica existencias y costos compartidos, no solo documentos personales.
**How to apply:** aplicar el permiso en servidor, también en las acciones de recepción y contabilización, sin confiar en botones ocultos.

La recepción es atómica e idempotente: entradas por bodega, movimientos, sincronización automática de costos netos, historial, notificación y estado. El costo de factura reemplaza al registrado sin preguntar, incluso si antes era cero; mantiene el margen y recalcula el sugerido, nunca adopta automáticamente ese precio como precio de venta.
**Why:** el usuario cambió expresamente el criterio anterior de aceptación/rechazo por producto y confirmó «Actualizar automáticamente sin preguntar».
**How to apply:** no reintroducir decisiones por costo. Revalidar la versión del borrador y leer costos actuales bajo bloqueo; guardar historial y notificación en la misma transacción. Facturas recibidas no se editan ni eliminan; devolver físicamente no revierte costos.

SII es preparación futura únicamente: origen manual hoy, campos reservados para folio/XML y botón deshabilitado. Marcar contabilizada es una marca manual, no una declaración al SII ni generación de asientos.
**Why:** el alcance solicitado excluye integración real y requiere certificado digital para el futuro.
**How to apply:** no presentar importaciones o contabilización externa como funcionales sin implementarlas explícitamente.

Las devoluciones a proveedores son salidas físicas desde la bodega original de recepción, sin revertir costos ni generar reembolsos automáticamente. No cambian el estado recibido/contabilizado ni los importes originales.
**Why:** el usuario pidió conservar el historial de recepción y separar la devolución física de su resolución financiera.
**How to apply:** cualquier futura nota de crédito o informe neto debe distinguir compras originales de devoluciones, sin reescribir la factura recibida.
