---
name: Planes de suscripción (Starter/NextCob/Pro)
description: Estructura de planes, gating por feature, herencia del owner y reglas de cupo de usuarios
---

## Estructura
- Enum BD `plan_suscripcion` = starter|nextcob; columna `users.plan` NULLABLE. **NULL = grandfathered ⇒ tratar como nextcob**. Pro NO está en el enum: solo UI "Próximamente" + tabla `pro_waitlist` (email UNIQUE, insert onConflictDoNothing).
- Starter $14.990 neto/1 usuario/sin extras/sin features avanzadas. NextCob $24.990 neto/**2 usuarios incluidos**/extras pagados desde el 3.°/todas las features. Definición única en `api-server/src/lib/plans.ts` (PLANES, planEfectivo, planIncluye).
- Trial, admin plataforma y esDemo ⇒ planEfectivo nextcob SIEMPRE (nunca gatear estas cuentas).

## Reglas duras (no romper)
- **El plan lo fija el DUEÑO de la org** (quien paga): miembros heredan vía `getPlanEfectivoDeUsuario`/`getPlanEfectivoDeOrg` (middlewares/requirePlanFeature.ts). Los endpoints de billing (subscribe/cambiar-plan) son owner-only (403 para miembros).
- Gating server-side = `requirePlanFeature(feature)` → 403 `{code:"plan_upgrade", feature}`; el frontend usa ese code para el diálogo "Ver planes". Montar SIEMPRE tras auth, nunca en rutas públicas.
- Scoring predictivo en Starter: los endpoints devuelven campos null/0, no 403 (clientes, salud-cartera).
- Schedulers (recordatorios/workflows): entitlement por responsable del cobro; **si responsableId es null, decide el owner de la org del cobro** (no permitir por defecto — era un bypass).
- Cupo de usuarios: validar al ACEPTAR invitación y al REACTIVAR miembro (`orgPuedeActivarMiembro`), no solo al invitar — downgrade a Starter con invitación pendiente era bypass. Sin cupo al aceptar ⇒ invitación expirada + org solo.
- Cambio de plan: Reveniu es custom-amount ⇒ `setReveniuAmount` + update plan/reveniuMontoSync **dentro de una transacción con SELECT FOR UPDATE** del user (si Reveniu falla, rollback; evita carreras).
- Banner de trial en layout: ≤7 días normal, ≤2 urgente; pantalla fin de prueba = selector de 2 planes + Pro waitlist (`plan-selector.tsx`, reutilizado en perfil).

**Why:** el modelo de cobro es 1 suscripción por org pagada por el owner; cualquier check por-usuario sin herencia del owner abre bypass de features o de asientos.
