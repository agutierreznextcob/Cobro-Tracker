---
name: Colisiones de parámetros en Orval
description: Colisión del tipo de query con el validador de parámetros de ruta.
---

En la configuración actual de Orval, un endpoint con parámetros de ruta y de query puede generar un tipo TS y un validador Zod con el mismo nombre `<Operation>Params`, causando TS2308 en el barrel de api-zod.
**Why:** apareció al generar el endpoint de informes por área con filtros; Orval terminaba, pero el build de bibliotecas fallaba por el export duplicado.
**How to apply:** revisar ambos archivos generados antes de culpar a los consumidores. Para informes se eligió una colección `/informes` con `area` y filtros en query. No corregir los archivos generados a mano; ajustar contrato o configuración del generador según el caso.
