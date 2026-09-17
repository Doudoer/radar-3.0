<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Radar 3.0

Aplicación Radar 3.0 con frontend Vite y API Node/MySQL.

## Run Locally

**Prerequisites:** Node.js and a MySQL/MariaDB database.


1. Install dependencies:
   `npm install`
2. Start the local API in one terminal:
   `npm run api`
3. Start the frontend in another terminal:
   `npm run dev`

Open `http://localhost:3000`. The dashboard reads from `radar_v3`; frontend and API share the same local origin.

The API uses `PORT`, `API_PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, and `CORS_ORIGIN`. The frontend uses `/api` when served behind the same origin.

## Production containers

- `Dockerfile`: build y runtime único para frontend + API en el puerto `3000`.
- `VITE_API_URL` usa `/api` por defecto porque frontend y API comparten origen.

Authentication is provided by the API with bcrypt password verification and short-lived JWT sessions. Set a strong `JWT_SECRET` in the API environment before deployment. User roles come from the `users.role` column; the UI no longer allows changing roles locally.

The production container runs as a non-root user, enforces JSON request limits, validates content types, sends security headers, and exposes `/health` for Dokploy health checks. Production traffic must use HTTPS through Traefik.

## Estructura modular

- `src/server/config.ts`: puertos, CORS, pool MySQL y configuración de runtime.
- `src/server/auth.ts`: JWT, cookies HttpOnly, rate limit, roles y revocación por actualización de usuario.
- `src/server/schemas.ts`: validación Zod de payloads.
- `src/server/http.ts`: parsing JSON, respuestas HTTP y serving de la SPA.
- `src/server/orders.ts`: consulta, normalización y persistencia auxiliar de órdenes.
- `src/server/claims.ts`: consulta y normalización de reclamos.
- `src/server/analytics.ts`: consultas de indicadores y ventas diarias.
- `src/server/notifications/`: eventos, canales y configuración futura de notificaciones/Wasender.
- `src/hooks/useAuthSession.ts`: sesión y logout del frontend.
- `src/hooks/useRadarData.ts`: carga y estado de órdenes, clientes y actividades.
- `src/hooks/useOrderActions.ts`: creación, actualización, transiciones y reclamos de órdenes.
- `src/services/`: acceso HTTP del frontend.
- `src/components/`: vistas y módulos visuales del dominio.
- `src/server/files/`: almacenamiento seguro futuro de archivos e imágenes simples/múltiples.
- `src/integrations/wasender/`: cliente Wasender desacoplado y configurable.

`server.ts` conserva el router y coordina los casos de uso; las responsabilidades transversales viven en `src/server/`.

## Integraciones preparadas

El almacenamiento de archivos se puede consumir con `saveUpload()` y `saveUploads()` desde `src/server/files`. Genera nombres UUID, limita MIME/tamaño y evita rutas controladas por el usuario.

Wasender se consume mediante `wasender.sendText()`, `wasender.sendImage()` y `wasender.sendFile()` desde `src/integrations/wasender`. No realiza llamadas hasta configurar sus variables en Dokploy.

Las notificaciones futuras se gestionan mediante `notificationService`. Admite eventos de alertas, estados, órdenes, reclamos, entregas, facturas, seguridad y sistema. `in_app` está disponible como canal local; el canal Wasender requiere `NOTIFICATIONS_WASENDER_ENABLED=true`, credenciales Wasender y destinatarios configurados. Los eventos se pueden ajustar individualmente mediante `NOTIFICATIONS_EVENT_CONFIG` o variables `NOTIFICATIONS_<EVENT>_ENABLED` y `NOTIFICATIONS_<EVENT>_RECIPIENTS`.
