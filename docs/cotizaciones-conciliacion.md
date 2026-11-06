# Conciliar un envío de cotización

Disponible en **Administración → Conciliación de envíos de cotizaciones**, únicamente
para administradores de plataforma (no administradores del negocio ni consultores
impersonando clientes).

## Límites y evidencia

Un PDF guardado no prueba aceptación. Un HTTP 404, búsqueda vacía, error de red,
timeout, 5xx, rebote o que el destinatario no vea el correo tampoco prueba rechazo.
La clave normal permite reintentos durante 23 horas. La conciliación se habilita
después de 24 horas y una hora desde el último envío en curso.

### Confirmar aceptación

1. Buscar en el equipo correcto de Resend el envío original mediante sus logs,
   destinatario, fecha y clave de idempotencia que muestra el panel.
2. Copiar el ID del correo, ingresar un motivo y pulsar **Verificar en Resend**.
3. El servidor consulta `GET /emails/:id` y `GET /emails/:id/attachments`;
   compara destinatario, asunto, HTML, fecha y, para los nuevos archivos que
   conservan encabezados, From/Reply-To. Descarga el adjunto desde el CDN HTTPS
   del proveedor y verifica tamaño, nombre y SHA-256 contra el PDF conservado.
4. **Verificar y confirmar envío** repite la verificación (no confía en la
   consulta previa) y registra la fecha de aceptación del proveedor. No envía
   ningún correo ni regenera el adjunto.

«Confirmado» significa aceptado por Resend, no entregado. Un rebote pertenece a
un correo aceptado y no autoriza duplicarlo. Si los logs o adjuntos ya no están
disponibles, se mantiene el bloqueo: no se inventa un éxito.

### Autorizar otro intento

Esta rama es una **verificación humana auditada**, no una prueba automática de
ausencia. La API de consulta de un correo no ofrece por sí sola tal prueba.

1. Abrir un caso con soporte de Resend, identificando equipo, destinatario,
   período, mensaje y **clave exacta**. Solicitar confirmación explícita de que
   **ningún intento** con esa clave fue aceptado, no sólo que un intento falló.
2. Comprobar la autenticidad de la respuesta en el caso original del proveedor.
   Si soporte no puede confirmar lo anterior (por retención, registros
   incompletos, solicitud aún en proceso, etc.), **NO autorizar**.
3. Registrar referencia del caso, respuesta escrita incluyendo la clave, motivo
   y declaración de verificación. No copiar credenciales ni URLs firmadas.
4. Se guarda todo junto con usuario y fecha, y se crea una nueva clave de
   idempotencia. No se cambia el PDF, su huella, los datos originales del
   mensaje, la fecha de preparación ni el estado a «enviada».
5. El responsable puede volver a usar **Enviar** durante las siguientes 23
   horas. Si vuelve a quedar ambiguo y expira esa ventana, se requiere otra
   conciliación referida a la nueva clave.

Una consulta positiva ya registrada impide autorizar otro intento para esa
clave. La rotación se hace bajo bloqueo de fila: dos operadores no pueden
autorizar dos claves. Los envíos toman el mismo bloqueo durante el contacto con
el proveedor, con timeout de 30 segundos; una lectura tardía del archivo no
puede usar una clave que soporte ya sustituyó.

El historial sigue visible después de confirmar. Los archivos antiguos sin
encabezados completos se comprueban contra sus parámetros conservados y el
PDF, sin crear un adjunto nuevo. Un cambio incompatible en el render de correo
puede impedir su conciliación automática: mantener el bloqueo en ese caso.

## Verificación local

`pnpm --filter @workspace/api-server exec tsx scripts/test-cotizaciones.ts`

Usa una base aislada por schema y transportes simulados: no contacta Resend ni
escribe archivos reales. Cubre permisos, evidencia insuficiente, claves
obsoletas, autorizaciones concurrentes, preservación del mensaje/PDF,
coincidencia del proveedor, rebotes, confirmación concurrente y auditoría.

Referencias del proveedor:
- https://resend.com/docs/api-reference/emails/retrieve-email
- https://resend.com/docs/api-reference/emails/list-email-attachments
- https://resend.com/docs/dashboard/logs/introduction
- https://resend.com/docs/dashboard/emails/idempotency-keys
