---
name: Acceso consultor de soporte
description: Impersonación auditada de cuentas de clientes por consultores NextCob (Ley 21.719)
---

# Acceso consultor (impersonación de soporte)

Las operaciones de plataforma deben rechazar explícitamente sesiones con impersonación, aunque la cuenta visitada tenga rol admin.
**Why:** el usuario autenticado durante impersonación es la cuenta visitada; comprobar únicamente su rol concede al consultor los privilegios de esa cuenta y atribuye acciones al actor equivocado.
**How to apply:** denegar la sesión de consultor antes de consultar o modificar datos globales, y probar con una cuenta visitada administradora, no sólo con clientes normales.

- Login público `POST /api/consultor/login` (página `/consultor`, link discreto en /login): accountId NCB + contraseña compartida por consultor (tabla `consultores`, hash bcrypt, tipo `admin` reservado → 403). Crea sesión cuyo `user` ES el cliente + metadata en `SessionData.consultor` → `req.consultor` (TTL 8h).
- **Regla de seguridad clave**: el deny-list de rutas sensibles (change/forgot/reset-password, flow/mp-credentials, datos-bancarios, cuenta, exportar-datos) vive en `consultorGuard` y DEBE comparar sobre el path **canonicalizado** (decodeURIComponent + lowercase + colapsar `//` + sin trailing slash) con límite de segmento `(\/|$)`. Express rutea case-insensitive y decodifica %-encoding: un regex sobre el path crudo es bypasseable (`/Flow-Credentials`, `%2D`).
- **Why:** review de arquitecto encontró bypass real por variantes de mayúsculas/encoding; cualquier nueva ruta sensible debe agregarse a esa lista.
- Auditoría: middleware registra en `consultor_acciones` toda mutación exitosa + GETs `/(cobros|clientes|liquidaciones)/:id(/…)` (incl. subrecursos). Sesión en `consultor_sesiones`; `finEn` se fija en logout consultor, en `/auth/logout` genérico, y por barrido `cerrarSesionesExpiradas()` (inicio+8h) llamado en login y listados — nunca asumir que finEn siempre se setea online.
- Cliente ve accesos en Perfil→Privacidad (`GET /api/consultor/mis-accesos`); superadmin gestiona consultores y auditoría global (`/api/consultor/consultores|sesiones`, requireAdmin por ruta, contraseña generada mostrada UNA vez).
- Frontend: `user.esConsultor/consultorNombre/consultorInicioEn` en /auth/user → barra roja fija en layout + secciones sensibles del perfil ocultas (server igual bloquea con 403).
- Rate limit login: in-memory por `req.ip` (trust proxy), patrón aceptado single-instance como leads.
