---
name: Scoring predictivo de clientes
description: Capa predictiva sobre el score descriptivo — probabilidad de pago 7d, fecha estimada, promesas incumplidas, recomendación IA.
---

# Scoring predictivo

Todo se calcula on-the-fly en `computeClienteScores` (mismo módulo que el score 0-100), sin columnas persistidas.

- **probabilidadPago (0-100, 7 días)**: 40% tasa de pago histórica, 25% peor mora actual (45d→0), 20% promesas cumplidas/incumplidas (neutral 60 sin promesas), 15% saldo pendiente vs mayor cobro pagado. Clamp 3–97. `null` si no hay cobros abiertos.
- **Modelo de promesas** (regla de producto): gestión con resultado `contactado_pagara|acordo_fecha_pago|acordo_pago_parcial` (últimos 6 meses); deadline = `proximaGestionEn` ?? creadoEn+7d, +1 día de gracia. Se evalúa contra el pago confirmado del cobro (último abono confirmado, o `pagadoEn` si pagado sin abonos): cumplida = pago post-promesa dentro del plazo; incumplida = fallido, o plazo vencido sin pago (incluye pagado tarde); abierta = no cuenta. **Ojo**: `proximaGestionEn` NO es una fecha de compromiso persistida — si algún día se agrega un campo de compromiso real, migrar aquí.
- **fechaEstimadaPago** = vencimiento abierto más próximo (u hoy si ya venció) + promedioDiasAtraso redondeado.
- **recomendacion** {titulo, detalle}: fija por categoría (textos de spec) + coletilla si hay promesas incumplidas. Rule-based, NO usa LLM.
- Superficies: `GET /clientes` (probabilidadPago), `GET /clientes/:id` scoreDetalle (todos los campos), salud-cartera acciones (probabilidadPago → "Prob. pago: X%" en razonDe), Informes card "Probabilidad de recuperación" = suma cliente-side de saldos abiertos ponderados por prob del cliente (fallback 50%).

**Why:** el review de arquitecto rechazó contar como cumplida cualquier promesa en cobro hoy `pagado` sin mirar cuándo se pagó; el modelo actual evalúa timestamps.
**How to apply:** cualquier cambio a estados de cobro/gestiones o al enum resultado debe revisar `RESULTADOS_PROMESA` y este modelo.
