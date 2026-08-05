---
name: Superadmin = libro de ingresos
description: El módulo Cobros del superadmin muestra pagos de suscripción de la plataforma, no cobros propios.
---
- Regla: la cuenta superadmin NUNCA lleva cobros/clientes propios. El seed los borra idempotentemente en cada arranque (cleanup en seed.ts); el frontend reemplaza la lista de cobros por el registro de suscripciones cuando `user.role === 'admin'`.
- Tabla `pagos_suscripcion`: una fila por usuario+período, con UNIQUE (user_id, periodo_hasta) + insert onConflictDoNothing — cualquier ruta futura (Fintoc) que registre cargos DEBE mantener esa idempotencia a nivel de BD.
- **Why:** webhooks de pago se reintentan/llegan en paralelo; select-then-insert duplicaba ingresos. El registro es libro contable de NextCob SpA (montos CLP enteros, neto+IVA 19% desglosado, snapshot de usuarios extra al momento del cargo).
- **How to apply:** al integrar Fintoc, insertar en pagos_suscripcion (estado pagado/pendiente/fallido, metodo 'fintoc') respetando el unique; el endpoint admin /admin/pagos-suscripcion ya sirve la vista y el Excel se genera client-side (xlsx).
