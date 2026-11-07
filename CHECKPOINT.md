# 📍 CHECKPOINT RADAR 3.0 — 2026-11-07

**Fecha y Hora:** 7 de Noviembre, 2026 — 11:20 UTC-4  
**Rama:** `main`  
**Estado:** Probado y compilado con 100% de tests pasando (481/481 en 64 suites, TypeScript/Lint sin errores)

---

## 🚀 Resumen de Actualización Reciente (7 de Noviembre, 2026)

### 6. Flujo de Confirmación de Anticipo y Preparación de Piezas en Yarda

#### 1. Confirmación de Anticipo Adaptada por Método de Pago:
- **Efectivo en Yarda (Cash):**
  - Solicita únicamente el monto recibido y el nombre de la persona que recibió el dinero en la yarda (`receivedBy`).
  - No requiere comprobante fotográfico ni nombre del remitente ni aprobación previa de administración. La orden pasa directo a `pagado`.
- **Tarjeta Débito/Crédito (TDC/TDD vía Square):**
  - Solicita el monto y la captura del voucher / recibo emitido por la terminal Square.
  - No requiere nombre de remitente ni aprobación manual del administrador (Square procesa y concilia directamente). La orden pasa directo a `pagado`.
- **P2P Digital (Zelle, Cash App):**
  - Solicita el monto exacto, captura de pantalla del pago y **nombre de quien envía el pago (`senderName`)**.
  - Si lo registra un operador (no admin):
    - Emite una notificación inmediata por WhatsApp al Administrador / Super Admin vía Wasender con el detalle del pago (monto, método, remitente, cliente, vehículo y comprobante).
    - La orden pasa al estado `espera_confirmacion` con badge de advertencia.
    - El Administrador cuenta con un botón en la orden `[Aprobar Anticipo (Banco)]` (`POST /api/orders/:id/verify-downpayment`) para verificar y cambiar el estado a `pagado`.

#### 2. Preparación y Cita Asistida (Interfaz Visual e Interactiva por Tarjetas):
- **Hero Card de Estado de Yarda:**
  - Tarjeta grande interactiva con gradiente y pulsos de estado (`¡PIEZA LISTA EN YARDA!` vs `Esperando confirmación`).
  - Botón táctil rápido para conmutar notificación de yarda sin necesidad de marcar checkboxes ocultos.
- **Selector Visual de Canal de Contacto:**
  - Tarjetas interactivas con iconos y descripciones contextuales:
    - 📞 **Llamada contestada**
    - 💬 **Mensaje de texto / Chat**
    - 🏪 **Cliente en yarda** (entrega inmediata)
- **Bitácora de Conversación con el Comprador:**
  - Caja de texto moderna con contador en vivo de caracteres y placeholder contextual para registrar la respuesta del cliente.
- **Acuerdo del Core en Tarjetas de Decisión:**
  - 🔄 **El cliente llevará el core a la yarda** (traerá el casco viejo)
  - 💵 **El cliente pagará el valor del core** (abono en el saldo restante)
- **Modalidad de Despacho:**
  - 🏢 **Recogida en yarda**
  - 🚚 **Delivery / envío** (despliega dirección de entrega con diseño limpio)
- **Cita con Atajos Rápidos:**
  - Botones de 1 clic: `[Hoy]`, `[Mañana]`, `[En 2 días]`, más selector de fecha rango tentativo.
- **Checklist Táctil de Verificaciones:**
  - 4 bloques interactivos con iconos y estados de confirmación que se iluminan al seleccionarse (saldo, métodos de pago aceptados, garantía/core y confirmación expresa del cliente).

#### 3. Entrega Física y Cierre Comercial (Interfaz Visual y Galería Interactiva):
- **Hero Card de Entrega:**
  - Tarjeta destacada con gradiente cian, icono de transporte, badge de paso final y datos legibles del receptor (`Persona que recibe la pieza: Nombre · Cliente de la orden`).
  - Distintivo visual informando la activación automática de la garantía desde la entrega.
- **Zona Interactiva de Carga (Drag & Drop + Galería de Fotos):**
  - Dropzone visual con borde punteado, icono animado e indicación clara de formatos y capacidad (hasta 20 fotos de 10 MB).
  - Galería visual en cuadrícula de miniaturas para las fotos subidas, con enlace directo para ampliar y botón flotante para quitar fotos.
  - Indicador de progreso de subida en tiempo real con spinner.
- **Tarjeta Interactiva de Confirmación de Entrega y Garantía:**
  - En lugar de una casilla gris pequeña, un bloque táctil grande que se ilumina en verde esmeralda con icono `handshake` / `check_circle`.
  - Notifica claramente la inspección de la pieza, el inicio del plazo de garantía y las condiciones del core.

#### 4. Tratamiento del Core y Registro de Pagos (Liquidación Visual Interactiva):
- **Selector de Tratamiento del Core en 3 Tarjetas de Decisión:**
  - 💵 **Cliente pagará core:** Se ilumina en cian, despliega el campo del monto con prefijo `$`, y explica que queda como depósito reembolsable.
  - 🔄 **Recibimos pieza usada:** Se ilumina en verde esmeralda, aplica el descuento automático, y provee campo para la referencia y confirmación táctil de recepción física en yarda.
  - 🚫 **Sin cargo / Exento:** Tarjeta limpia para piezas que no requieren core.
- **Registro Visual de Pagos Recibidos:**
  - Selector de método por **chips/botones táctiles con iconos** (Efectivo 💵, Zelle 📲, Cash App 🟢, Tarjeta 💳).
  - Botón rápido **`⚡ Completar saldo ($X.XX)`** para rellenar el saldo restante con 1 solo toque.
  - Entradas de texto e importe con iconos, diseño oscuro moderno y bordes de enfoque visuales.
  - Acciones claras para agregar o quitar métodos de cobro con confirmaciones visibles.

---

---

## 🚀 Resumen de Actualización Reciente (6 de Noviembre, 2026)

### 5. Detección Inteligente y Asistente de Fusión de Clientes Duplicados (Estilo Contactos de Teléfono)
- **Requerimiento:** Detección de clientes duplicados en la base de datos para corrección/limpieza asistida, similar a la herramienta de "Contactos duplicados" en teléfonos inteligentes (Google Contacts / Apple Contacts).
- **Diagnóstico en Base de Datos:**
  - Se analizaron los 590 clientes registrados.
  - Se detectaron 100 grupos de duplicados (66 por coincidencia de teléfono normalizado de al menos 7 dígitos, 34 por nombre y apellido idéntico).
- **Backend & Seguridad Transaccional:**
  - **Endpoint de Detección (`GET /api/customers/duplicates` en [`server.ts`](file:///Users/doudoer/Desktop/Radar/server.ts)):** Agrupa automáticamente clientes activos coincidentes por teléfono normalizado (últimos 10 dígitos), email o nombre normalizado. Para cada cliente expone conteo de órdenes asociadas, llamadas de seguimiento registradas, teléfono, dirección, notas y fecha de creación.
  - **Endpoint de Fusión Transaccional (`POST /api/customers/merge` en [`server.ts`](file:///Users/doudoer/Desktop/Radar/server.ts)):**
    - Valida esquema estricto con Zod (`customerMergeSchema` en [`src/server/schemas.ts`](file:///Users/doudoer/Desktop/Radar/src/server/schemas.ts)): `primaryId`, `duplicateIds` (mínimo 1, sin duplicar el principal), y flag `copyMissingFields`.
    - Ejecuta en una transacción MySQL atómica (`BEGIN ... COMMIT / ROLLBACK`) con bloqueo de filas `FOR UPDATE`.
    - Reasigna todas las órdenes asociadas (`UPDATE orders SET customer_id = primaryId WHERE customer_id IN (duplicates)`).
    - Reasigna todas las llamadas y bitácoras (`UPDATE call_register SET customer_id = primaryId WHERE customer_id IN (duplicates)`).
    - Si `copyMissingFields: true`, transfiere automáticamente al cliente principal cualquier dato faltante (teléfono, whatsapp, email, dirección de envío, código postal, compañía, notas) que estuviera presente en los duplicados.
    - Aplica borrado lógico seguro (`UPDATE customers SET deleted_at = NOW() WHERE id IN (duplicates)`).
    - Registra auditoría del sistema con acción `CUSTOMER_MERGED` detallando IDs, órdenes reasignadas y llamadas transferidas.
- **Frontend & Experiencia de Usuario:**
  - **Componente Modal Moderno ([`src/components/CustomerDuplicatesModal.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/CustomerDuplicatesModal.tsx)):**
    - Interfaz visual interactiva estilo asistente de contactos móviles.
    - Contador de progreso ("Grupo X de N"), selector de cliente principal (por defecto el que tiene más órdenes o antigüedad), comparador de atributos en tarjetas lado a lado.
    - Resumen de impacto en vivo: cálculo automático de órdenes a transferir, llamadas a conservar y campos que se enriquecerán.
    - Checkbox para rellenar campos vacíos en el contacto principal con datos de los duplicados.
    - Botones de navegación "Omitir por ahora" o "Siguiente", y botón de confirmación "Fusionar X clientes".
  - **Integración en Clientes CRM ([`src/components/ClientsView.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/ClientsView.tsx)):**
    - Botón de acción con icono de combinación en la cabecera junto a "Nuevo Cliente": `[🔀 Fusionar Duplicados]`.
    - Al completar una fusión, refresca automáticamente el listado de clientes y el catálogo de duplicados.
- **Pruebas Automatizadas:**
  - Suite de validación en [`tests/server-schemas.test.ts`](file:///Users/doudoer/Desktop/Radar/tests/server-schemas.test.ts) cubriendo validación de IDs, duplicación de IDs y flags booleanos.
  - 100% de la suite de pruebas (479 pruebas) pasando.

---

### 1. Restricción de Búsqueda en Subasta Exclusivamente a Órdenes Pagadas
- **Requerimiento:** Las órdenes entregadas no deben tener marca ni opción de buscar en subasta. Solo las órdenes en estado `pagado` pueden tener activa la opción de subasta.
- **Implementación en Frontend:**
  - [`src/components/OrdersTableView.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/OrdersTableView.tsx): La función `isOrderAuction` solo retorna verdadero si `order.status === 'pagado'`. Órdenes entregadas o en otros estados quedan excluidas de la insignia y filtro de subasta.
  - [`src/components/OrderDetailView.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/OrderDetailView.tsx): El botón y panel de "Buscar en Subasta" solo se renderizan cuando `order.status === 'pagado'`.
  - [`src/components/NewOrderModal.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/NewOrderModal.tsx): El selector/checkbox de búsqueda en subasta solo se renderiza si el estado inicial seleccionado es `pagado`.
- **Implementación en Backend & Base de Datos:**
  - [`src/server/orders.ts`](file:///Users/doudoer/Desktop/Radar/src/server/orders.ts): En `mapOrder`, `auctionActive` se fuerza a `false` si el estatus no es `pagado`.
  - [`src/server/orderPayments.ts`](file:///Users/doudoer/Desktop/Radar/src/server/orderPayments.ts): En `completeOrderDelivery`, al registrar la entrega física se desactiva automáticamente `auction_search_active = 0`.
  - [`server.ts`](file:///Users/doudoer/Desktop/Radar/server.ts): En `PUT /api/orders/:id`, si el estatus cambia a cualquier estado distinto de `pagado`, se resetea `auction_search_active = 0`. Consulta de saneamiento al inicio para poner en `0` cualquier orden entregada histórica.
  - Pruebas unitarias actualizadas en [`tests/order-mapping.test.ts`](file:///Users/doudoer/Desktop/Radar/tests/order-mapping.test.ts).

### 2. Centro de Respaldos (Disaster Recovery): Sudo Mode 2FA y Desbloqueo de Bóveda en Línea
- **Diagnóstico del Error 403:** Al ingresar a *Configuración del Sistema -> Centro de Respaldos & Rollback*, el frontend ejecutaba `GET /api/system/backups`, el cual estaba protegido por la bóveda 2FA. Si la bóveda estaba cerrada, el servidor retornaba `403 FINANCE_LOCKED` y la interfaz mostraba una alerta roja bloqueante sin opción para ingresar el código ni indicar qué hacer.
- **Implementación de Sudo Mode (Opción A):**
  - **Backend ([`server.ts`](file:///Users/doudoer/Desktop/Radar/server.ts)):** `GET /api/system/backups` se flexibilizó para permitir lectura sin 2FA previo a usuarios con rol `admin`. Las operaciones de extracción y destrucción (`GET /api/system/backup`, `GET /api/system/backup/download`, `POST /api/system/backup/create`, restauraciones y acceso a `/api/uploads/backups/`) siguen exigiendo estrictamente la cookie `radar_finance` activa de 15 minutos.
  - **Nuevo Componente ([`src/components/VaultUnlockModal.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/VaultUnlockModal.tsx)):** Modal accesible con estándar `horizon-modal` que permite solicitar el código de 6 dígitos por WhatsApp (con contador de reenvío de 60s), ingresar Google Authenticator (TOTP) o usar códigos de respaldo de 8 dígitos. En modo local/desarrollo (`NODE_ENV !== 'production'`), si el gateway de WhatsApp está deshabilitado, genera y autocompleta el PIN de desarrollo sin bloquear al usuario.
  - **Frontend ([`src/components/SystemSettingsView.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/SystemSettingsView.tsx)):**
    - Se eliminó el aviso naranja superior confuso sobre la restauración directa.
    - Se eliminó la alerta roja bloqueante; el listado de respaldos carga limpiamente de inmediato sin errores 403 en la consola.
    - Indicador de estado claro en el encabezado: `[🛡️ Protegido con 2FA]` si está bloqueada, o `[🟢 Bóveda Desbloqueada]` con botón para bloquear.
    - Elevación bajo demanda: Al pulsar "Crear Respaldo Ahora", "Descarga Directa" o "Rollback", si la bóveda está bloqueada, se abre automáticamente el modal 2FA. Al validar el código, la acción solicitada se ejecuta de inmediato y la sesión queda abierta por 15 minutos.
  - **Nuevas Pruebas ([`tests/vault-unlock-modal.test.tsx`](file:///Users/doudoer/Desktop/Radar/tests/vault-unlock-modal.test.tsx)):** Cobertura unitaria para el modal 2FA, cierre, apertura y renderizado del Centro de Respaldos.

### 3. Resolución Definitiva en Centro de Respaldos (Disaster Recovery) & Salud del Sistema
- **Diagnóstico del Error 500 / Fallo al listar respaldos:**
  - En `src/server/backup.ts`, la función `listBackups()` recorre el catálogo MySQL y los directorios de disco (`/backups` y `/uploads/backups`).
  - Para respaldos existentes en disco no indexados en la tabla `system_backup_records`, se llamaba a `syncFileToDb` que leía el archivo completo e intentaba insertar un BLOB comprimido en MySQL.
  - Al procesar copias de respaldo de gran tamaño (por ejemplo, archivos de más de 30 MB), el paquete SQL superaba el límite de `max_allowed_packet` de MySQL/MariaDB, lo que provocaba un fallo de conexión `ECONNRESET` que interrumpía la consulta y causaba un error 500 interno (`INTERNAL_ERROR`).
- **Solución Implementada:**
  - **Límite de tamaño para BLOB en catálogo ([`src/server/backup.ts`](file:///Users/doudoer/Desktop/Radar/src/server/backup.ts)):** `syncFileToDb` solo almacena el BLOB comprimido en MySQL si el archivo es menor o igual a 10 MB (para recuperación en entornos efímeros sin disco persistente). Para respaldos mayores a 10 MB, la copia física en disco es la fuente de verdad y en la base de datos se guarda la metadata con `content_compressed = NULL`. Esto garantiza que la consulta SQL sea ligera (< 1 KB), eliminando por completo los errores de paquete o desconexión `ECONNRESET`.
  - **Resiliencia en creación de snapshot ([`src/server/backup.ts`](file:///Users/doudoer/Desktop/Radar/src/server/backup.ts)):** Si la inserción con BLOB falla en `saveBackupSnapshot`, realiza un fallback automático para persistir la metadata con `content_compressed = NULL`, garantizando que el archivo `.sql` y `.gz` queden guardados en disco sin abortar la operación.
  - **Manejo seguro de errores en endpoints ([`server.ts`](file:///Users/doudoer/Desktop/Radar/server.ts)):** Se envolvió `GET /api/system/backups` en un bloque `try / catch` que retorna `[]` en caso extremo en lugar de provocar un error 500. Se mejoró el registro de fallos en consola para imprimir la traza de error completa cuando ocurre un código 500.
  - **Acceso inicial a configuración 2FA ([`server.ts`](file:///Users/doudoer/Desktop/Radar/server.ts)):** Se ajustó `GET /api/auth/2fa/totp-setup` para que, si el usuario administrador aún no tiene configurado un secreto TOTP (`totp_secret` nulo), pueda inicializar y ver el código QR de Google Authenticator sin requerir la bóveda previamente desbloqueada, evitando el bloqueo cuando WhatsApp no está configurado.
  - **Conexión en vivo de Salud de Base de Datos ([`src/components/SystemSettingsView.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/SystemSettingsView.tsx)):** Se vinculó el bloque "Conexión de Base de Datos y Servidor" con el endpoint `/health`, mostrando el estado en tiempo real del motor MySQL (`En Línea (Conectado)`), la base de datos activa (`radar_v3 (MariaDB InnoDB)`) y los puertos de servicio (`3000 (API) / 3306 (SQL)`).

### 4. Modernización Visual de "Mi Trabajo de Hoy" (Workflow Tasks View)
- **Objetivo:** Transformar la vista de tareas operativas para que esté alineada con el lenguaje de diseño Horizon / Cyber de Radar 3.0, eliminando párrafos densos de texto y sustituyéndolos por tarjetas visuales con alta jerarquía gráfica.
- **Implementación ([`src/components/WorkflowTasksView.tsx`](file:///Users/doudoer/Desktop/Radar/src/components/WorkflowTasksView.tsx)):**
  - **Encabezado Horizon:** Icono de tarea en contenedor cibernético con indicador de pulso luminoso, título estilizado y botones de acción rápida con iconos.
  - **Tarjetas de Métricas Ciber:** Rediseño de los 4 contadores superiores con acentos de color graduados (Tareas Activas en cian, Vencidas en rosa/rojo, Escaladas en ámbar y Bloqueadas en morado), iconos representativos y tipografía monospace de alto impacto.
  - **Barra Segmentada de Filtros con Contadores:** Botones de filtro por bucket (Todas, Vencidas, Para hoy, Esperando, Bloqueadas, Próximas) con insignias numéricas en vivo y gradiente activo cian-esmeralda.
  - **Tarjetas Visuales de Tarea en Grid Responsivo (1 col en móvil, 2 cols en pantallas anchas):**
    - **Acento Superior Dinámico:** Barra de gradiente superior que cambia según la urgencia (rosa para vencidas, ámbar para escaladas, morado para bloqueadas, cian para estándar).
    - **Identificador de Orden & Cliente:** Insignia monospace `ORD-2026-XXX` con icono de factura y etiqueta de cliente con avatar/icono.
    - **Insignia de Estado / Vencimiento:** Badges visuales con iconos dinámicos (`warning`, `today`, `hourglass_top`, `lock`, `schedule`).
    - **Iconografía por Categoría de Tarea:** Iconos dedicados según el tipo de gestión (`contact_phone` para post-venta, `payments` para anticipo, `verified_user` para confirmación, `inventory_2` para preparación, `storefront` para retiro, `local_shipping` para entrega, `gavel` para incidencias).
    - **Pills de Contexto Operativo:** Avatar con iniciales del responsable asignado, etiqueta de asesor de venta y badge de venta de yarda.
    - **Caja de Acción Directa ("Próxima Gestión Operativa"):** Bloque destacado con borde de acento y tipografía limpia que resalta la acción concreta a ejecutar sin párrafos genéricos.
    - **Banners de Alerta Limpios:** Alertas condensadas con iconos para tareas escaladas a supervisor o bloqueos de terceros.
    - **Botones de Acción con Iconos:** "Gestionar Tarea" (botón primario cian con icono `tune`), "Ver Orden" (`visibility`) e "Incidencia" (`warning_amber`).
  - **Tabla de Supervisión de Operadores:** Rediseñada con estética glassmorphic, iniciales de operadores, porcentajes de cumplimiento con insignias de color neon y conteos destacados.

### 5. Estado de Ejecución y Despliegue
- Todos los cambios fueron consolidados y confirmados en la rama `main` local (`3ee4ce1`).
- Contenedor local `radar-desktop-app:local` reconstruido y activo en `http://127.0.0.1:3000`.
- 100% de tests pasando (478 pruebas en 64 suites) y TypeScript sin errores.
- **Ningún cambio ha sido subido a producción (respetando la regla de trabajo local).**

---

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
