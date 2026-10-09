# 🛡️ RADAR 3.0 • INFORME INTEGRAL DE SEGURIDAD, MODULARIZACIÓN Y ARQUITECTURA

**Fecha de Auditoría:** Octubre 2026  
**Sistema:** Radar 3.0 (Control Rodriguez Salvage Yard)  
**Estado General:** ✅ **BLINDADO Y VALIDADO (85/85 Pruebas Unitarias Pasadas)**

---

## 1. Resumen Ejecutivo

Este documento consolida el análisis exhaustivo de seguridad, arquitectura modular y sistema de archivos realizado sobre **RADAR 3.0**. Tras la ejecución del plan de blindaje de 4 fases, el sistema ha sido reforzado frente a amenazas contemporáneas como inyecciones SQL, ejecución remota de código (RCE), fuerza bruta, condiciones de carrera en respaldos, degradación no autorizada de cuentas y accesos no auditados.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RADAR 3.0 SECURITY MATRIX                       │
├────────────────────────┬─────────────────────┬─────────────────────────┤
│ Capa                   │ Nivel de Riesgo     │ Estado de Mitigación    │
├────────────────────────┼─────────────────────┼─────────────────────────┤
│ Autenticación & Sesión │ Crítico             │ ✅ Blindado (2FA + JWT) │
│ Inyección SQL & Params │ Crítico             │ ✅ 100% Parametrizado   │
│ Subida de Archivos     │ Alto                │ ✅ Magic Bytes + MIME   │
│ Respaldos & Restore    │ Alto                │ ✅ Mutex Lock + Audit   │
│ Trazabilidad Forense   │ Medio               │ ✅ Tabla inmutable      │
│ Notificaciones Alerta  │ Medio               │ ✅ WhatsApp Automático  │
└────────────────────────┴─────────────────────┴─────────────────────────┘
```

---

## 2. Auditoría de Seguridad & Mitigación de Vulnerabilidades (OWASP Top 10)

### 2.1. A01: Control de Acceso Roto (Broken Access Control)
- **Vulnerabilidad Previa:** Posibilidad de que un usuario modifique o degrade su propia cuenta de administrador o acceda a módulos financieros sin doble factor.
- **Mitigaciones Implementadas:**
  - `requireRole(response, claims, 'admin')`: Enrutamiento estricto por roles a nivel de endpoint.
  - Validación de integridad en `/api/users/:id`: Bloquea auto-degradación o auto-desactivación de administradores.
  - Puerta 2FA para el módulo de Relación Semanal & Finanzas con caducidad estricta de 60 segundos y consumo único.

### 2.2. A02: Fallas Criptográficas & Sesión (Cryptographic Failures)
- **Vulnerabilidad Previa:** Secretos JWT débiles en despliegues desatendidos o almacenamiento en `localStorage` susceptible a XSS.
- **Mitigaciones Implementadas:**
  - **Cookies de Sesión:** `HttpOnly`, `SameSite=Strict` y soporte condicional `Secure` en producción.
  - **Entropía de Clave:** Verificación automática en el arranque (`config.ts`) que rechaza `JWT_SECRET` con longitud inferior a 32 caracteres en entornos de producción.
  - **Generador Criptográfico:** Generación de OTPs mediante `crypto.randomInt(100000, 1000000)` en lugar de `Math.random()`.

### 2.3. A03: Inyección (SQL & Path Traversal)
- **Vulnerabilidad Previa:** Consultas dinámicas o concatenación de nombres de archivo en descargas y subidas.
- **Mitigaciones Implementadas:**
  - **SQL:** Todas las consultas en `server.ts`, `orders.ts`, `claims.ts`, `notes.ts` y `audit.ts` utilizan sentencias preparadas parametrizadas con `mysql2/promise`.
  - **Path Traversal en Archivos Estáticos:** `serveFrontend` valida canónicamente que la ruta resuelta pertenezca al árbol `frontendRoot` (`candidate.startsWith(...)`).
  - **Path Traversal en Uploads y Respaldos:** Uso forzado de `path.basename()` antes de interactuar con el sistema de archivos, eliminando cualquier vector de tipo `../../`.

### 2.4. A04: Diseño Inseguro & Condiciones de Carrera (Race Conditions)
- **Vulnerabilidad Previa:** Ejecución simultánea de dos procesos de respaldo/restauración de base de datos que pudiera corromper las tablas operativas.
- **Mitigaciones Implementadas:**
  - **Mutex Concurrency Locking:** `acquireBackupLock()` y `releaseBackupLock()` en `src/server/backup.ts`. Si una operación está en curso, cualquier solicitud concurrente es rechazada inmediatamente con error 409/Error de Bloqueo.

### 2.5. A05: Configuración de Seguridad & Denegación de Servicio (DoS)
- **Vulnerabilidad Previa:** Ataques de fuerza bruta a login sin límite de tasa por IP.
- **Mitigaciones Implementadas:**
  - **Rate Limiting en Memoria:** Límite estricto de 10 intentos fallidos por ventana de 15 minutos por IP (`src/server/auth.ts`).
  - **Límite de Carga Útil:** Límite máximo de `maxBodyBytes` (25MB para JSON general, 60MB exclusivo para restauración de backups).
  - **Límite de Resultados:** `getOrders` acotado con `LIMIT 5000` (máximo configurable 10,000) para evitar colapso de memoria del proceso Node.

### 2.6. A06: Manejo Seguro de Archivos Subidos (Unrestricted File Upload)
- **Vulnerabilidad Previa:** Evasión de extensiones mediante nombres compuestos (ej. `shell.php.png`) o archivos binarios ejecutables disfrazados.
- **Mitigaciones Implementadas:**
  - **MIME to Extension Mapping:** La extensión debe coincidir exactamente con el Content-Type declarado (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.pdf`, `.txt`, `.csv`).
  - **Filtro de Extensiones Peligrosas:** Bloqueo explícito de extensiones secundarias (`.php`, `.phtml`, `.exe`, `.sh`, `.bat`, `.cmd`, `.js`, `.py`, etc.).
  - **Verificación de Magic Bytes:** Validación binaria de cabeceras de archivo (ej. `\x89PNG\r\n\x1a\n` para PNG, `\xFF\xD8\xFF` para JPEG, `%PDF` para PDF).
  - **Aislamiento NGINX:** La plantilla `deploy/nginx-radar.conf` desactiva la ejecución de scripts dentro del directorio `/uploads/`.

### 2.7. A07: Trazabilidad y Alertas en Tiempo Real
- **Vulnerabilidad Previa:** Intentos de intrusión silenciosos sin registro persistente.
- **Mitigaciones Implementadas:**
  - **Tabla `audit_logs`:** Almacenamiento inmutable indexado por `action`, `user_id` y `created_at`.
  - **Alerta Inmediata vía WhatsApp:** Si se registran **3 fallos consecutivos de 2FA**, el sistema despacha automáticamente una alerta crítica (`ALERTA_SEGURIDAD`) al Super Administrador por WhatsApp con la IP y el usuario objetivo.

---

## 3. Análisis de Modularización y Arquitectura

El proyecto Radar 3.0 sigue una estructura desacoplada y orientada a servicios:

```
radar-3.0/
├── deploy/                          # Plantillas de infraestructura y servidores web
│   └── nginx-radar.conf             # Configuración de NGINX con TLS 1.3 y HSTS
├── migrations/                      # Migraciones de base de datos SQL versionadas
│   ├── 001_initial_schema.sql
│   └── ... (009_users_phone_and_avatar.sql)
├── scripts/                         # Utilidades de mantenimiento y DevOps CLI
│   ├── run-backup.ts                # Runner CLI: npm run backup:now
│   ├── verify-backup-integrity.ts   # Verificador de integridad: npm run backup:verify
│   ├── sync-offsite-backups.sh      # Sincronización remota con cifrado AES-256
│   ├── security-check.ts            # Diagnóstico de seguridad: npm run security:check
│   └── setup-production-db-user.sql # Script de usuario MySQL de menor privilegio
├── src/
│   ├── components/                  # Componentes de interfaz de usuario (React 19)
│   │   ├── OrdersTableView.tsx      # Vista de órdenes, buscador, filtros por estatus/fechas
│   │   ├── ExportModal.tsx          # Modal de exportación filtrada a PDF/CSV
│   │   ├── SecurityOtpModal.tsx     # Modal de desbloqueo 2FA financiero
│   │   ├── ClaimsView.tsx           # Vista y gestión de reclamos de garantía
│   │   ├── WeeklyRelationView.tsx   # Relación semanal y finanzas
│   │   ├── SystemSettingsView.tsx   # Configuración, respaldos y diagnóstico
│   │   ├── UsersManagementView.tsx  # Administración de usuarios y roles
│   │   └── WasenderNotificationsManager.tsx # Enrutamiento WhatsApp
│   ├── integrations/
│   │   └── wasender/                # Integración con WhatsApp API (Wasender)
│   │       ├── client.ts            # Cliente HTTP con rate-limiting (5.1s entre envíos)
│   │       ├── notificationTypes.ts # 10 Canales de notificación y destinatarios
│   │       ├── notificationTemplates.ts # Plantillas de mensaje con emojis y formatos
│   │       └── notificationService.ts # Orquestador y planificador diario (08:00 AM)
│   ├── server/                      # Capa de servicios backend
│   │   ├── config.ts                # Variables de entorno y conexión MySQL pool
│   │   ├── auth.ts                  # Autenticación JWT, cookies y rate-limit
│   │   ├── schemas.ts               # Validación de esquemas con Zod
│   │   ├── http.ts                  # Utilidades HTTP y servidor estático seguro
│   │   ├── orders.ts                # Dominio de órdenes y mapeo relacional
│   │   ├── claims.ts                # Dominio de reclamos y garantías
│   │   ├── backup.ts                # Motor de respaldo, restauración y Mutex lock
│   │   ├── audit.ts                 # Servicio de auditoría forense inmutable
│   │   └── notes.ts                 # Notas y mensajería interna
│   └── utils/                       # Utilidades transversales y generadores PDF
│       ├── ordersReportPdf.ts       # Generación de listado de órdenes en PDF (pdf-lib)
│       ├── weeklyRelationPdf.ts     # Generación de Formato Oficial de Entregas PDF
│       └── orderStatusRules.ts      # Reglas de negocio para transiciones de estado
├── tests/                           # Suite de pruebas automatizadas (Vitest)
│   ├── audit-and-security-alerts.test.ts
│   ├── backup-restore.test.ts
│   ├── financial-2fa.test.ts
│   ├── orders-export-modal.test.tsx
│   ├── orders-table-filters.test.tsx
│   ├── security-hardening.test.ts
│   ├── wasender-notification-routing.test.ts
│   └── weekly-relation-pdf.test.ts
├── server.ts                        # Enrutador principal y API Server Node.js
└── package.json                     # Scripts y dependencias
```

---

## 4. Auditoría del Sistema de Archivos y Almacenamiento

| Directorio | Propósito | Medidas de Seguridad Aplicadas |
| :--- | :--- | :--- |
| `/uploads/` | Archivos adjuntos y fotos de inventario | Sanitización de nombres con regex `[^a-zA-Z0-9._-]`, validación Magic Bytes, denegación de ejecución de scripts vía NGINX. |
| `/backups/` | Copias de seguridad SQL locales | Acceso restringido exclusivamente a administradores (`GET /api/system/backup/download`), verificación de extensión obligatoria `.sql`, cifrado simétrico AES-256 para transferencia fuera de sitio. |
| `/dist/` | Build de producción frontend | Servido mediante `serveFrontend` con verificación estricta de límites de directorio (anti Path Traversal). |

---

## 5. Resumen de Pruebas Unitarias

Se ejecutaron las **15 suites de pruebas automatizadas**, con un resultado de **85 pruebas pasadas y 0 fallos**:

```
✓ tests/server-schemas.test.ts (17 tests)
✓ tests/wasender-notification-routing.test.ts (6 tests)
✓ tests/audit-and-security-alerts.test.ts (6 tests)
✓ tests/backup-restore.test.ts (9 tests)
✓ tests/orders-table-filters.test.tsx (2 tests)
✓ tests/order-mapping.test.ts (6 tests)
✓ tests/claim-calls-modal.test.tsx (2 tests)
✓ tests/security-hardening.test.ts (5 tests)
✓ tests/weekly-relation.test.ts (8 tests)
✓ tests/weekly-relation-pdf.test.ts (4 tests)
✓ tests/financial-2fa.test.ts (5 tests)
✓ tests/orders-export-modal.test.tsx (2 tests)
✓ tests/order-status-rules.test.ts (4 tests)
✓ tests/quick-sms-modal.test.ts (5 tests)
✓ tests/operations-analytics.test.ts (4 tests)

Test Files  15 passed (15)
Tests       85 passed (85)
```

---

## 6. Comandos Operativos y Mantenimiento

Para la administración diaria del sistema en producción:

- **Diagnóstico de Seguridad del Entorno:**
  ```bash
  npm run security:check
  ```
- **Generar Respaldo Manual Inmediato con Notificación WhatsApp:**
  ```bash
  npm run backup:now
  ```
- **Verificar la Integridad del Respaldo más Reciente:**
  ```bash
  npm run backup:verify
  ```
- **Sincronizar y Cifrar Respaldos Fuera de Sitio:**
  ```bash
  BACKUP_ENCRYPTION_KEY="clave-segura" ./scripts/sync-offsite-backups.sh user@servidor-remoto:/var/backups/radar/
  ```
- **Ejecutar Suite de Pruebas Automatizadas:**
  ```bash
  npm test
  ```
- **Verificación de Tipos TypeScript:**
  ```bash
  npm run lint
  ```
