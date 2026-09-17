# Radar 3.0

Radar 3.0 es un ERP/CRM operativo para gestionar órdenes de refacciones automotrices, clientes, vehículos, inventario, entregas, reclamos y usuarios internos.

- Frontend: React 19 + Vite + TypeScript.
- API: Node.js + TypeScript + `mysql2/promise`.
- Base de datos: MySQL/MariaDB.
- Validación: Zod.
- Sesiones: JWT en cookie `HttpOnly`.
- Producción: contenedor único servido detrás de Dokploy/Traefik.

## Repositorio

Repositorio remoto del proyecto:

https://github.com/Doudoer/radar-3.0

Producción:

https://radar-rsy.store/

## Funcionalidades

- Dashboard operativo con KPIs, actividad y métricas SLA.
- Gestión de órdenes: creación, edición, estados, entregas, garantías y detalle operativo.
- Solicitud de estatus para yarda con rango de fechas, selección por estatus y PDF descargable.
- Directorio de clientes con relación de órdenes.
- Gestión de reclamos y garantías con restauración de estado de la orden.
- Operaciones y traspaso de órdenes.
- Relación semanal y módulo financiero protegido por 2FA.
- Dashboard operativo y actividad reciente.
- Configuración del sistema e integración futura de mensajería.
- Backup total SQL de la base de datos para administradores.
- Gestión de usuarios, roles, estado de cuenta y permisos.
- Loading global durante sesión, carga de datos y transición de vistas.
- Bloc de notas personal flotante, persistente por usuario y accesible sobre cualquier vista o modal.
- Mensajería interna rápida entre usuarios desde el mismo bloc personal.
- Layout visual compartido para las vistas principales.

## Requisitos

- Node.js 22 o superior.
- npm.
- MySQL 8+ o MariaDB compatible.
- Base de datos `radar_v3` creada y accesible.

## Desarrollo local

Instalar dependencias:

```bash
npm install
```

Crear un archivo `.env` a partir de `.env.example` y completar la conexión a MySQL/MariaDB.

Iniciar la API en el puerto `3001`:

```bash
PORT=3001 npm run api
```

En otra terminal, iniciar Vite en el puerto `3000` apuntando a la API:

```bash
VITE_API_URL=http://localhost:3001/api npm run dev -- --port 3000
```

Abrir:

http://localhost:3000

La separación de puertos es necesaria durante el desarrollo. En producción, frontend y API comparten el mismo origen y el frontend usa `/api`.

## Variables de entorno

Variables principales:

| Variable | Uso |
| --- | --- |
| `PORT` / `API_PORT` | Puerto HTTP de la API. |
| `DB_HOST` | Host de MySQL/MariaDB. |
| `DB_PORT` | Puerto de base de datos. |
| `DB_NAME` | Nombre de la base, normalmente `radar_v3`. |
| `DB_USER` | Usuario de aplicación. |
| `DB_PASSWORD` | Contraseña de aplicación. |
| `JWT_SECRET` | Secreto largo y aleatorio para las sesiones. |
| `CORS_ORIGIN` | Origen permitido del frontend. |
| `APP_URL` | URL pública de la aplicación. |
| `VITE_API_URL` | URL de API usada por Vite en desarrollo. |

Nunca guardar credenciales reales en Git. En Dokploy deben configurarse como variables o secretos del entorno de producción.

## Scripts

| Comando | Función |
| --- | --- |
| `npm run dev` | Servidor de desarrollo Vite. |
| `npm run api` | API Node mediante `tsx`. |
| `npm run lint` | Comprobación TypeScript con `tsc --noEmit`. |
| `npm run build` | Compilación del frontend en `dist/`. |
| `npm run build:api` | Bundle de API en `dist/server.js`. |
| `npm run preview` | Previsualización del build frontend. |
| `npm run clean` | Elimina artefactos locales de build. |

Validación recomendada antes de publicar:

```bash
npm run lint
npm run build
npm run build:api
npm audit --omit=dev
```

## API disponible

Todas las rutas `/api/*`, excepto login, requieren sesión válida. Las operaciones administrativas requieren rol `admin`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Healthcheck de API y base de datos. |
| `POST` | `/api/auth/login` | Inicia sesión. |
| `POST` | `/api/auth/logout` | Cierra sesión. |
| `GET` | `/api/auth/me` | Consulta la sesión actual. |
| `GET` | `/api/orders` | Lista órdenes. |
| `POST` | `/api/orders` | Crea una orden. |
| `PUT` | `/api/orders/:id` | Actualiza una orden. |
| `GET` | `/api/customers` | Lista clientes. |
| `GET` | `/api/claims` | Lista reclamos. |
| `POST` | `/api/claims` | Crea un reclamo. |
| `PUT` | `/api/claims/:id` | Actualiza un reclamo. |
| `GET` | `/api/activities` | Consulta actividad reciente. |
| `GET` | `/api/inventory` | Consulta inventario/logística. |
| `GET` | `/api/users` | Lista usuarios, solo administradores. |
| `PUT` | `/api/users/:id` | Edita cuenta, rol, estado y permisos. |
| `DELETE` | `/api/users/:id` | Baja lógica de otro usuario, solo administradores. |
| `GET` | `/api/system/backup` | Descarga backup SQL total, solo administradores. |
| `GET` | `/api/me/notes` | Lee el bloc personal del usuario autenticado. |
| `PUT` | `/api/me/notes` | Guarda el bloc personal del usuario autenticado. |
| `GET` | `/api/me/message-users` | Lista destinatarios activos para mensajería interna. |
| `GET` | `/api/me/messages` | Lista mensajes enviados y recibidos del usuario. |
| `POST` | `/api/me/messages` | Envía un mensaje interno a otro usuario activo. |

## Arquitectura

### Backend

- `server.ts`: router HTTP y coordinación de casos de uso.
- `src/server/config.ts`: puerto, CORS, pool y resolución del frontend compilado.
- `src/server/auth.ts`: JWT, cookies, rate limit, roles y revocación por `updated_at`.
- `src/server/schemas.ts`: esquemas Zod para payloads.
- `src/server/http.ts`: body JSON, respuestas y serving de la SPA.
- `src/server/orders.ts`: consulta y normalización de órdenes.
- `src/server/claims.ts`: consulta y normalización de reclamos.
- `src/server/backup.ts`: exportación SQL completa de estructura y datos.
- `src/server/files/`: almacenamiento seguro futuro de archivos e imágenes.

### Frontend

- `src/App.tsx`: composición de layout, navegación y modales.
- `src/components/`: vistas y componentes del dominio.
- `src/hooks/useAuthSession.ts`: sesión y logout.
- `src/hooks/useRadarData.ts`: carga inicial de órdenes, clientes y actividad.
- `src/hooks/useOrderActions.ts`: creación, edición, transiciones y reclamos.
- `src/hooks/useViewLoading.ts`: loading de cambio de vista.
- `src/components/LoadingOverlay.tsx`: loading global.
- `src/components/PersonalNotesWidget.tsx`: bloc flotante personal sobre cualquier vista.
- `src/components/StatusRequestModal.tsx`: selección de órdenes y generación del PDF para solicitar estatus a la yarda.
- `src/services/`: llamadas HTTP al backend.
- `src/utils/`: reglas de estados y utilidades.
- `src/index.css`: tokens y contenedores visuales compartidos.

## Archivos, imágenes y Wasender

El módulo [src/server/files](src/server/files) está preparado para cargas simples y múltiples:

- `saveUpload()` guarda un archivo.
- `saveUploads()` guarda hasta 20 archivos con rollback ante error.
- `removeUpload()` elimina usando validación de ruta.
- Los nombres internos usan UUID.
- Se validan MIME, tamaño, extensión y directorio de almacenamiento.
- Las imágenes se separan de los archivos generales.

El módulo [src/integrations/wasender](src/integrations/wasender) expone:

- `wasender.sendText()`.
- `wasender.sendImage()`.
- `wasender.sendFile()`.

No se realizan llamadas externas mientras falten `WASENDER_BASE_URL` y `WASENDER_API_KEY`.

## Seguridad

- Contraseñas verificadas con bcrypt.
- Sesiones JWT en cookies `HttpOnly`, `Secure` en producción y `SameSite=Lax`.
- Logout con eliminación de cookie.
- Validación de payloads con Zod.
- Límite de tamaño para cuerpos JSON.
- Validación obligatoria de `Content-Type`.
- Rate limit de login en memoria.
- Roles administrativos para usuarios y operaciones protegidas.
- Relación Semanal exige un código OTP generado para cada acceso; no existe bypass de Super Admin ni código maestro.
- Protección contra desactivación o degradación de la propia cuenta administradora.
- Headers de seguridad, CSP y HSTS bajo HTTPS.
- Contenedor de producción ejecutado como usuario no root.
- Healthcheck para Dokploy.
- Sin credenciales reales en el repositorio.

## Backup y recuperación

Desde `Sistema`, un usuario administrador puede descargar **Descargar respaldo SQL**. El endpoint protegido `GET /api/system/backup` genera un archivo `.sql` con:

- Todas las tablas base de la base configurada.
- La sentencia `CREATE TABLE` de cada tabla.
- Todos los registros actuales mediante `INSERT`.
- Desactivación temporal de `FOREIGN_KEY_CHECKS` para facilitar la restauración.

El archivo se descarga con un nombre fechado como `radar-v3-backup-2026-09-17T...sql`. El proceso usa la conexión MySQL/MariaDB de la aplicación y no depende de que `mysqldump` esté instalado en el contenedor. El backup debe almacenarse fuera del servidor y probarse periódicamente en una base de restauración antes de considerarse recuperable.

## Bloc de notas personal

El botón flotante de edición abre un bloc persistente sin abandonar la vista actual ni cerrar modales abiertos. Cada usuario tiene una nota independiente almacenada en `personal_notes`; el backend identifica al usuario mediante la sesión y nunca recibe un `user_id` desde el navegador. El contenido admite hasta 100.000 caracteres y se guarda automáticamente o al cerrar el bloc.

La pestaña `Mensajes` del bloc permite seleccionar otro usuario activo, escribir un asunto opcional y enviar información rápida. Los mensajes se almacenan en `personal_messages`, se consultan únicamente por remitente o destinatario y no dependen de Wasender.

## Solicitud de estatus para yarda

Desde `Órdenes` se puede abrir `Solicitud de estatus`. El flujo solicita:

1. Rango de fechas de creación.
2. Estatus incluidos: `Cotización`, `Pagado`, `En preparación` y `En espera de confirmación`.
3. Selección de todas las órdenes encontradas o de órdenes individuales.

Al emitir el reporte se descarga un PDF con nombre fechado. Cada orden incluye nombre del cliente, año, marca, modelo, tipo `ENG` o `TRA`, descripción, VIN cuando existe, código y estatus. El tipo se infiere de la pieza: transmisiones/cajas se marcan como `TRA` y el resto como `ENG`.

## Docker y producción

El [Dockerfile](Dockerfile) usa dos etapas:

1. Compila frontend y API.
2. Ejecuta un runtime Node 22 con solo dependencias de producción.

El contenedor expone el puerto `3000`, sirve frontend y API desde el mismo proceso y ejecuta:

```bash
node dist/server.js
```

El endpoint de healthcheck es:

https://radar-rsy.store/health

El despliegue se gestiona en Dokploy conectado al branch `main`. Después de publicar cambios en GitHub es necesario esperar o iniciar un nuevo deploy para que Dokploy construya la imagen actualizada.

## Estado actual

El proyecto está operativo en local y preparado para producción. Los módulos de uploads y Wasender están desacoplados y configurables, pero permanecen sin envíos externos automáticos hasta que se definan credenciales, destinatarios y reglas de negocio. Las llamadas no tienen un módulo independiente ni endpoints de registro directo; los datos históricos que puedan estar asociados a reclamos se conservan como referencia.
