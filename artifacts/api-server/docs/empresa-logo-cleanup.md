# Limpieza de logos

Comando de mantenimiento, desactivado por defecto. No hay borrado al iniciar
el servidor ni barrido general del bucket. No requiere cambios de esquema.

## Antes de ejecutar

1. Desplegar el protocolo de bloqueo de logos de esta versión en **todos**
   los servidores que escriben en las bases involucradas. No ejecutar durante
   un despliegue mixto, restauración de backup o importación directa de datos.
2. Inventariar todas las bases (producción, desarrollo, forks y copias) que
   puedan referenciar este directorio privado. Configurar las conexiones como
   secretos del proceso de mantenimiento, nunca en argumentos o archivos Git.
3. Configurar `LOGO_CLEANUP_DATABASE_ENVS` como array JSON de nombres de esos
   secretos, por ejemplo `["DATABASE_URL","LOGO_PRODUCTION_DATABASE_URL"]`.
   Una sola base es válida **únicamente** si se verificó que no comparte archivos
   con ninguna otra. No inferirlo a partir de NODE_ENV.
4. El `PRIVATE_OBJECT_DIR` del proceso debe ser el directorio que se desea
   limpiar. Incluir todas las bases que lo usan; conexiones extra conservan
   archivos de más, nunca autorizan a borrar referencias de otra base.
5. Si no se pueden enumerar o conectar todas las bases, **no ejecutar**.
   No usar inventarios exportados: estarían desactualizados frente a escrituras.

Desde la raíz:

```
pnpm --filter @workspace/api-server exec tsx scripts/cleanup-empresa-logos.ts --confirm-all-databases --confirm-coordinated-writers
```

Esto simula sin modificar objetos ni registros. Revisar el informe y repetir con
`--apply` para eliminar. Las confirmaciones certifican el inventario completo y
la versión de los escritores; no son detección automática de otros entornos.
No se ha ejecutado el modo destructivo como parte de la implementación.

## Garantías y límites

- Máximo 50 candidatos por ejecución (motor: máximo 100), hasta 10 bases.
- Siete días de gracia desde carga/reutilización/retiro, más 15 minutos de
  expiración de la URL para temporales. Un objeto modificado recientemente
  recibe otros siete días antes de poder borrarse.
- Solo rutas exactas de logos registradas en `empresa_uploads`. No lista
  objetos del bucket, no toca PDFs ni archivos de otros módulos. Logos
  normalizados históricos sin registro se conservan deliberadamente.
- Verifica referencias vigentes en todas las bases bajo el mismo bloqueo
  asesor que usan carga y guardado. Los escritores fijan una sola conexión
  y mantienen el bloqueo de sesión entre el registro durable y el guardado
  transaccional del perfil; la limpieza usa bloqueos transaccionales.
  Una carga concurrente espera o
  hace que el mantenimiento aborte sin borrar.
- El borrado exige la generación observada en storage. Un cambio concurrente
  aborta; errores de permisos/red no se interpretan como archivo inexistente.
- Un 404 es éxito idempotente; se puede reintentar tras fallo parcial. El
  registro se quita solo después del borrado, no antes.
- Cada ejecución avanza un cursor persistente en
  `generated-artifacts/logo-cleanup/` (fuera de Git y de la publicación).
  El cursor usa orden de ruta estable y avanza incluso sobre candidatos
  protegidos. Un lote vacío reinicia el recorrido para revisar objetos nuevos
  o que recién cumplen la gracia. Repetir el comando procesa el siguiente lote.
  Simulación y borrado tienen cursores separados; cambiar el inventario o
  directorio de storage inicia otro recorrido. Un error no avanza el cursor.
  Conservar este directorio en el equipo de mantenimiento para mantener el
  progreso entre ejecuciones; eliminar sus JSON reinicia los recorridos sin
  afectar ninguna protección de borrado.
- Mientras corre un lote, las ediciones de perfil/logo pueden esperar.
  Ejecutar fuera de horas punta; no programar borrados sin revisar antes
  el inventario de entornos.
