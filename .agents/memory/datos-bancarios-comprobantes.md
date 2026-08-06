---
name: Datos bancarios + comprobantes de transferencia
description: Cobranza manual por transferencia — datos bancarios por usuario, upload público de comprobante desde el portal, confirmación transaccional
---

## Reglas
- Datos bancarios viven por usuario (PK userId); SOLO el número de cuenta se encripta (triplete AES-GCM, mismo patrón que credenciales Flow). Se incluyen en emails/WA únicamente para cobros manuales (sin flowLinkPago ni mpPaymentLinkUrl).
- El deudor sube el comprobante como data URL base64 (imagen/PDF, ≤1.5M chars) desde el portal público `/public/portal/:token/comprobante`; genera notificación tipo "comprobante" al responsable.
- Confirmar comprobante corre en UNA transacción: `SELECT ... FOR UPDATE` del cobro, exigir estado cobrable, claim del comprobante (pendiente→confirmado) y cobro→pagado con `pagadoEn coalesce`. Efectos secundarios (emitirComprobante) solo tras commit.
  **Why:** sin transacción, un fallo intermedio deja comprobante confirmado con cobro impago, o marca pagado un cobro cancelado.
- `express.json` global tiene `limit: "4mb"` porque comprobantes y avatares viajan en base64; el default de 100kb rompe el upload con 413 ANTES de llegar a la ruta. Cualquier nuevo payload base64 debe caber en ese límite.
- Rate limiting público: `app.set("trust proxy", 1)` + `req.ip` (nunca leer X-Forwarded-For a mano — falsificable); sin cupo global compartido (DOS barato); el POST de comprobantes suma un cupo por token que aísla el abuso a un portal.
- El badge de notificaciones del nav comparte la MISMA query key que `use-notificaciones-polling` (soloNoLeidas:true) para no duplicar polling.

## How to apply
Cualquier flujo nuevo de dinero manual (confirmaciones, uploads públicos) debe seguir este patrón: transacción con lock, claim atómico, límites por token/IP con req.ip, y validar tamaño vs límite JSON global.
