---
name: Flujo de invitaciones de equipo
description: Aceptación de invitaciones vía /invitacion/:token, elegibilidad de cambio de org, y gating de cupos en UI
---

- Email de invitación enlaza a `/invitacion/:token` (página pública en cobros-app). NUNCA a rutas OIDC muertas (`/api/login`).
- Rutas públicas `GET /invitaciones/:token` (devuelve `emailRegistrado`) y `POST /invitaciones/:token/aceptar` (auth inline 401) viven en organizationRouter, que se monta ANTES de cobrosRouter (blanket auth) — sus rutas privadas siguen prefix-guarded bajo /organization.
- Aceptar con cuenta existente: solo elegible si el usuario es dueño de su solo-org y único miembro activo (`usuarioPuedeCambiarDeOrgTx`); misma regla al crear la invitación (si no, 400 yaEnOrg). La vieja solo-org queda con sus datos.
- Aceptación = transacción FOR UPDATE de la invitación + `orgPuedeActivarMiembroTx` (cupo revalidado al aceptar) + revalidación de supervisor. Errores: 404 inválida/consumida, 403 email_distinto/sin_cupo, 409 ya_en_org.
- Registro con invitación: `/register?invitacion=TOKEN&email=...` envía `invitacionToken` en el body; assignOrganization acepta EXACTAMENTE ese token (email debe coincidir), con fallback a cualquier pendiente del email. **Why:** con múltiples invitaciones pendientes, sin token el usuario podía caer en la org equivocada.
- `login.tsx` soporta `?returnTo=` con validación anti open-redirect: startsWith("/"), sin backslash, y `new URL(returnTo, origin).origin === origin`. No relajar a un regex simple (`/\host` y `//host` escapan).
- Gating UI (team-section): libres = cupoUsuarios − miembrosActivos − invitacionesPendientes; sin libres se oculta "Invitar" y se muestra CTA "Ver packs disponibles" (backend igual bloquea con 403 sin_cupo).
- Regresión: e2e-public-routes cubre GET /invitaciones/:token inválido → 404.
