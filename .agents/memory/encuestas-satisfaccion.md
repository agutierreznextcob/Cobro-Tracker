---
name: Encuestas de satisfacción post-pago
description: Diseño del envío diferido (+1h) y respuesta un-clic de la encuesta post-pago; reglas para no romper idempotencia ni integridad.
---

- Al pagar, `crearYEnviarEncuesta` SOLO crea la fila (única por cobroId) con `enviarEn = pago + 1h`; el email lo envía el barrido `procesarEncuestasPendientes` (scheduler cada 5 min + al boot).
- Idempotencia de envío: patrón claim-TTL igual al comprobante (`emailEnviadoEn` solo en éxito, `emailIntentoEn` claim 5 min). `emailIntentos` cuenta fallos: tope 5 reintentos; 999 = terminal (cobro ya no pagado / sin email destino). Sin este tope, un destino inválido reintenta cada 5 min para siempre.
- **Un-clic sin mutación en GET**: los botones del email van a `GET /api/encuestas/:token/responder?calificacion=N`, que SOLO redirige a `/encuesta/:token?calificacion=N`; la página pública auto-registra vía POST en el browser. **Why:** los escáneres/prefetch de email siguen links GET y registrarían respuestas fantasma. No convertir nunca ese GET en mutación.
- Respuesta única atómica: todo UPDATE de calificación lleva `WHERE calificacion IS NULL` (clics/POSTs concurrentes no sobrescriben).
- Stats "enviadas" = filas con emailEnviadoEn o respondidoEn (no cuenta programadas pendientes).
- Pruebas de email en dev: Resend rechaza dominios de ejemplo (422); usar `delivered@resend.dev`.
