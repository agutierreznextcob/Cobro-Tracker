---
name: Indicadores económicos y equivalencias
description: Fuente externa, horario chileno y carácter informativo del cambio a CLP.
---

El usuario pide mindicador.cl como fuente de UF, dólar observado, euro, UTM e IVP, con actualización diaria a las 9:00 en America/Santiago, lectura desde la base de datos y actualización manual.
**Why:** evitar depender de disponibilidad externa en cada visita.
**How to apply:** ante fallas conservar el último dato y mostrar su fecha; nunca inventar valores. La sincronización puede recuperar una ejecución pendiente al arrancar después de las 9:00.

Las equivalencias de cobros/cotizaciones/PDF son informativas al valor disponible, sin convertir la deuda ni habilitar enlaces CLP para una deuda en otra moneda.
**Why:** conserva la decisión previa del usuario de moneda por documento y evita cobrar otra cantidad sin consentimiento.
**How to apply:** mostrar tasa y fecha de observación junto al equivalente. Para variación diaria, comparar contra el valor efectivo de ayer; UTM mensual y días sin publicación mantienen el valor, no confundir variación mensual con diaria.
