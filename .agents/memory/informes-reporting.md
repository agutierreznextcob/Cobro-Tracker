---
name: Informes por área
description: Criterios de ventas, compras y stock; moneda, permisos y límites del historial.
---

Informes se divide en Ventas, Compras e Inventario. Ventas conserva Resumen, Cuentas por Cobrar, Ranking de clientes, Gestiones, Satisfacción y Recurrentes; cada tab debe permitir Excel. Entrar al grupo sin elegir un hijo lleva a Ventas.
**Why:** estructura y conservación de funcionalidades pedidas expresamente por el usuario.
**How to apply:** conservar los enlaces antiguos a Informes mediante redirección; no reemplazar las seis vistas históricas con los nuevos rankings.

Los nuevos rankings comerciales usan cobros pagados por fecha de pago (creación solo si falta), con el alcance de cartera del actor. Los ingresos por producto distribuyen el monto efectivamente cobrado, después del descuento global e incluido el IVA aplicable, proporcionalmente al importe de sus líneas.
**Why:** sumar precios de catálogo o subtotales ignoraría descuentos/IVA y mezclaría períodos. Las líneas libres de una cotización no deben regalar ingresos a los productos asociados.
**How to apply:** mantener líneas sin producto en el denominador de reparto. El porcentaje usa todas las ventas pagadas, por lo que puede sumar menos de 100% si hay cobros sin catálogo. Separar monedas siempre. Abonos parciales siguen en los informes de recaudación existentes, no en unidades vendidas de estos rankings.

Compras muestra importes originales de facturas por emisión, incluyendo borradores. «Cuentas por pagar» significa estado distinto de contabilizada, no un saldo conciliado con pagos.
**Why:** el usuario definió expresamente ese criterio y no existe un registro de pagos a proveedores en este alcance.
**How to apply:** aclararlo en pantalla/Excel; no inventar pagos ni restar devoluciones físicas del importe documentado. Comparar el mes actual hasta hoy con iguales días del mes anterior; sin base anterior, mostrar variación no disponible.

Inventario cuenta salidas vinculadas a cobros, excluyendo traslados y salidas manuales del ranking. Rotación usa stock disponible medio al cierre diario; saldos negativos cuentan como cero para ese promedio, pero conservan su valor negativo en la valorización.
**Why:** un traslado no es una venta y una falta de stock no es disponibilidad negativa. La valorización debe reflejar el saldo real, incluso de artículos archivados.
**How to apply:** reconstruir el saldo desde movimientos y stock actual en una lectura consistente. Quiebre = cruce observado de positivo a cero/negativo; no inventar quiebres anteriores al historial. La frecuencia cuenta inicios en el período. El mínimo sugerido cubre un día de ventas promedio, no un plazo de reposición supuesto. Ingresos asociados respetan acceso a cobros aunque existencias sean compartidas por organización.
