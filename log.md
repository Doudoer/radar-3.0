# Radar 3.0 - Registro de continuidad

Actualizado: 2026-09-19

## Punto actual

- Proyecto: `/Users/user/Desktop/Radar V3/radar-3.0`
- Rama: `main`
- Produccion: `https://radar-rsy.store/`
- Produccion sigue administrada por Dokploy en el VPS.
- Docker Desktop se usa para desarrollo local en esta Mac (`radar-mysql` en `127.0.0.1:3306`).
- **No se ha hecho push al remoto.**
- `origin/main` permanece en `d57a1a6`.
- **Base de datos MAMP migrada**: Se importó la base de datos real local de MAMP (`radar_v3` / `radar_db`) dentro del contenedor Docker `radar-mysql`.

---

## Estado de Datos Importados de MAMP a Docker MySQL

Se extrajo y migró toda la data real desde `/Applications/MAMP/db/mysql80`:
- **539 Órdenes reales** con historial, precios, piezas y estados.
- **488 Clientes reales** registrados en CRM.
- **83 Reclamos reales**.
- **44 Llamadas registradas** en bitácora.
- **6 Colaboradores / Usuarios reales** (System Admin `admin@radar.com`, Favio Andrade, Darrel Machado, Williana Fereira, David Isea, etc.).

---

## Funcionalidad de Cambio y Creación de Contraseña con Política de Seguridad

- **Política de contraseñas aplicada en Backend y Frontend ([src/server/schemas.ts](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/server/schemas.ts))**:
  - **Mínimo 8 caracteres**.
  - **Letras mayúsculas (A-Z)**.
  - **Letras minúsculas (a-z)**.
  - **Dígitos numéricos (0-9)**.
  - **Signos o puntos (. ! @ # $ % & * etc.)**.
- **Modal interactivo ([src/components/ChangePasswordModal.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/ChangePasswordModal.tsx))**:
  - Validación en tiempo real con checklist visual interactivo de los 5 requisitos y coincidencia de confirmación.
  - Opción de mostrar/ocultar contraseña.
  - Integrado en la barra superior ([src/components/TopHeader.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/TopHeader.tsx)) en el botón de perfil con ícono de llave y en el panel de [src/components/SystemSettingsView.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/SystemSettingsView.tsx) bajo "Seguridad & Permisos".
  - Endpoint backend seguro: `POST /api/auth/change-password` con hash bcrypt.
- **Gestión de Colaboradores ([src/components/UsersManagementView.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/UsersManagementView.tsx))**:
  - Creación de nuevos usuarios sujeta a la misma política de 8+ caracteres con validación interactiva.

---

## Redirección Automática por Expiración de Sesión

- **Interceptador Centralizado ([src/services/apiFetch.ts](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/services/apiFetch.ts))**:
  - Cualquier respuesta `401 Unauthorized` de la API (por token expirado, cookie revocada o cambio de contraseña) dispara automáticamente el evento global `radar:unauthorized` y limpia `sessionStorage`.
- **Manejador de Estado de Sesión ([src/hooks/useAuthSession.ts](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/hooks/useAuthSession.ts))**:
  - Escucha `radar:unauthorized` y resetea inmediatamente `authenticated = false` y `user = null`.
- **Vista Login Automática ([src/App.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/App.tsx))**:
  - Al no haber sesión válida activa, la aplicación cambia instantáneamente a `<LoginView />` sin dejar vistas estancadas ni mensajes de alerta obsoletos en el Dashboard.

---

## Restricción y Verificación 2FA en "Relación Semanal" (Solo Administrador)

- **Panel Lateral ([src/components/Sidebar.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/Sidebar.tsx))**:
  - El botón "Relación Semanal" está oculto para operadores regulares y solo se muestra si el usuario tiene rol `admin`.
- **Buscador Rápido ([src/components/SearchModal.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/SearchModal.tsx))**:
  - El acceso directo a finanzas se oculta a usuarios operadores.
- **Rutas de Vista ([src/App.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/App.tsx))**:
  - Intento de navegación a `relacion_semanal` o `finanzas` por usuarios no administradores es bloqueado y redirigido al Dashboard.
- **Barrera 2FA Renovada con Estilo Cyberpunk / Glassmorphism Neón ([src/components/WeeklyRelationView.tsx](file:///Users/user/Desktop/Radar%20V3/radar-3.0/src/components/WeeklyRelationView.tsx))**:
  - **Grid de 6 Casillas de PIN Segmentadas**: Inputs generosos con foco iluminado en cian neón, punto separador central `•`, avance automático entre casillas, retroceso con Backspace, pegado completo (`Ctrl+V`/`Cmd+V`) y **auto-verificación inmediata al ingresar el 6º dígito**.
  - **Escáner Holográfico Animado**: Escudo central con anillos de órbita concéntricos giratorios (`animate-cyber-orbit`), haz de luz láser de escaneo vertical (`animate-cyber-scan`) y reacciones visuales según el estado (giro en emisión, vibración en error, resplandor esmeralda al desbloquear).
  - **Módulo de Transmisión WhatsApp Wasender**: Pod con diseño oficial WhatsApp, indicador de gateway en línea, número enmascarado `+58 412-***7933` y botón dinámico con temporizador de cuenta regresiva `(Reenviar en 60s)`.
  - **Toast Interactivo con Asistente Rápido**: Notificación flotante superior con el PIN emitido y botón `[ ⚡ Insertar PIN ]` para auto-completar el código al instante.
  - **Opción de Retorno**: Botón para regresar al Dashboard principal si el usuario no cuenta con su teléfono en el momento.
  - **Seguridad Criptográfica**: Leyenda de pie de tarjeta con protocolo `SHA-256 E2EE • PROTOCOLO SENTINEL 2FA`.

---

## Credenciales de Acceso Local Activas

- **Usuario Administrador:** `admin@radar.com`
- **Contraseña:** `Admin.Radar2026!` *(Cumple con la política de seguridad: 8+ car, mayús, minús, dígito, signo/punto)*

---

## Resumen de la Auditoría y Correcciones Implementadas

### 1. Migración y Esquema de Base de Datos
- **Migración 001 & 002 aplicadas sobre data real**:
  - Asegurada la compatibilidad de foreign keys (`INT` firmado) con las tablas existentes de MAMP.
  - Tabla `refund_requests` para persistencia transaccional de reembolsos vinculados a órdenes.
  - Tablas de notas personales (`personal_notes`) y mensajes internos (`personal_messages`).
- **Configuración de Pool MySQL (`src/server/config.ts`)**:
  - `timezone: 'Z'` en el pool de `mysql2` para sincronización horaria precisa UTC/local.

### 2. Backend & Seguridad de la API (`server.ts`, `src/server/*`)
- **Gestión de Clientes (`/api/customers`)**: `GET`, `POST`, `PUT`, `DELETE` (soft delete) y cálculo de `order_count`.
- **Gestión de Reclamos y Llamadas (`/api/claims`, `/api/claims/:id/calls`)**: Apertura transaccional, bitácora en `call_register` y resolución/denegación con reversión de estado de orden.
- **Gestión de Reembolsos (`/api/refunds`)**: Creación, listado y actualización de estados.
- **Gestión de Usuarios y Contraseñas (`/api/users`, `/api/auth/change-password`)**: Gestión con bcrypt 12 rondas.
- **Subida de Archivos y Evidencias (`POST /api/upload`, `GET /uploads/:filename`)**: Almacenamiento seguro de fotos y comprobantes.
- **Motor de WhatsApp / Wasender (`POST /api/wasender/send`)**: Despacho automático y fallback con enlace `https://wa.me/...`.
- **Gomotive**: Removido por completo.

### 3. Frontend & Vistas
- **`ClientsView.tsx`, `ClaimsView.tsx`, `UsersManagementView.tsx`, `OperationsView.tsx`**: Conectados a endpoints reales sin mocks.
- **`FinanceView.tsx` & `ReportsView.tsx`**: Métricas dinámicas calculadas en tiempo real con las 539 órdenes reales importadas de MAMP.
- **`useRadarData.ts`**: Eliminado fallback estático cuando la BD está vacía.
- **Bundle Optimization**: Chunks aislados para `pdf-lib` y `vendor`.

---

---

## Rediseño Integral Cyberpunk / Glassmorphism Neón en Todo el Sistema

Se implementó y unificó la estética **Cyberpunk / Glassmorphism Neón** en toda la plataforma Radar 3.0:

### 1. Tokens Globales y Arquitectura de Estilos (`src/index.css`, `src/App.tsx`)
- Fondo Obsidian oscuro profundo `#050811` con rejilla holográfica de fondo `.cyber-grid-bg`.
- Halos de luz ambiental neón fijos (`bg-cyan-500/10` y `bg-indigo-600/10`) con `blur-[140px]`.
- Contenedores de cristal esmerilado `.cyber-card` con `backdrop-blur-2xl bg-[#070c18]/95 border border-cyan-500/30 shadow-[0_20px_60px_rgba(0,0,0,0.85)]`.
- Láseres superiores de luz cian/esmeralda `.cyber-laser-bar` con sombras resplandecientes.
- Tipografía técnica en monoespaciado para identificadores, métricas y telemetría.
- Botones de acción futuristas `.cyber-btn-primary` (degradados cian/azul con resplandor neón) y `.cyber-btn-secondary`.
- Badges de estado neón con luces piloto intermitentes (`.neon-badge-cyan`, `.neon-badge-emerald`, `.neon-badge-amber`, `.neon-badge-red`).

### 2. Estructura de Navegación y Shell
- **Sidebar (`src/components/Sidebar.tsx`)**: Emblema holográfico radar con anillos orbitales y animación de escaneo láser. Indicador de estado "SENTINEL ONLINE" con luz verde intermitente. Botones de navegación con píldoras de luz y contornos neón.
- **TopHeader (`src/components/TopHeader.tsx`)**: Barra de navegación flotante de cristal con borde inferior de luz láser, buscador interactivo con atajo `⌘K`, botón CTA de "Nueva Orden" con gradiente neón y píldora de perfil con menú de seguridad y cambio de contraseña.

### 3. Vistas y Módulos de la Plataforma
- **Login (`src/components/LoginView.tsx`)**: Escáner holográfico con tarjetas de cristal, inputs cian iluminados y botón de acceso futurista.
- **Dashboard (`src/components/DashboardView.tsx`)**: 4 pods HUD con telemetría en tiempo real, luces piloto, barras de volumen con micro-animaciones y tabla de telemetría de SLA.
- **Tabla de Órdenes (`src/components/OrdersTableView.tsx`)**: Chips de filtrado cian interactivos, contenedor de cristal con líneas de escaneo y badges luminosos.
- **Operaciones (`src/components/OperationsView.tsx`)**: 5 pods de telemetría y pestañas de segmentación con acentos cian y esmeralda.
- **Detalle de Orden (`src/components/OrderDetailView.tsx`)**: Encabezado HUD con breadcrumbs cian, selector de estado con luces piloto y pestañas con bordes de luz.
- **Clientes CRM (`src/components/ClientsView.tsx`)**: Tarjetas de cliente con avatars holográficos, contadores monoespaciados y barra de búsqueda flotante.
- **Reclamos y Bitácora (`src/components/ClaimsView.tsx`, `ClaimDetailView.tsx`)**: Módulo de tickets con badges de severidad neón, historial de llamadas interactivo, modal de registro y visor de evidencias.
- **Finanzas (`src/components/FinanceView.tsx`)**: Pods de balance y márgenes con glow esmeralda, flujo de transacciones en vivo y exportadores de datos.
- **Reportes (`src/components/ReportsView.tsx`)**: Medidores de cumplimiento SLA, velocímetro de CSAT y gráficos de rendimiento operativo.
- **Gestión de Usuarios (`src/components/UsersManagementView.tsx`)**: Matriz de accesos y roles, modal de nuevo colaborador con checklist en tiempo real de los 5 requisitos de contraseña segura.
- **Configuración del Sistema (`src/components/SystemSettingsView.tsx`)**: HUD de salud del servidor y exportador de respaldos de base de datos.
- **Relación Semanal (`src/components/WeeklyRelationView.tsx`)**: Barrera 2FA holográfica con 6 casillas de PIN animadas y tabla financiera desbloqueable.

### 4. Modales y Diálogos del Sistema
- **`SearchModal.tsx`**: Diálogo de búsqueda global con efecto backdrop-blur, tarjetas de accesos directos e inputs con borde láser.
- **`QuickSMSModal.tsx`**: Tarjetas bilingües con botones de WhatsApp en verde neón y telemetría de despacho.
- **`SecurityOtpModal.tsx`**: Diálogo de validación de PIN OTP con anillos concéntricos y bypass de seguridad.
- **`DispatchLabelModal.tsx`**: Visor de etiqueta térmica 4x6 con marco de cristal y acción de impresión.
- **`InvoiceModal.tsx`**: Contenedor de factura imprimible con controles de descarga y visualización.
- **`StatusRequestModal.tsx`**: Selector de rango de fechas y estados con lista de órdenes seleccionables.
- **`ChangePasswordModal.tsx`**: Checklist interactivo de requisitos de contraseña segura (8+ caracteres, mayúsculas, minúsculas, números y símbolos).
- **`ExportModal.tsx`**: Selector de formatos (CSV, JSON, PDF) con tarjetas interactivas de cristal.
- **`NewOrderModal.tsx`**: Creador multi-paso de órdenes (Vehículo y Pieza, CRM de Cliente, Finanzas y Despacho) con barra de acciones fija.

---

## Validación y Pruebas Realizadas

1. **Pruebas Unitarias (`npm test`)**: 18 pruebas pasando (100%).
2. **Tipado y Lint (`npm run lint`)**: 0 errores de TypeScript.
3. **Compilación Completa (`npm run build`)**: Vite y esbuild limpios sin errores.
4. **Daemon API Server**: Corriendo en segundo plano en puerto 3001 con MySQL conectado.
5. **Login Verificado**: `admin@radar.com` probado y autenticado correctamente.

---

## Cómo Iniciar el Entorno Local

```bash
# 1. Base de datos Docker
npm run db:up

# 2. Servidor API
set -a && source .env && set +a
PORT=3001 npm run api

# 3. Frontend
VITE_API_URL=http://127.0.0.1:3001/api npm run dev -- --host 127.0.0.1 --port 3000
```
Abrir `http://127.0.0.1:3000` o `http://127.0.0.1:3001`.

