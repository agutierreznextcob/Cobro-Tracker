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

## Prueba opt-in contra almacenamiento real

Desde la raíz:

```sh
# Omite la prueba sin conectar a SQL ni storage:
pnpm --filter @workspace/api-server run test:logo-cleanup-storage
# Ejecuta contra GCS y PostgreSQL configurados:
pnpm --filter @workspace/api-server run test:logo-cleanup-storage --live
```

Requiere `DATABASE_URL` con permiso de crear/eliminar un esquema de prueba,
`PRIVATE_OBJECT_DIR` y las credenciales habituales de App Storage. No acepta
emuladores. No configurar nuevas credenciales en la línea de comandos.

Cada ejecución usa un esquema SQL aleatorio con tablas mínimas y un directorio
privado `integration-tests/logo-cleanup/<UUID>`. No consulta tablas de negocio,
no enumera el bucket, no inicia la aplicación, no manda correos y no toca PDFs.
El CLI se ejecuta como proceso separado con ese directorio y un `search_path`
exclusivo del esquema sintético, **sin fallback a public**.

Comprueba metadatos/generación reales, simulación sin cambios en bytes,
generación o registros, rechazo 412 tras sobrescritura y conservación del
registro al fallar. Comprueba acceso denegado mediante un cliente GCS anónimo
(401 o 403, nunca 404), tanto al inspeccionar como al borrar, sin alterar IAM.
Verifica borrado, desaparición entre inspección y borrado, 404 idempotente y
reintento. El motor recibe un reloj futuro únicamente en la prueba para evaluar
objetos recién creados sin esperar siete días; el CLI conserva su reloj real y
debe proteger esos objetos, aunque sí elimina registros sintéticos ausentes.

El bloque de salida elimina únicamente rutas conocidas de esa ejecución, tras
verificar su etiqueta de propietario y generación; elimina también su esquema
y cursores. Un fallo de limpieza hace fallar la prueba. Si el proceso se mata
abruptamente, usar el UUID impreso para localizar los residuos sintéticos;
no ejecutar el mantenimiento sobre el directorio real para limpiarlos.
