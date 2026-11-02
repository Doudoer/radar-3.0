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
- Vistas separadas de reclamos y reembolsos, con pagos de devoluciones confirmados por administración.
- Operaciones y traspaso de órdenes.
- Relación semanal y finanzas persistentes protegidas por bóveda con segunda autenticación, verificada en el servidor.
- Dashboard operativo y actividad reciente.
- Configuración del sistema e integración futura de mensajería.
- Backup total SQL de la base de datos para administradores con boveda desbloqueada.
- Gestión de usuarios, roles, estado de cuenta y permisos.
- Loading global durante sesión, carga de datos y transición de vistas.
- Bloc de notas personal flotante, persistente por usuario y accesible sobre cualquier vista o modal.
- Mensajería interna rápida entre usuarios desde el mismo bloc personal.
- Layout visual compartido para las vistas principales.

## Estilo visual

La interfaz adapta el lenguaje visual de [Horizon UI Chakra](https://github.com/horizon-ui/horizon-ui-chakra)
(referencia publicada bajo MIT): tipografia DM Sans, superficies limpias,
tarjetas redondeadas y acentos violeta/azul. Se mantiene React/Tailwind, sin
incorporar Chakra ni datos de demostracion. No se modifica la autorizacion
ni el segundo factor de la boveda.

El tema compartido se define en `src/horizon.css`, cargado despues del estilo
legacy para normalizar las pantallas, formularios y modales existentes en claro
y oscuro. Las reglas son solo de pantalla: se conservan las reglas de impresion.
Los usuarios nuevos comienzan en claro; se respeta la preferencia previamente
guardada. DM Sans dispone de fuentes de sistema como alternativa sin conexion.
Los modales de seguimiento post-entrega y registro de contacto se renderizan
fuera de `#root`; su estilo compartido usa `.horizon-followup-portal` para
mantener el mismo tema claro/oscuro sin alterar las reglas de seguimiento.

## Criterios de las analiticas

- Dashboard y Mis Operaciones comparten periodos de negocio (semana lunes-domingo,
  mes y ano), independientes de la zona horaria del navegador. Las fechas invalidas
  no se convierten en actividad de hoy.
- La distribucion operativa asigna cada orden a una sola categoria, incluidos
  archivos y estados historicos. Los porcentajes se muestran con un decimal.
- Los ingresos netos son pagos menos reembolsos por fecha efectiva; los cobros
  incluyen solamente pagos. No se incluyen saldos migrados sin evidencia fechada.
  Los administradores pueden consultar agregados diarios del dashboard sin
  segundo factor en `/api/analytics/income`. No incluyen identificadores de
  orden ni movimientos individuales. La boveda sigue siendo obligatoria para
  movimientos detallados, nomina, gastos y configuracion financiera.
- Mis Operaciones muestra valor comercial total (pieza, envio y core), abonos
  acumulados y saldo actual de las ordenes creadas en el periodo; no representa
  cobros ocurridos en ese periodo ni facturacion fiscal. Las ventas excluyen
  cotizaciones, reclamos, reembolsos, cancelaciones y estados sin clasificacion.
- El grafico de ingreso neto conserva centavos, usa cero real para periodos vacios
  y representa los valores negativos debajo del eje cero.
- Actualizar el dashboard consulta tanto las ordenes como los movimientos.

## Disponibilidad de piezas y Google Sheets

Las ordenes muestran coincidencias de inventario por tipo, marca, modelo, ano
y especificaciones. Son sugerencias para revision: nunca garantizan
intercambiabilidad mecanica. Los rangos incompletos y especificaciones faltantes
se indican como posibles coincidencias. Piezas vendidas o eliminadas no se ofrecen.

En el resumen de una orden, **Ver coincidencias** permite seleccionar una pieza
disponible y confirmar su revision mecanica antes de **Vincular y reservar pieza**.
Consultar coincidencias no reserva nada. La reserva se valida en una transaccion
con bloqueo de filas, version de orden y auditoria; no modifica precios ni
permite reemplazar una pieza ya asignada. Los cambios se notifican a las sesiones
locales mediante eventos. Las ordenes historicas no se vinculan automaticamente.

En Inventario se puede descargar todo el inventario o solo los resultados
filtrados como CSV UTF-8. Google Sheets: **Archivo > Importar > Subir**, seleccionar
el CSV y separador coma; desactivar la conversion automatica de texto a numeros,
fechas y formulas para conservar identificadores/VIN. No hay envio automatico
a Google. El servidor incluye costo interno solo para administracion y neutraliza
formulas en campos de texto. La impresion por marcas se conserva.

La aceptacion HTTP de esta funcion se ejecuta con
`scripts/test-inventory-availability.ts`, exclusivamente contra una base vacia
llamada `radar_inventory_validation` y una API de pruebas aislada. Comprueba
reserva simultanea (200/409), auditoria, versiones, liberacion al cancelar y
exportacion CSV con permisos. No debe apuntarse a la copia de negocio ni al VPS.

## Requisitos

- Node.js 22 o superior.
- npm.
- MariaDB 11 (motor validado; las migraciones usan sintaxis específica de MariaDB).
- Base de datos `radar_v3` creada y accesible.

## Desarrollo local

### Copia aislada de produccion con Docker Desktop

`compose.desktop.yml` ejecuta la aplicacion compilada, MariaDB 11 y un proxy Nginx en el
proyecto Docker `radar-desktop`, separado de Dokploy y del VPS. No requiere
Node.js instalado en el equipo.

```bash
docker compose -f compose.desktop.yml up -d --build --wait
```

Abrir http://127.0.0.1:3000. Se conservan las cuentas y contrasenas de la copia
restaurada; no se cambian usuarios de produccion. Para acceder mediante HTTP
local se usa `NODE_ENV=development`, aunque el frontend esta compilado.

La base de datos y la aplicacion no publican puertos. Un proxy Nginx publica
la web solo en la interfaz local del equipo. La app y MariaDB usan exclusivamente
una red `internal`, sin salida a Internet,
y `WASENDER_ENABLED=false` impide envios reales. Las
integraciones externas del servidor no funcionan en este entorno. El navegador
puede seguir solicitando recursos externos, como fuentes o consultas VIN.

Los datos persisten en los volumenes Docker `database`, `uploads` y
`app_backups` del proyecto. Las credenciales de este Compose son exclusivas de
desarrollo y nunca deben usarse en produccion.

La copia original descargada queda en `backups/production-copy/` (excluida de
Git y del contexto de build). Contiene datos reales: no compartirla ni subirla
a un repositorio. Los archivos subidos tambien se excluyen del build.

Para restaurar por primera vez sobre volumenes nuevos, antes de arrancar la app:

```bash
docker compose -f compose.desktop.yml build app
docker compose -f compose.desktop.yml up -d --wait db
docker compose -f compose.desktop.yml exec -T db sh -c \
  'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot "$MARIADB_DATABASE"' \
  < backups/production-copy/database.sql
docker compose -f compose.desktop.yml run --rm --no-deps -T --user 0 \
  --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE app \
  sh -c 'tar -xzf - -C /app && chown -R 1001:1001 /app/uploads /app/backups' \
  < backups/production-copy/uploads.tar.gz
docker compose -f compose.desktop.yml run --rm migrate --baseline-legacy
docker compose -f compose.desktop.yml up -d --wait
```

No ejecutar la restauracion sobre una base local con cambios que se quieran
conservar: el dump reemplaza las tablas existentes. La exportacion SQL usa una
transaccion consistente sin bloqueos de tablas; los archivos se copian mientras
produccion sigue activa, por lo que no representan una instantanea atomica junto
con la base.

```bash
# Ver estado y registros
docker compose -f compose.desktop.yml ps
docker compose -f compose.desktop.yml logs --tail=100 app

# Detener sin borrar datos
docker compose -f compose.desktop.yml stop

# Volver a iniciar
docker compose -f compose.desktop.yml up -d --wait
```

No usar `down -v` salvo que se quiera borrar la base y los archivos locales.
Estos comandos no se conectan al VPS.

### Actualizaciones locales y migraciones

Antes de actualizar, conservar un dump consistente y detener la app local.
No se ejecutan cambios de esquema durante el arranque HTTP. Si faltan
migraciones, la app se niega a iniciar en lugar de servir con esquema incompleto.

```bash
docker compose -f compose.desktop.yml stop app
docker compose -f compose.desktop.yml build app
docker compose -f compose.desktop.yml run --rm migrate
docker compose -f compose.desktop.yml up -d --wait
```

`--baseline-legacy` se usa **una sola vez** sobre la copia anterior sin historial
de migraciones; comprueba su esquema y registra la base conocida, sin repetir el
DDL inicial sobre tablas existentes. Una base vacía usa `migrate` sin esa opción.
Las migraciones DDL no son atómicas en MariaDB: no interrumpirlas y conservar el
dump previo. No ejecutarlas simultáneamente con exportaciones de respaldo.

### Reglas de integridad

- `Pagado` exige liquidar pieza + core + envío; importes con dos decimales,
  sin anticipos superiores al total.
- Las ediciones de órdenes requieren la versión recibida; un conflicto devuelve
  409 y no sobrescribe la otra edición. Crear órdenes y devoluciones requiere
  una clave UUID estable por intento, reutilizada en reintentos.
- Solo administración cambia finanzas, asignaciones, cancelaciones,
  reactivaciones o fechas de entrega existentes y confirma reembolsos.
- Los reembolsos pueden ser parciales; solicitudes pendientes reservan el importe
  y nunca pueden exceder lo cobrado menos otras devoluciones.
- La comisión es 2% del precio de pieza entregada, excluyendo core, envío y yarda.
  Semana lunes–domingo y zona `America/New_York`.
- Garantía de cero días válida; comienza en entrega física. Fechas históricas
  faltantes y posibles duplicados de clientes requieren revisión, no inferencias.
- Nómina, reglas recurrentes y gastos se guardan en la base. La importación de
  datos del navegador es explícita y conserva el original. Cobros históricos sin
  fecha permanecen como saldo inicial, no como ingresos de una semana inventada.
- La restauración SQL directa desde la web está deshabilitada (409). Exportar,
  verificar en una base aislada y planificar el reemplazo con mantenimiento.
  Las descargas de respaldos requieren sesión administrativa y boveda desbloqueada;
  adjuntos, sesión. La auditoria y las escrituras de gestion de usuarios tambien
  requieren la boveda. Los agregados diarios del dashboard mantienen su acceso
  administrativo sin OTP.

Validación adicional reproducible: `scripts/test-information-integrity.ts`
rechaza cualquier base distinta de `radar_validation_fresh` y prueba rutas HTTP
con registros sintéticos. No ejecutarlo contra la copia de trabajo ni producción.

### Desarrollo con Node.js y MySQL

Instalar dependencias:

```bash
npm install
```

Docker Desktop puede iniciar una base MySQL local aislada:

```bash
npm run db:up
```

Crear un archivo `.env` a partir de `.env.example` y completar la conexion.
Para desarrollo con Node cambiar explicitamente `NODE_ENV=development`,
`APP_URL=http://localhost:3000`, `CORS_ORIGIN=http://localhost:3000` y
`TRUST_PROXY=0`. El ejemplo es de produccion y rechaza HTTP.
Para el contenedor local se usan `DB_HOST=127.0.0.1`, `DB_PORT=3306`,
`DB_NAME=radar_v3`, `DB_USER=radar_app` y `DB_PASSWORD=radar_local_password`.

Aplicar migraciones y crear el administrador inicial:

```bash
set -a; source .env; set +a
npm run db:setup
```

El seed exige `ADMIN_EMAIL` y una `ADMIN_PASSWORD` de al menos 12 caracteres. Es idempotente y no modifica un administrador existente.

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
| `TRUST_PROXY` | `1` solo con Node accesible exclusivamente desde un proxy confiable que sobrescribe `X-Real-IP` y `X-Forwarded-Proto`; por defecto no se confia en esas cabeceras. |
| `WASENDER_ENABLED` | `false` deshabilita WhatsApp explícitamente. |
| `WASENDER_API_KEY` | Credencial solo por entorno; sin valor incorporado. |
| `VITE_API_URL` | URL de API usada por Vite en desarrollo. |
| `ADMIN_NAME` | Nombre del administrador creado por el seed. |
| `ADMIN_EMAIL` | Correo del administrador creado por el seed. |
| `ADMIN_PASSWORD` | Contraseña inicial; mínimo 12 caracteres. |

Nunca guardar credenciales reales en Git. En Dokploy deben configurarse como variables o secretos del entorno de producción.

## Seguridad y operacion

Informe de la revision local: [SECURITY-REVIEW.md](./SECURITY-REVIEW.md).
Estas modificaciones no estan desplegadas en el VPS.

- Produccion exige `APP_URL` y, si existe, `CORS_ORIGIN` como origen HTTPS
  exacto, JWT de al menos 32 caracteres sin valores de ejemplo y usuario DB no
  root. Generar el secreto fuera de Git; su longitud no demuestra entropia.
  No se permite arrancar con depurador. HTTP devuelve 426 excepto `/health`.
- El proxy debe terminar TLS, redirigir HTTP a HTTPS y ser el unico ingreso a
  Node. No publicar los puertos de Node o MariaDB. Aplicar firewall y, si DB esta
  fuera de una red privada confiable, configurar TLS con certificados verificados.
  La plantilla `deploy/nginx-radar.conf` ya no publica adjuntos mediante `alias`.
- `radar_session` es HttpOnly, SameSite=Lax, 8 horas; `radar_finance` y
  `radar_csrf`, HttpOnly y SameSite=Strict. Todas son Secure en produccion.
  Cerrar sesion revoca las sesiones de la cuenta en el servidor.
  Cambiar contrasena, identidad administrativa o cuenta desde gestion revoca
  sesiones/bovedas; regenerar factores vuelve a bloquear la boveda.
- Cambiar correo o contrasena desde el perfil requiere la contrasena actual.
  Cambiar el telefono administrativo exige ademas desbloquear la boveda con
  el factor existente. La gestion administrativa de cuentas exige esa misma
  autorizacion. No se reiniciaron factores ni contrasenas de usuarios reales.
- Los clientes que escriben obtienen `GET /api/auth/csrf`, conservan su cookie
  y envian el token recibido en `X-CSRF-Token`. Es firmado, caduca a las 8 horas
  y esta ligado a la sesion exacta, incluso con Bearer. `apiFetch` renueva solo
  tras `403 CSRF_INVALID`, antes de que exista una escritura. Scripts de prueba
  usan `scripts/securityHttp.ts`; no omitir esta proteccion para integraciones.
- Limites por proceso: 600 peticiones/minuto/IP; 120 escrituras/minuto/usuario,
  30 para autenticacion, mensajeria, subidas y respaldos; 10 errores de login
  por IP o cuenta en 15 minutos; 5 fallos 2FA en 15 minutos. Hasta 5 conexiones
  SSE por usuario y 200 totales, revalidadas cada 25 segundos. Respuestas 429
  operativas incluyen `Retry-After`. No se aceptan JWT en URLs.
- Se registran accesos, cambios de factores, fallos y rechazos sospechosos,
  con limites para no inundar la auditoria. Consultarla como admin con boveda
  en `/api/system/audit-logs`. La copia local no envia alertas externas.
  Para varias replicas hacen falta limites/grants compartidos y supervision externa.
- CSP no permite JavaScript inline ni eval; conserva estilos inline por
  compatibilidad con React y la impresion. Los valores del reporte imprimible
  se escapan y ambos CSV de inventario neutralizan formulas. Costo interno solo
  para administracion en lectura, escritura y exportacion.
- Adjuntos: hasta 10 MiB binarios y 15 MiB por peticion JSON/proxy, extensiones
  y MIME permitidos, base64 valido y firma inicial concordante; SVG y ejecutables
  no se admiten. Los archivos no imagen se descargan, no se ejecutan como HTML.
  Avatares raster de hasta 350 KiB en la interfaz, 500.000 caracteres en servidor.
  Esto no sustituye un antivirus para archivos de terceros.
- Nuevas contrasenas: bcrypt factor 12 y maximo 72 bytes UTF-8 para evitar
  truncamiento. No hay enlaces de recuperacion de contrasena ni procesador
  externo de pagos en este proyecto. Los importes, saldos y devoluciones se
  comprueban en servidor; no se considera prueba de pago un valor del navegador.
- La cuenta DB local solo tiene SELECT/INSERT/UPDATE/DELETE.
  `deploy/desktop-runtime-grants.sql` configura volumenes nuevos; para volumenes
  existentes se aplica explicitamente una vez con el administrador de la DB.
  El servicio `migrate` usa una cuenta separada (root solo en Docker local).
  En produccion usar un migrador dedicado, no conceder DDL a la aplicacion.
  El contenedor app es no-root, sin capacidades, con raiz de solo lectura y
  volúmenes privados de datos; mantener sus copias y el disco cifrados fuera de Git.
- `npm run security:check` es un diagnostico de configuracion/archivos, no una
  certificacion; no escribe directorios ni muestra claves.
  `npm audit` consulta solo metadatos de paquetes publicos.
  La copia no contiene historial Git: su escaneo y la rotacion de credenciales
  compartidas o comprometidas deben realizarse antes del despliegue.

La aceptacion real de seguridad esta en `scripts/test-security-hardening.ts`;
se niega a operar fuera de una base vacia `radar_security_validation`. Crear
esa base y migrarla por separado, ejecutar una API desechable con
`NODE_ENV=production`, `APP_URL=https://security.test`, `TRUST_PROXY=1`,
WhatsApp deshabilitado y acceso exclusivamente por red Docker privada.
El script usa `TEST_API_URL`, el mismo `JWT_SECRET` de prueba y acceso de
preparacion a esa DB; envia cabeceras de proxy solo en este entorno aislado.
No ejecutarlo contra datos de trabajo ni exponer esa API.

## Scripts

| Comando | Función |
| --- | --- |
| `npm run dev` | Servidor de desarrollo Vite. |
| `npm run api` | API Node mediante `tsx`. |
| `npm run db:up` | Inicia MySQL local mediante Docker Compose. |
| `npm run db:down` | Detiene MySQL local sin eliminar sus datos. |
| `npm run db:migrate` | Aplica migraciones pendientes. |
| `npm run db:seed` | Crea el administrador inicial si no existe. |
| `npm run db:setup` | Ejecuta migraciones y seed. |
| `npm test` | Ejecuta las pruebas automatizadas una vez. |
| `npm run test:watch` | Ejecuta las pruebas en modo interactivo. |
| `npm run lint` | Comprobación TypeScript con `tsc --noEmit`. |
| `npm run build` | Compilación del frontend en `dist/`. |
| `npm run build:api` | Bundle de API en `dist/server.js`. |
| `npm run preview` | Previsualización del build frontend. |
| `npm run clean` | Elimina artefactos locales de build. |

Validación recomendada antes de publicar:

```bash
npm test
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
- Relación Semanal exige segunda autenticación: WhatsApp (PIN de un uso, 60 segundos), Authenticator configurado o código de respaldo de un uso. La autorización de bóveda dura 15 minutos, se vincula a la sesión autenticada y se revoca al pulsar «Bloquear bóveda». Reiniciar la API también bloquea las bóvedas. No existe bypass de Super Admin ni código maestro.
- Las API financieras rechazan accesos sin bóveda desbloqueada, incluso para administradores. Consultar o regenerar secretos y códigos requiere desbloquearla primero. En local WhatsApp permanece desactivado: se informa el error y no se simula el envío; pueden usarse factores previamente configurados.
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
