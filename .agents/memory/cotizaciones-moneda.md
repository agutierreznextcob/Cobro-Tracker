---
name: Cotizaciones y moneda por documento
description: Moneda histórica inmutable, preferencias y límites de los medios de pago.
---

El usuario eligió moneda por documento, no un cambio global del símbolo. Las preferencias del negocio se usan para documentos nuevos; los históricos conservan su moneda y no hay conversión automática.
**Why:** cambiar el símbolo no convierte montos y puede producir cobros incorrectos.
**How to apply:** nunca sumar monedas diferentes ni aplicar la moneda preferida a documentos existentes. Los informes heredados agregan CLP explícitamente; los informes por moneda y el portal separan importes.

Los adaptadores actuales de Flow y MercadoPago cobran en CLP entero. Los documentos en otras monedas o con decimales se pagan manualmente hasta implementar soporte específico del proveedor.
**Why:** los adaptadores existentes redondean y fijan CLP; enviarlos directamente alteraría el importe.
**How to apply:** conservar validación de servidor además de ocultar las acciones incompatibles en la interfaz. Los cobros masivos y recurrentes siguen siendo CLP; no habilitar otros tipos de moneda sin actualizar también sus programaciones y entregas.

La aceptación/rechazo de una cotización se registra por el negocio tras la respuesta del cliente al correo; no hay aceptación pública automática.
**Why:** el alcance solicitado no define portal público ni autenticación para aceptar.
**How to apply:** no presentar el estado como firma electrónica. Convertir una sola vez bajo bloqueo de fila, conservar cotización e ítems originales y descontar stock solamente al cobrar.

Los Select de Radix dentro de formularios pueden emitir una cadena vacía al sincronizar un valor cargado de forma asíncrona.
**Why:** en la verificación de navegador el selector de moneda reemplazaba USD por una cadena vacía y rompía el formulario.
**How to apply:** validar los valores emitidos antes de guardarlos en estado; no aceptar la cadena vacía como una moneda o como cero decimales.
