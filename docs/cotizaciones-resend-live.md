# Contrato de conciliación con Resend (opt-in, solo lectura)

Esta prueba llama al mismo `verificarEnvio` que la conciliación. Comprueba
`GET /emails/:id` (incluidos ID, fecha, destinatario, asunto, HTML, From,
Reply-To y last_event), `GET /emails/:id/attachments` (lista no paginada con un
único adjunto), nombre y tamaño del PDF, descarga HTTPS exclusivamente desde
`outbound-cdn.resend.com` y SHA-256. No acepta redirecciones. El token nunca se
envía al CDN. No inicia el servidor, consulta la base, confirma cotizaciones,
envía correos ni cambia datos. No se ejecuta automáticamente al desplegar.

## Preparar una vez un fixture interno

1. Usar un correo de prueba **ya existente**, enviado únicamente a un buzón
   interno controlado por el equipo, con datos sintéticos y un solo PDF.
   Nunca usar un correo de cliente. Si no existe, un operador debe preparar
   uno por separado mediante el flujo de prueba habitual; este script no
   contiene ni ejecuta una operación de envío.
2. Conservar el PDF original y sus parámetros de envío, **antes del envío**:
   fecha de preparación, `email` y `message` del archivo conservado por la
   aplicación. Para un reintento autorizado usar la fecha de autorización de
   ese intento como `preparedAt`. No reconstruir HTML con un render nuevo.
   Calcular `sha256sum prueba.pdf` y `wc -c < prueba.pdf` sobre esos bytes
   originales. No obtener el hash esperado del adjunto devuelto por Resend:
   eso haría circular la comprobación.
3. Añadir el ID del correo aceptado en el equipo correcto de Resend.
   Guardar un JSON local bajo `generated-artifacts/resend-contract/fixture.json`
   (directorio ignorado por Git y despliegue), con permisos `chmod 600`.
   No versionar el fixture, el PDF, direcciones reales ni HTML del buzón.
   El siguiente esquema ilustrativo **no es un fixture ejecutable**:

   ```text
   {
     "providerId": "<UUID del correo interno existente>",
     "preparedAt": "<fecha ISO con zona horaria>",
     "bytes": <tamaño exacto del PDF>,
     "sha256": "<64 caracteres hex minúsculos del PDF original>",
     "email": {
       "id": <id sintético>, "version": "<versión>", "numero": "<número>",
       "email": "<buzón interno>", "cliente": "<nombre sintético>",
       "total": <importe>, "moneda": "CLP", "decimales": 0,
       "vencimiento": "<vencimiento original>",
       "remitente": { "nombre": "<nombre>", "email": "<reply-to original>" }
     },
     "message": {
       "from": "<From original>", "to": ["<buzón interno>"],
       "subject": "<asunto original>", "html": "<HTML original>",
       "replyTo": "<Reply-To original; omitir si no existía>"
     }
   }
   ```

   `numero` determina el nombre esperado: caracteres fuera de `[A-Za-z0-9_-]`
   se sustituyen por `_`, seguido de `.pdf`. El fixture admite hasta 10 MiB.
   No incluir campos adicionales, credenciales ni URLs firmadas. Las URLs
   temporales sólo se usan en memoria; no se imprimen ni se guardan.
4. Configurar `RESEND_API_KEY` mediante Secrets, nunca en argumentos,
   archivos o historial de shell. Debe pertenecer al mismo equipo y tener
   permisos de lectura de correos enviados y adjuntos. Una clave limitada
   a envío no es suficiente; verificar los permisos vigentes en Resend.

## Ejecutar

Desde la raíz del proyecto, sin activación explícita no hay llamadas de red:

```sh
pnpm --filter @workspace/api-server test:cotizacion-resend
pnpm --filter @workspace/api-server test:cotizacion-resend --live --fixture ../../generated-artifacts/resend-contract/fixture.json
pnpm --filter @workspace/api-server test:cotizacion-resend:offline
```

Las rutas relativas del fixture se resuelven desde `artifacts/api-server`.
Éxito: código 0 y `PASS`. Sin opt-in: código 0 y `SKIP`, **no** prueba
compatibilidad. Configuración inválida, diferencias o errores: código 1 y
`FAIL` con etapa y estado HTTP cuando está disponible, sin respuesta cruda.

401/403: revisar clave, equipo y permisos. 404: revisar ID, equipo y retención;
**nunca significa rechazo ni autoriza un reenvío**. 429: esperar y repetir
manualmente; no hay reintentos automáticos. Errores de formato, dominio, hash,
retención, red o descarga deben investigarse antes de confiar en conciliación.
No relajar validaciones ni reemplazar el hash esperado para lograr un PASS.
Un rebote no invalida que Resend aceptó el correo; PASS no prueba entrega.

Ejecutar manualmente tras cambios del proveedor o de la conciliación. Cuando
el fixture deje de estar disponible por retención, reemplazarlo por otro
correo interno con evidencia original conservada, sin inferir nada sobre
cotizaciones reales. Eliminar los archivos locales cuando ya no se necesiten.
