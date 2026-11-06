# Comprobación opt-in del archivo privado de cotizaciones

Sin `--live` el comando no importa servicios ni usa red:

```sh
pnpm --filter @workspace/api-server run test:cotizacion-storage
pnpm --filter @workspace/api-server run test:cotizacion-storage --live
```

Requiere App Storage ya configurado (`PRIVATE_OBJECT_DIR`,
`PUBLIC_OBJECT_SEARCH_PATHS`) y credenciales del sidecar.
Por defecto monta la aplicación Express real en un puerto local efímero,
sin ejecutar el arranque, semillas ni tareas automáticas; puede indicarse
`COTIZACION_STORAGE_TEST_BASE_URL` como origen HTTP(S) de una API de pruebas.
No se deben introducir credenciales en esa URL. No es parte del arranque,
despliegue ni suite habitual: realiza escrituras y lecturas reales.

El script usa el escritor y lector reales de `cotizacion-archivo.ts`. Guarda
un PDF sintético bajo un subdirectorio privado aleatorio por ejecución,
comprueba metadatos, rechazo 412 de sobrescritura con `ifGenerationMatch: 0`,
generación inalterada, bytes e integridad, y rechazo de otro responsable.
Un segundo proceso Node carga únicamente el descriptor serializado por stdin
y vuelve a leer desde App Storage, sin memoria del proceso escritor.
No se llama a Resend ni se consulta la base: se retiran las credenciales de
correo y se reemplaza la conexión DB por un destino local inhabilitado.

También comprueba respuestas 401/403/404 sin cookies ni autorización para
las rutas de objetos, rutas públicas (incluido intento de salir del prefijo)
y URL directa del bucket. Un 5xx, redirección, error de red o respuesta 200
no cuenta como prueba de privacidad. Actualmente la aplicación no monta
rutas genéricas de almacenamiento: un 404 es el resultado esperado.
No sustituye las pruebas de autorización de descarga de una cotización.

La limpieza en `finally` lista exclusivamente el prefijo aleatorio creado
para esta ejecución. Antes de borrar exige ruta de cotización, propietario
sintético, ID y generación; el borrado es condicional a esa generación.
Un fallo de limpieza hace fallar el comando. Nunca recorre ni borra el
directorio de cotizaciones de usuarios. Si el proceso termina abruptamente
(SIGKILL, caída del entorno), puede quedar un objeto sintético: el UUID de
ejecución impreso permite localizarlo dentro de
`integration-tests/cotizacion-pdf/`. Revisar ese prefijo concreto manualmente;
no ejecutar un borrado global ni reutilizar un UUID de otra ejecución.

Un fallo indica la fase, sin imprimir errores del SDK que puedan incluir
rutas privadas o URLs de autenticación. Revisar permisos/configuración y
disponibilidad del sidecar o API según esa fase, y repetir el comando.
