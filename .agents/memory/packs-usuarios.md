---
name: Packs de usuarios adicionales
description: Modelo de packs (individual/5/10/20) que reemplaza el per-seat automático; cupo, billing, grandfathering.
---

# Packs de usuarios adicionales

- Los packs REEMPLAZAN el cobro per-seat automático: `totalMensual = plan base + costo packs` (ya no depende del conteo de miembros). Cupo de asientos = `usuariosIncluidos del plan + cupoDePacks`.
- Definición canónica en `plans.ts` (PACKS_USUARIOS, normalizarPacks, cupoDePacks, costoDePacks). Se guardan como jsonb `users.packs_usuarios` en la fila del **OWNER** de la org; los miembros ven cupo/desglose del owner (subscription status resuelve owner vía organizationId).
- Precios: individual $9.990 neto, pack5 $39.990 (−20%), pack10 $69.990 (−30%, "más popular"), pack20 $119.990 (−40%). IVA 19% aparte. El frontend tiene un ESPEJO hardcodeado de estos precios (`packs-usuarios.tsx` y la landing) — cambiar precios exige tocar backend + ambos espejos.
- POST /subscription/packs: owner-only, tx FOR UPDATE; quitar valida que miembros activos no excedan el nuevo cupo; con suscripción activa hace push a Reveniu dentro del lock (falla ⇒ rollback). Starter no admite packs (403 plan_upgrade); bajar a Starter borra los packs.
- Invitar sin cupo ⇒ 403 `code:"sin_cupo"` (cuenta también invitaciones pendientes no expiradas vía `orgPuedeActivarMiembro(..., {contarPendientes:true})`); el frontend abre un diálogo de packs.

**GRANDFATHERING per-seat (crítico):** clientes antiguos con cobro per-seat conservan su `reveniuMontoSync`. El barrido `sincronizarMontosReveniu` NUNCA pisa un `reveniuMontoSync` no-NULL que difiera del modelo (solo warn); solo repara filas NULL. El libro de ingresos (webhooks) usa `reveniuMontoSync` como monto autoritativo (neto = total/1.19) y el modelo plan+packs solo como fallback.

**Why:** recomputar desde el modelo nuevo en el sweep les bajaría el cobro a los clientes per-seat sin su consentimiento (hallazgo de code review).

**Limitación conocida:** aceptar invitación / reactivar miembro no comparten lock con /subscription/packs; una carrera podría sobre-ocupar un asiento (ventana pequeña, aceptada).
