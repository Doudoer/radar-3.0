# 📍 CHECKPOINT RADAR 3.0 — 2026-10-12

**Fecha y Hora:** 12 de Octubre, 2026 — 10:05 UTC-4  
**Rama:** `main`  
**Estado:** Probado y compilado con 100% de tests pasando (96/96 en 16 suites)

---

## 🚀 Resumen de Actualización Reciente (12 de Octubre, 2026)

### Corrección de Validación Zod en Canales de Notificación y Asignación Flexible de Operadores (`schemas.ts`, `WasenderNotificationsManager.tsx`, `notificationService.ts`)
- **Problema Detectado:** Al intentar designar operadores (ej. Alejandro Palacio) en canales de notificación y guardar la configuración, el backend arrojaba `Payload inválido: channels.9.key: Invalid option: expected one of "NUEVA_VENTA"|...` debido a que la enumeración de Zod en el backend carecía del 10.º canal (`ALERTA_SEGURIDAD`).
- **Corrección en Backend:**
  - Incluido `'ALERTA_SEGURIDAD'` en `notificationChannelUpdateSchema` y `notificationTestDispatchSchema` en [`src/server/schemas.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/server/schemas.ts).
  - En [`src/integrations/wasender/notificationService.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts), se amplió la resolución de destinatarios en canales `superadmin_only` para despachar también a operadores y contactos externos designados manualmente por el administrador.
- **Mejoras en Frontend (`WasenderNotificationsManager.tsx`):**
  - Se habilitó la selección de operadores registrados en **todos** los canales activos (no solo los multicast), permitiendo asignar operadores adicionales fijos a `CAMBIO_ESTATUS` o canales administrativos.
  - Indicador visual `(Sin tel)` en operadores sin teléfono registrado para recordar registrarlo en su perfil.
  - Título de pestaña dinámico reflejando el número real de canales `(10 Tipos)`.

### Formato de Notificación WhatsApp "Nueva Venta": Incorporación de Línea de Descripción (`notificationTemplates.ts`, `server.ts`)
- **Solicitud del Usuario:** En el mensaje de WhatsApp enviado para `NUEVA_VENTA`, se requería agregar la descripción de la pieza justo debajo de la línea `⚙️ Pieza: [Nombre de la pieza]`.
- **Implementación:**
  - En [`src/integrations/wasender/notificationTemplates.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationTemplates.ts):
    - Ampliado `NuevaVentaTemplateData` para soportar `partDescription` y `notes`.
    - En `formatNuevaVentaMessage`: se separó el nombre de la pieza de sus especificaciones/descripción y se añadió la línea `📝 *Descripción:* ${descStr}` inmediatamente debajo de `⚙️ *Pieza:* ${pieceStr}`.
    - Resolución inteligente de `descStr` combinando especificaciones técnicas (`productSpecs`) y notas de la orden (`notes` / `description`), filtrando automáticamente registros de auditoría y evitando duplicaciones. Si no hay datos, muestra `'Sin descripción adicional'`.
    - Ajustado el emoji de auto a `🚗` para coincidir exactamente con el mensaje real recibido en WhatsApp.
  - En [`server.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/server.ts): Se pasaron las notas y descripción de la orden en `POST /api/orders` y `PUT /api/orders/:id`.
  - Pruebas unitarias actualizadas en [`tests/wasender-notification-routing.test.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/tests/wasender-notification-routing.test.ts) (100% pasando).

### Corrección de Dominio y Ruta de Descarga de Respaldos Automáticos (`server.ts`, `run-backup.ts`, `nginx-radar.conf`)
- **Problema Detectado:** La notificación de WhatsApp para `RESPALDO_AUTOMATICO` generaba enlaces que apuntaban a `https://radar-rsy.site/api/uploads/backups/...`, cuando el dominio de producción es `https://radar-rsy.store`. Además, no existía un endpoint en el servidor para servir las descargas directas desde `/api/uploads/backups/`, arrojando error 404 al intentar descargar el respaldo generado.
- **Corrección en Backend & Enrutamiento:**
  - En [`server.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/server.ts):
    - Actualizado el dominio por defecto a `https://radar-rsy.store` (y sanitización de `process.env.APP_URL` para reemplazar cualquier referencia obsoleta a `radar-rsy.site`).
    - Exonerada la ruta `/api/uploads/backups/` del chequeo obligatorio de Bearer JWT para permitir la descarga directa al hacer clic desde WhatsApp en dispositivos móviles sin sesión activa en el navegador.
    - Creado el endpoint seguro `GET /api/uploads/backups/:filename` (y `/uploads/backups/:filename`) con soporte para métodos `GET` y `HEAD`, sanitización contra Path Traversal (`path.basename`), validación de extensiones seguras (`.sql`, `.sql.gz`), cabeceras `Content-Disposition: attachment` y streaming directo desde el directorio físico `backups/`.
  - En [`scripts/run-backup.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/scripts/run-backup.ts): Actualizado el script de respaldo cron para utilizar el dominio `https://radar-rsy.store` y la ruta `/api/uploads/backups/${result.filename}`.
  - En [`deploy/nginx-radar.conf`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/deploy/nginx-radar.conf) y [`.env.example`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/.env.example): Actualizado `server_name` y variables de entorno para incluir `radar-rsy.store`.
  - Verificado con `curl -I` y `curl -s` (código HTTP 200 OK y descarga exitosa del archivo SQL completo de 1.95 MB).

### Exclusividad Absoluta de Destinatario para Respaldo Automático (`notificationService.ts`, `WasenderNotificationsManager.tsx`, `wasender-notification-routing.test.ts`)
- **Regla de Negocio y Seguridad:** La copia de seguridad completa de la base de datos SQL (`RESPALDO_AUTOMATICO`) debe enviarse **única y exclusivamente al número del Super Administrador (`+584127307933`)**, impidiendo cualquier difusión a administradores secundarios (ej. Favio Andrade), operadores o contactos externos.
- **Implementación en Backend:**
  - En [`src/integrations/wasender/notificationService.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts), se estableció una compuerta prioritaria (early return) en `resolveRecipientsForEvent`:
    - Resuelve exclusivamente al usuario Super Admin primario (`id = 1` o teléfono coincidente con `4127307933`), con fallback de seguridad a `+584127307933`.
    - Omite de forma tajante operadores, contactos externos y administradores secundarios.
    - En `updateNotificationChannels`: sanitiza automáticamente `operator_ids = []` y `external_contact_ids = []` para `RESPALDO_AUTOMATICO`, forzando `superadmin_enabled = 1`.
- **Protección Visual en Frontend (`WasenderNotificationsManager.tsx`):**
  - La tarjeta de `RESPALDO_AUTOMATICO` en la matriz de notificaciones ahora muestra un aviso de seguridad destacado: *"Canal Protegido • Exclusivo Super Administrador (+584127307933)"*.
  - Se ocultaron los selectores de operadores y contactos externos para este canal específico, protegiendo contra asignaciones no deseadas.
  - Se protegieron las funciones de alternancia (`handleToggleOperator`, `handleToggleExternalContact`, `handleToggleSuperadmin`) para no mutar dicho canal.
- **Pruebas de Verificación:**
  - Añadido test unitario en [`tests/wasender-notification-routing.test.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/tests/wasender-notification-routing.test.ts) validando que aun habiendo múltiples administradores y operadores en la base de datos, `RESPALDO_AUTOMATICO` solo genera como destinatario `+584127307933`. Total: 96/96 tests pasando.

---

## 🚀 1. Resumen de lo Realizado en Sesiones Anteriores

### A. Perfiles de Usuario Completos: Teléfono, Correo, Avatar y Edición Dual (`UserProfileModal.tsx`, `UsersManagementView.tsx`, `TopHeader.tsx`, `server.ts`)
- **Objetivo Cumplido:** Los usuarios ahora cuentan con perfiles completos que incluyen **Número de Teléfono (`phone`)**, **Correo Electrónico (`email`)**, y **Avatar de Perfil (`avatar_url`)**, editables tanto por el propio usuario desde su perfil como por el Super Admin desde la gestión de usuarios.
- **Base de Datos & Migración:**
  - Creada columna `avatar_url TEXT NULL AFTER phone` en la tabla `users` de MySQL (donde `phone VARCHAR(50)` ya existía).
  - Creado script de migración [`migrations/009_users_phone_and_avatar.sql`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/migrations/009_users_phone_and_avatar.sql) y verificación automática en `ensureDatabaseTables()` (`server.ts`).
- **Endpoints de Backend:**
  - `PUT /api/auth/profile`: Permite a cualquier usuario autenticado actualizar su propio Nombre, Correo, Teléfono, Avatar y cambiar su Contraseña (con verificación de contraseña actual y validación de correo único).
  - `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`: Retornan, crean y actualizan `phone` y `avatar_url` para la administración por Super Admin.
  - `/api/auth/login` y `/api/auth/me`: Retornan `phone` y `avatar_url` para alimentar la sesión global del usuario.
- **Modal de Perfil de Usuario (`UserProfileModal.tsx`):**
  - Accesible haciendo clic en el avatar/nombre en la barra superior (`TopHeader`).
  - **Galería de 8 Avatares Preset:** Opciones con avatares de alta calidad temáticos.
  - **Subida de Imagen Directa:** Carga imágenes locales desde el dispositivo (conversión a Base64 optimizada < 2MB).
  - **URL Personalizada:** Permite pegar cualquier enlace web directo de imagen.
  - **Edición de Datos de Contacto:** Modificación de Nombre completo, Correo electrónico y Teléfono.
  - **Pestaña de Seguridad:** Permite cambiar la contraseña verificando la actual y validando los requisitos de seguridad.
- **Gestión de Usuarios Super Admin (`UsersManagementView.tsx`):**
  - La tabla de usuarios muestra el avatar circular con badge de rol, nombre, email y teléfono directo con enlace `tel:`.
  - Los modales de Crear y Editar Usuario permiten seleccionar avatar de la galería o URL personalizada y registrar el teléfono del operador.
- **Cabecera Superior (`TopHeader.tsx`):**
  - Renderiza el avatar activo del usuario con fallback estilizado, badge de rol con brillo neón y abre el modal de perfil al hacer clic.
- **Pruebas Automatizadas:** 42 tests unitarios pasando en Vitest (`tests/server-schemas.test.ts`), validación de TypeScript (`0 errors`) y compilación de producción exitosa.

### A. Persistencia y Mantenimiento del Millaje Original al Editar Órdenes (`NewOrderModal.tsx`, `orders.ts`, `server.ts`)
- **Problema Solucionado:** Al abrir una orden existente para editarla, el millaje del vehículo se reseteaba automáticamente a `0` porque la tabla `orders` carecía de columna `mileage` en MySQL y el modal tenía un fallback `|| '0'`.
- **Migración de Base de Datos:**
  - Creada columna `mileage VARCHAR(60) NULL AFTER color` en la tabla `orders` de la base de datos MySQL `radar_v3`.
  - Añadido script de migración [`migrations/008_orders_mileage.sql`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/migrations/008_orders_mileage.sql) y verificación automática idempotente en `ensureDatabaseTables()` (`server.ts`).
- **Mapeo de Datos:** Actualizado `mapOrder` en [`src/server/orders.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/server/orders.ts) para extraer y retornar `order.vehicle.mileage` de forma fidedigna.
- **Endpoints de Backend:** Actualizados `POST /api/orders` y `PUT /api/orders/:id` para guardar y actualizar `vehicle.mileage`.
- **Modal de Edición:** En [`src/components/NewOrderModal.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/NewOrderModal.tsx), el campo `Millaje Reportado` se pre-rellena con el valor original exacto reportado por el operador.
- **Visualización en Detalle:** En [`src/components/OrderDetailView.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/OrderDetailView.tsx), se muestra el millaje formateado (ej. `125,400 mi`) en la cabecera técnica del vehículo.
- **Pruebas Automatizadas:** 40 tests unitarios pasando en Vitest cubriendo esquemas y mapeo de millaje.

### B. Módulo de Estadísticas y Operaciones Reorganizado (`OperationsView.tsx`)
- **Filtro Semanal de Lunes a Domingo:**
  - Motor de cálculo de semanas estrictas de **Lunes (00:00:00) a Domingo (23:59:59)**.
  - Navegador temporal con botones de semana anterior, semana actual y semana siguiente.
  - Histograma visual de barras diarias (Lun, Mar, Mié, Jue, Vie, Sáb, Dom) con monto acumulado y conteo de ventas.
- **Filtro Mensual:**
  - Selector y visor de ventas del mes en curso o meses históricos (del 1 al último día del mes).
  - Desglose semanal del mes (Sem 1 a Sem 5).
- **Atribución y Privacidad por Operador:**
  - **Operador Regular:** El operador activo únicamente visualiza sus propias ventas, cotizaciones, métricas y reclamos generados bajo su cuenta.
  - **Super Admin:** Posee un selector desplegable exclusivo para auditar las ventas y estadísticas de cada operador individualmente o ver el consolidado general (`Todos los Operadores`).
- **HUD de 6 Indicadores Clave (KPIs):**
  1. *Facturación Total Ventas ($ USD)*
  2. *Ticket Promedio por Venta ($ USD)*
  3. *Anticipos Cobrados en Mano ($ USD)*
  4. *Saldo Pendiente por Cobrar ($ USD)*
  5. *Cotizaciones & Tasa de Conversión (%)*
  6. *Órdenes Activas en Taller / Despacho*
- **Desglose de Logística:** Distribución entre Retiro en Mostrador/Patio ($ y %) y Envíos a Domicilio/Flete.
- **Suite de Pruebas Automatizadas:** Incorporado [`tests/operations-analytics.test.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/tests/operations-analytics.test.ts) con 4 tests unitarios de cálculo de semanas, meses y parseo de fechas.

### B. Bloc de Notas Dinámico y Libremente Arrastrable (`PersonalNotesWidget.tsx`)
- **Posición por Defecto:** Al abrirse, se sitúa automáticamente en la **esquina inferior derecha** (`bottom-right`) con separación ergonómica.
- **Movimiento Libre (Drag & Drop):** El operador puede hacer clic sostenido o tocar la cabecera superior (`drag_indicator`) y mover la ventana flotante a cualquier parte de la pantalla con aceleración por hardware (`translate3d`).
- **Límites de Pantalla (Clamping):** Restringe automáticamente los bordes para evitar que la ventana se pierda fuera de la vista en pantallas pequeñas o al redimensionar la ventana.
- **Controles de Ventana:**
  - **Minimizar / Expandir:** Botón para colapsar la ventana en una barra compacta flotante sin perder su posición en pantalla.
  - **Reanclar:** Botón de un clic para devolver la ventana a la esquina inferior derecha.
  - **Cierre y Autoguardado:** Conserva el autoguardado con debounce de 700ms al servidor.

### C. Asignación Automática de Asesor Comercial al Usuario Logeado (`NewOrderModal.tsx`)
- **Eliminación del Selector Manual:** Se removió el menú desplegable `<select>` de "Asesor Comercial Asignado" en el Paso 3 (Finanzas y Envío).
- **Atribución Automática:** El asesor comercial se asigna de manera 100% automática con el nombre (`authUser.name`) y código de usuario (`authUser.id`) de la cuenta con sesión activa.
- **Guardado y Auditoría:** Las órdenes quedan guardadas bajo el nombre y cuenta del operador logeado, mostrando un indicador visual con badge de operador y estado inicial `Cotización`.

### D. Actualización de Marca en Login y Protocolos
- **Píldora Superior:** Cambiado de `RADAR SENTINEL • ACCESO SEGURO` a `RADAR V3 • ACCESO SEGURO`.
- **Pie de Seguridad:** Cambiado de `PROTOCOLO SENTINEL LOCAL` a `PROTOCOLO RADAR V3`.
- **Derechos Reservados:** Incorporado enlace de copyright `Derechos reservados para soviwebs.com` con estilo ciberpunk de alto contraste.

### E. Logo y Pantalla de Carga Fluida (Eliminación de Flash / FOUT)
- **Preloader Nativo en [`index.html`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/index.html):** Se incluyó un preloader HTML/CSS instantáneo con el emblema holográfico de Radar V3 y pulso orbital.
- **Detección de Fuentes en [`LoginView.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/LoginView.tsx):** Compuerta `document.fonts.ready` con SVG vectorial puro para prevenir parpadeo de fuentes o ligaduras.
- **Superposición Global ([`LoadingOverlay.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/LoadingOverlay.tsx)):** Estandarizado a `CARGANDO RADAR V3`.

### F. Corrección de VIN en Creación de Órdenes Manuales
- Al seleccionar y rellenar los datos del vehículo manualmente sin escribir un VIN, el sistema no autogenera VINs falsos.
- Si no se escribe un VIN, la orden se guarda sin VIN asignado (`''` / `NULL` en base de datos).
- En todas las vistas (`OrdersTableView`, `OrderDetailView`, `OperationsView`, `InvoiceModal`, `InvoiceView`, `DispatchLabelModal`, `DispatchLabelView`) se muestra `Sin VIN` o `VIN: N/A` de manera limpia.

### G. Formato de Mensaje de Entrega / Despacho SMS & WhatsApp (`QuickSMSModal.tsx`)
- Plantilla de 8 líneas optimizada para WhatsApp y SMS con botones de copia rápida y redirección directa a chat.

### H. Modo Claro (Light Mode) Global de Alto Contraste y Detalle Compacto
- Motor universal en [`src/index.css`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/index.css) con soporte de alto contraste y vista ergonómica de dos columnas en [`OrderDetailView.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/OrderDetailView.tsx).

---

## 🧪 2. Estado de Pruebas, Compilación y Seguridad

- **Unit Tests:** `39 / 39 passing` (100% pasando en 7 suites) (`npm test`)
- **TypeScript:** `0 errors` (`npx tsc --noEmit`)
- **Production Build:** `npm run build` ejecutado y validado con 0 errores (frontend Vite + backend esbuild `dist/server.js`).
- **Seguridad de la Base de Datos:** Los despliegues y subidas a producción **no tocan, alteran ni borran ningún dato existente**. Solo se ejecutan consultas parametrizadas y sentencias `CREATE TABLE IF NOT EXISTS`.

---

## 🛠️ 3. Guía Rápida para Encender y Continuar

Cuando enciendas la laptop nuevamente, abre una terminal en la carpeta del proyecto y ejecuta:

1. **Iniciar Base de Datos MySQL (Docker):**
   ```bash
   docker start radar-mysql
   ```

2. **Iniciar Backend API (Puerto 3001):**
   ```bash
   npm run api
   ```

3. **Iniciar Frontend Vite (Puerto 3000):**
   ```bash
   npm run dev
   ```

4. **Credenciales de Acceso:**
   - **URL:** [http://localhost:3000](http://localhost:3000)
   - **Usuario:** `admin@radar.com`
   - **Contraseña:** `Deaths.6`

---

## 📂 4. Mapa de Archivos Relevantes Modificados

| Archivo | Rol / Descripción |
| --- | --- |
| [`src/components/NewOrderModal.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/NewOrderModal.tsx) | Modal de creación de órdenes (VIN sin autogeneración falsa) |
| [`src/components/QuickSMSModal.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/QuickSMSModal.tsx) | Modal de mensaje rápido con botón directo de envío vía Wasender |
| [`src/components/OrderDetailView.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/OrderDetailView.tsx) | Vista de detalle de orden compacta |
| [`src/components/OrdersTableView.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/OrdersTableView.tsx) | Tabla de órdenes con paginación y manejo de Sin VIN |
| [`src/components/SystemSettingsView.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/SystemSettingsView.tsx) | Panel de control y pruebas en vivo de la Pasarela Wasender |
| [`src/components/WasenderNotificationsManager.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/WasenderNotificationsManager.tsx) | Gestor de canales de notificación, operadores y números externos |
| [`src/components/SecurityOtpModal.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/SecurityOtpModal.tsx) | Envío real de código OTP a WhatsApp vía Wasender |
| [`src/components/WeeklyRelationView.tsx`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/WeeklyRelationView.tsx) | Envío de token 2FA para liquidación semanal vía Wasender |
| [`src/integrations/wasender/client.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/client.ts) | Cliente HTTP y normalización telefónica para WasenderAPI |
| [`src/integrations/wasender/notificationTypes.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationTypes.ts) | Tipos y contratos para los 8 canales de notificación |
| [`src/integrations/wasender/notificationService.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts) | Servicio de resolución de destinatarios, persistencia MySQL y multidestino |
| [`src/index.css`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/index.css) | Motor de temas Claro / Oscuro con alto contraste |
| [`src/hooks/useTheme.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/hooks/useTheme.ts) | Hook de gestión persistente de tema claro/oscuro |
| [`tests/wasender-notification-routing.test.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/tests/wasender-notification-routing.test.ts) | Pruebas unitarias de enrutamiento y reglas de notificación |
| [`tests/server-schemas.test.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/tests/server-schemas.test.ts) | Pruebas de esquemas y validaciones de entrada |

---

## 📡 Integración Pasarela WhatsApp (WasenderAPI) & Matriz de Notificaciones

- **Servicio:** `https://wasenderapi.com`
- **Sesión Conectada:** `Douglas Movistar` (+584145380654) - *Control Rodriguez Salvage Yard*
- **Número de Pruebas Obligatorio:** `584127307933` (`+584127307933`)
- **Modo Sandbox / Redirección de Seguridad:** `WASENDER_FORCE_TEST_RECIPIENT="true"` (todos los envíos del sistema se dirigen de forma segura únicamente a `+584127307933` durante fase de pruebas).

### 📋 Canales de Notificación y Reglas de Negocio Implementadas:
1. 🛒 **Nueva Venta (`NUEVA_VENTA`)**: Multidestino configurable (Super Admin + Operadores seleccionados + Números externos registrados).
2. ⚠️ **Nuevo Reclamo (`NUEVO_RECLAMO`)**: Multidestino configurable (Super Admin + Operadores de soporte + Números externos).
3. 💸 **Solicitud de Reembolso (`SOLICITUD_REEMBOLSO`)**: Exclusivo Super Administrador (Control financiero estricto).
4. 🔄 **Cambios de Status (`CAMBIO_ESTATUS`)**: Regla Dinámica -> Se envía al teléfono del **operador que creó la orden** exclusivamente cuando una pieza o repuesto pasa a estar en `"Listo para Retiro"` o `"Listo para Despacho"` / `"Listo para Envio"`.
5. ❌ **Orden Cancelada (`ORDEN_CANCELADA`)**: Exclusivo Super Administrador.
6. 💾 **Respaldo Automático (`RESPALDO_AUTOMATICO`)**: Exclusivo Super Administrador (envío de copia SQL con todos los datos).
7. 🔍 **Búsquedas en Subastas (`BUSQUEDA_SUBASTAS`)**: Exclusivo Super Administrador.
8. 📋 **Lista de Reclamos (`LISTA_RECLAMOS`)**: Multidestino configurable (Super Admin + Operadores + Números externos manuales).

### 👥 Directorio de Números Externos:
Permite registrar contactos adicionales (Gerencia, Socios, Proveedores, Despachadores) con Nombre, Teléfono, Etiqueta y selección de canales suscritos.

### ⚡ Automatización en Backend (Disparadores Automáticos Conectados):
- **`PUT /api/orders/:id`**: Al pasar el estatus de una orden a `"Listo para Retiro"`, `"Listo para Despacho"` o `"Listo para Envio"`, se activa y envía automáticamente la notificación [`CAMBIO_ESTATUS`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts) al teléfono del operador asesor asignado a la orden.
- **`PUT /api/orders/:id`**: Al anular o cancelar una orden (`"Cancelado"`), se dispara automáticamente el canal [`ORDEN_CANCELADA`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts) hacia el Super Admin.
- **`POST /api/orders`**: Al registrar una nueva venta, se dispara el canal [`NUEVA_VENTA`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts) hacia el Super Admin y destinatarios suscritos.
- **`POST /api/claims`**: Al radicar un reclamo, se dispara el canal [`NUEVO_RECLAMO`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts).
- **`POST /api/refunds`**: Al solicitar un reembolso, se dispara el canal [`SOLICITUD_REEMBOLSO`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts).
- **`POST /api/system/backup/create`**: Al generar un snapshot SQL, se dispara el canal [`RESPALDO_AUTOMATICO`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/notificationService.ts).
- **Cola Serializada con Protección de Tasa (Rate Limiter):** En [`client.ts`](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/integrations/wasender/client.ts) se implementó una cola global (`enqueue`) que garantiza un intervalo de 5.3 segundos entre peticiones Wasender y reintento automático tras 5.5s si la API reporta límite de cuenta.
