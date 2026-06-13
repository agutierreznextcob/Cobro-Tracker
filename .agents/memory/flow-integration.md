---
name: Flow payment integration
description: Cómo están diseñadas las credenciales Flow por usuario y la integración con la API de Flow
---

# Integración con Flow

## Credenciales por usuario
- Tabla `flow_credenciales` (userId PK) con campos `*_encrypted`, `*_iv`, `*_auth_tag` para apiKey y secretKey
- Encriptación AES-256-GCM, clave en env var `ENCRYPTION_KEY` (64-char hex = 32 bytes)
- Lib en `artifacts/api-server/src/lib/encrypt.ts`
- Rutas en `artifacts/api-server/src/routes/profile.ts` (GET/PUT/DELETE `/api/profile/flow-credentials`)
- El GET sólo devuelve `{ configurado: boolean }` — nunca expone las claves

## Flow API
- Lib en `artifacts/api-server/src/lib/flow-api.ts`
- Firma HMAC-SHA256 de params ordenados alfabéticamente (estándar Flow)
- Endpoint de creación: `POST /payment/create` (form-encoded)
- La `commerceOrder` se forma como `cobro-{id}` para poder parsearlo en el webhook

## Webhook de Flow
- Ruta pública `POST /api/webhooks/flow` en `webhooks.ts`
- Flow envía `token` + `commerceOrder` + `status` (2=pagado, 3=fallido, 4=cancelado)
- Actualiza el cobro automáticamente y loguea en webhook_eventos

## Columnas agregadas a cobros
- `email_pagador`, `flow_orden_id`, `flow_link_pago`
- Al generar el link (POST `/api/cobros/:id/flow-link`), si ya existe `flowLinkPago` lo devuelve directamente sin llamar a Flow otra vez

## Zod en api-server
- api-server usa `zod` v3 (no `zod/v4`) — importar como `import { z } from "zod"`

**Why:** Zod v4 no está instalado directamente en api-server; el workspace usa `catalog:` que resuelve a zod v3.
