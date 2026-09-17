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
