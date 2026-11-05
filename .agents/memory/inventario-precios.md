---
name: IVA, PVP e historial de costos
description: Base neta de costos y márgenes, precios finales y sincronización automática desde compras.
---

Los costos de factura son netos; no descontarles IVA otra vez. El margen y la utilidad se comparan siempre sobre precio de venta neto, incluido el PVP que normalmente viene con IVA.
**Why:** el usuario pidió comparar correctamente un costo neto con precios al público y configurar «Con IVA» como interpretación predeterminada del PVP.
**How to apply:** separar neto, IVA y precio final; la tasa viene inicialmente de Preferencias y es editable. Usar redondeo configurado: con cero decimales 750 + IVA 19% = 750 + 143 = 893, no truncar a 892.

Guardar o aceptar el precio calculado/PVP guarda el precio final; recibir una compra solo cambia costo y sugerido, no el precio de venta vigente. Los documentos existentes conservan sus ítems; al agregar productos con precio IVA-incluido a cobros/cotizaciones usar su neto para no aplicar IVA dos veces.
**Why:** el usuario quiere revisar el precio final antes de adoptarlo y no alterar ventas o documentos emitidos por una variación del costo.
**How to apply:** preservar los precios guardados al abrir el editor. Cualquier nuevo consumidor del catálogo debe distinguir precio público y neto.

Todo cambio de costo desde ahora conserva fecha, anterior/nuevo, moneda y origen manual o factura. No inventar historial anterior a la implementación.
**Why:** el usuario pidió trazabilidad del costo y actualización desde Compras.
**How to apply:** el historial debe escribirse en la misma transacción que el costo; preservar importes de la factura y su precisión, aun si luego cambia la preferencia de decimales.
