# 📍 CHECKPOINT RADAR 3.0 — 2026-10-01

**Fecha y Hora:** 1 de Octubre, 2026 — 14:50 UTC-4  
**Rama:** `main`  
**Último Commit:** `20b12a8` (`feat(orders): add pagination with 10/20/30/50/100 page size selector`)  
**Estado del Repositorio:** Limpio, sincronizado con `origin/main`  

---

## 🚀 1. Resumen de lo Realizado en esta Sesión

### A. Corrección en la Creación de Órdenes (MySQL DB)
- **Problema corregido:** Error `"no se pudo guardar la orden en la db"` al crear órdenes.
- **Causa raíz:** Incompatibilidad con el campo `transmission_type` en MySQL (requería `'AT'`, `'MT'` o `NULL`) y manejo de IDs de cliente simulados (`CUST-`).
- **Solución implementada:**
  - Normalización segura de tipo de transmisión (`mapTransmissionType`) en `server.ts` y `src/server/orders.ts`.
  - Creación y resolución automática de clientes reales en la tabla `customers` sin mock IDs.
  - Protección de respaldo y restauración automática intacta (`src/server/backup.ts`).

### B. Paginación en la Lista de Órdenes (`OrdersTableView.tsx`)
- **Funcionalidad:** Paginación completa con selector de tamaño.
- **Opciones de selector:** `10`, `20`, `30`, `50`, `100` órdenes por página.
- **Por defecto:** `10` órdenes.
- **Comportamiento:** Reseteo a la página 1 al cambiar de vista/pestaña o al buscar. Controles de primera, anterior, números dinámicos con brillo, siguiente y última página.

### C. Diagnóstico de la Bitácora de Reclamos (`ClaimsView.tsx` / `ClaimDetailView.tsx`)
- **Diagnóstico:** El botón *"Ver Bitácora de Llamadas"* en el detalle individual (`ClaimDetailView`) no abría el modal porque `ClaimsView.tsx` retornaba antes de montar el componente del modal.
- **Estado pendiente:** Integrar el modal y/o panel de bitácora directamente en `ClaimDetailView.tsx`.

### D. Optimización Integral para Chromebooks / ChromeOS & Google Chrome
- **Problema corregido:** En Chromebooks (resoluciones 1366x768, 1280x800 o 1080p con escalado al 125%/150%), la barra de ChromeOS y la barra del navegador dejaban un viewport vertical muy reducido (~550px - 650px), provocando que los modales cortaran los botones de acción inferiores, las tablas se comprimieran sin scroll horizontal y el texto de datos clave no fuera seleccionable.
- **Solución implementada:**
  1. **Contenedores de Modales Flexibles:** Todos los modales ahora implementan `max-h-[min(94vh, 600px-740px)] flex flex-col overflow-hidden` con cabeceras fijas (`shrink-0`), cuerpos con scroll suave (`flex-1 min-h-0 overflow-y-auto custom-scrollbar`) y barras de botones de acción fijadas (`shrink-0`).
  2. **Tablas Responsivas con Scroll Horizontal:** Envoltura con `.table-responsive-wrapper.custom-scrollbar` y anchos mínimos (`min-w-[700px]` - `min-w-[960px]`) en `OrdersTableView`, `ClientsView`, `ClaimsView`, `InventoryView`, `WeeklyRelationView`, `OperationsView`, `UsersManagementView` y `DashboardView`.
  3. **Sidebar y TopHeader Adaptativos:** Ajuste de paddings y espaciado vertical para que los 9 enlaces de navegación y la insignia Sentinel quepan completos en 768px de alto sin scroll forzado.
  4. **Aceleración GPU & Rendimiento:** Reducción de filtros de desenfoque excesivos (`blur-[140px]/[150px]` a `blur-[60px]`), adición de `transform: translateZ(0)` y `@media (max-height: 800px)` en CSS global.
  5. **Habilitación de Selección de Texto:** Remoción de `select-none` global en vistas de datos para permitir copiar VINs, códigos de orden, teléfonos y montos sin trabas.

---

## 🧪 2. Estado de Pruebas y Tipos

- **Unit Tests:** `29 / 29 passing` (`npm test`)
- **TypeScript:** `0 errors` (`npx tsc --noEmit`)
- **Base de Datos:** MySQL `radar-mysql` activa en `127.0.0.1:3306`
- **Servidores Locales:** Backend API en `:3001` y Vite Frontend en `:3000` activos

---

## 🛠️ 3. Guía Rápida para Continuar en Visual Studio Code

### Iniciar Servicios Locales

1. **Docker / Base de datos:**
   ```bash
   docker start radar-mysql
   ```

2. **Backend API (Puerto 3001):**
   ```bash
   npm run api
   ```

3. **Frontend Vite (Puerto 3000):**
   ```bash
   npm run dev
   ```

4. **Ejecutar Pruebas:**
   ```bash
   npm test
   ```

---

## 📂 4. Mapa de Archivos Relevantes

| Archivo | Rol / Descripción |
| --- | --- |
| `src/components/OrdersTableView.tsx` | Tabla de órdenes con paginación 10/20/30/50/100 |
| `src/components/ClaimDetailView.tsx` | Vista de detalle de reclamo |
| `src/components/ClaimsView.tsx` | Módulo principal de reclamos y modal de bitácora de llamadas |
| `src/server/orders.ts` | Mapeo y consultas MySQL de órdenes |
| `src/server/claims.ts` | Consultas de reclamos y registro de llamadas (`call_register`) |
| `src/server/backup.ts` | Lógica de respaldo y restauración protegida |
| `server.ts` | Servidor API REST Node.js |
