# 🚀 MANUAL Y GUÍA DE USO: ECC (EVERYTHING CLAUDE CODE / AGENTS)

> **Ubicación de Configuración Global:** `/Users/user/.gemini/config/plugins/ecc`  
> **Integración:** Disponible globalmente para todos tus proyectos actuales y futuros en Antigravity IDE y Claude Code.

---

## 📌 ¿Qué es ECC y qué ventajas te da?

**ECC** es un ecosistema avanzado de ingeniería agéntica que añade:
1. **+290 Skills de Especialidad:** Patrones probados de frontend, backend, bases de datos, seguridad, rendimiento y arquitectura.
2. **+60 Agentes Especialistas:** Roles autónomos (Arquitecto, Auditor de Seguridad, QA Engineer, Diseñador UI/UX, etc.).
3. **+40 Flujos de Trabajo (Workflows):** Protocolos guiados para planificar, programar con TDD, revisar PRs, resolver bugs y optimizar.
4. **Reglas de Calidad Automáticas:** El asistente sigue automáticamente las mejores prácticas de TypeScript, React, SQL, APIs y testing sin que tengas que pedírselo cada vez.

---

## 🛠️ ¿Cómo se usan? (Modos de Uso)

Tienes **3 formas sencillas** de aprovechar todo el poder de ECC:

### 1. 💬 Por Lenguaje Natural (La forma más cómoda)
Solo dile al asistente lo que necesitas mencionando el enfoque o dejando que elija la mejor herramienta:
* *"Diseña la pantalla de pagos usando el skill de `modern-ui-ux-craftsman` con estética Cyberpunk Glassmorphism."*
* *"Revisa la seguridad de estos endpoints con `security-auditor` buscando vulnerabilidades OWASP."*
* *"Optimiza las consultas de MySQL y transacciones con `database-sql-engineer`."*

### 2. ⚡ Por Slash Commands / Workflows (Comandos directos)
Escribe el comando al inicio de tu mensaje para disparar un flujo automatizado paso a paso. *(Ver catálogo detallado abajo)*.

### 3. 🤖 Automático (En segundo plano)
Al estar instalado globalmente, el agente lee automáticamente las reglas de TypeScript, React, APIs y bases de datos al generar o refactorizar código, garantizando código limpio, seguro y tipado.

---

## 📋 Catálogo Principal de Comandos y Flujos (`/workflows`)

A continuación tienes los comandos más útiles clasificados por área con ejemplos prácticos:

### 🧠 1. Planificación y Arquitectura

| Comando | Función | Cuándo usarlo |
| :--- | :--- | :--- |
| `/plan` | **Planificación previa estricta.** Analiza requerimientos, detecta riesgos y desglosa pasos detallados. No toca código hasta que lo apruebas. | Para funciones complejas o nuevas pantallas antes de empezar a programar. |
| `/plan-prd` | **Generador de PRD lean.** Convierte una idea de negocio en especificaciones funcionales y de producto. | Cuando inicias un nuevo módulo o proyecto desde cero. |
| `/council` | **Consejo de 4 voces.** Analiza decisiones ambiguas evaluando pros, contras y compensaciones de arquitectura. | Cuando hay 2 o más formas válidas de hacer algo y necesitas decidir. |

> **Ejemplo de uso:**
> ```text
> /plan Necesito crear un módulo de auditoría en tiempo real para todas las acciones de los usuarios con exportación a Excel y filtros por fecha.
> ```

---

### 🛡️ 2. Calidad, Testing y TDD (Test-Driven Development)

| Comando | Función | Cuándo usarlo |
| :--- | :--- | :--- |
| `/tdd-workflow` | **Desarrollo Guiado por Pruebas.** Escribe primero los tests unitarios/integración (cobertura >80%) y luego la implementación. | Para crear lógica crítica (cálculos de impuestos, estados de órdenes, pagos). |
| `/react-test` | **Testing en React.** Genera pruebas de componentes con React Testing Library y Vitest/Jest enfocadas en interacción. | Para probar botones, modales y formularios en el frontend. |
| `/test-coverage` | **Auditoría de cobertura.** Analiza los archivos del proyecto, detecta huecos sin testear y genera los tests faltantes. | Antes de pasar a producción para asegurar que nada se rompa. |
| `/build-fix` | **Corrector quirúrgico de builds.** Detecta errores de compilación TypeScript/Vite/esbuild y los repara con el menor cambio seguro posible. | Cuando `npm run build` o TypeScript tire errores de tipos. |

> **Ejemplo de uso:**
> ```text
> /tdd-workflow Implementa la función de validación de cédulas y RIF venezolanos con soporte para personas naturales y jurídicas.
> ```

---

### 🔍 3. Revisión de Código y Seguridad

| Comando | Función | Cuándo usarlo |
| :--- | :--- | :--- |
| `/code-review` | **Revisión integral de código.** Analiza cambios no commiteados o PRs buscando malas prácticas, cuellos de botella y errores lógicos. | Antes de hacer commit o desplegar un cambio importante. |
| `/security-scan` | **Escaneo de seguridad.** Audita inyecciones SQL, XSS, CSRF, exposición de credenciales y debilidades de autenticación/RBAC. | Al tocar endpoints de login, roles de usuario, subida de archivos o pagos. |
| `/quality-gate` | **Puerta de calidad.** Pasa linters, formateo y reglas de estilo en los archivos editados. | Para mantener el código prolijo y ordenado. |
| `/refactor-clean` | **Limpieza segura de código muerto.** Detecta variables, imports, componentes y funciones no utilizadas y los elimina sin romper nada. | Para limpiar y optimizar archivos largos. |

> **Ejemplo de uso:**
> ```text
> /security-scan Revisa server.ts y los endpoints de /api/database/restore para verificar que no haya vulnerabilidades de inyección o permisos indebidos.
> ```

---

### 🎨 4. Diseño y UI/UX de Alto Impacto

| Comando / Skill | Función | Cuándo usarlo |
| :--- | :--- | :--- |
| `/gan-design` | **Bucle de diseño Generador/Evaluador.** Itera visualmente sobre una interfaz hasta alcanzar un nivel estético premium. | Para rediseñar dashboards, vistas de órdenes y landing pages. |
| `modern-ui-ux-craftsman` | **Diseño moderno y estética.** Glassmorphism, micro-animaciones, tipografías Google Fonts, paletas oscuras calibradas y feedback visual. | Cuando una pantalla se ve muy básica o cuadrada y quieres sorprender al usuario. |
| `frontend-patterns` | **Patrones React / Vite.** Gestión de estado óptimo, separación de componentes y hooks reutilizables. | Para estructurar componentes grandes sin re-renderizados innecesarios. |

> **Ejemplo de uso:**
> ```text
> Aplica el skill modern-ui-ux-craftsman a la vista de Reclamos para que tenga tarjetas interactivas con bordes de neón esmeralda y animaciones fluidas.
> ```

---

### 🗄️ 5. Base de Datos, Backend y Especialidades Regionales

| Skill | Función | Cuándo usarlo |
| :--- | :--- | :--- |
| `database-sql-engineer` | **Ingeniería SQL y Optimización.** Índices compuestos, transacciones ACID, integridad referencial y consultas rápidas en MySQL/Postgres. | Cuando las consultas estén lentas o crees nuevas tablas con relaciones complejas. |
| `backend-api-master` | **APIs REST y Servidores Robustos.** Manejo centralizado de errores, validaciones, rate limiting y respuestas JSON tipadas. | Al crear endpoints nuevos en Express / Node.js. |
| `venezuela-pos-architect-ux` | **Lógica Fiscal y POS Venezuela.** Conversión dual USD/VES con tasa BCV oficial, IGTF 3%, métodos de pago mixtos (Zelle, Pago Móvil, Efectivo, Punto). | Para el módulo de facturación, caja, órdenes y cobros. |

> **Ejemplo de uso:**
> ```text
> Usa database-sql-engineer para crear una migración que agregue una tabla de historial de llamadas a los reclamos con clave foránea indexada.
> ```

---

## 💡 Ejemplos Prácticos Cotidianos

### Caso 1: Crear una función nueva de punta a punta
```text
Usuario: /plan Quiero agregar una función para exportar reportes de ventas a PDF con gráficos y resumen diario.
Asistente: [Crea el plan paso a paso, define riesgos y espera tu aprobación]
Usuario: Aprobado, procede.
Asistente: [Implementa backend, frontend y tests garantizando calidad]
```

### Caso 2: Detectar y resolver un bug difícil
```text
Usuario: /orch-fix-defect Hay un problema donde al cambiar el estado de una orden a "Reclamo", a veces el contador del dashboard no se actualiza en tiempo real.
Asistente: [Reproduce el fallo con un test que falla -> Corrige el código -> Valida que el test pase a verde -> Confirma la solución]
```

### Caso 3: Pulir la interfaz de una pantalla existente
```text
Usuario: Usa modern-ui-ux-craftsman para rediseñar la barra de navegación superior. Quiero que tenga efecto glassmorphism, indicador de estado de conexión a la base de datos y un selector de sucursal estilizado.
```

---

## 📂 Directorios de Referencia en tu Máquina

* **Configuración Global de Plugins:** `/Users/user/.gemini/config/plugins/ecc`
* **Skills Globales:** `/Users/user/.gemini/config/plugins/ecc/skills/`
* **Agentes Especialistas:** `/Users/user/.gemini/config/plugins/ecc/agents/`
* **Reglas de Codificación:** `/Users/user/.gemini/config/plugins/ecc/rules/`
* **Workflows Locales del Proyecto:** `.agents/workflows/`

---
*Manual generado para Radar V3 y futuros proyectos en tu entorno de desarrollo.*
