# Revision y refuerzo de seguridad - Radar 3.0

Fecha: 2026-11-02. Alcance: copia local aislada en Docker Desktop.

Actualizacion de preparacion de produccion (2026-11-02): se obtuvo el
repositorio real y se confirmo una clave Wasender expuesta en el historial
(commit `d40b13c`). Se retiro del codigo actualizado y se trasladara al entorno
privado del servidor. Por autorizacion del propietario se conserva
temporalmente para no interrumpir mensajeria: **su rotacion en el proveedor
sigue pendiente**. Borrar la clave del ultimo commit no revoca la anterior.
Se respaldo el VPS y se ensayo la migracion sobre una copia aislada: las
28 tablas originales conservaron todas sus columnas y valores de filas.
La publicacion y el corte a produccion requieren verificacion posterior;
las afirmaciones de validacion local de este informe no certifican ese corte.

## Resultado y limites

Se corrigieron los hallazgos confirmados, se reforzaron los controles compartidos
y se reconstruyo/desplego la aplicacion local. No se conecto al VPS, no se
modificaron servicios de produccion y no se cambiaron contrasenas o factores de
usuarios reales. La validacion activa utilizo exclusivamente datos sinteticos
en una base desechable.

Esto reduce riesgos; no demuestra que la aplicacion sea invulnerable ni que el
VPS este protegido con estas modificaciones. Hay acciones externas pendientes.

## Hallazgos principales y resolucion

| Riesgo inicial | Hallazgo | Resolucion local |
| --- | --- | --- |
| Alto | XSS almacenado en el HTML imprimible del inventario | Escape contextual de todos los campos, clase de estado limitada a valores conocidos, eliminacion del script inline y desconexion del opener de la ventana. Prueba sobre el componente real con etiquetas y atributos maliciosos. |
| Alto | Descargas completas de DB sin segundo factor | Boveda obligatoria para listar, generar y descargar respaldos por todas las rutas. La ruta antigua redirige a la API autenticada para respetar el alcance de las cookies. |
| Alto | Auditoria general podia revelar nomina/gastos | La auditoria exige boveda, incluidos registros historicos. Las nuevas modificaciones financieras guardan versiones y conteos, no el payload financiero completo. No se borraron registros historicos. |
| Alto | Cambio de telefono podia sustituir el destino OTP sin el factor anterior | El perfil administrativo exige contrasena actual y boveda desbloqueada antes del cambio. Las escrituras de gestion de cuentas tambien exigen boveda, incluida la creacion/promocion de administradores. Se revocan sesiones/concesiones y OTP pendientes afectados. |
| Medio | Plantilla Nginx publicaba uploads con alias | Eliminado el acceso directo: adjuntos y respaldos pasan por Node y su autenticacion. Plantilla comprobada con `nginx -t`, sin contactar produccion. |
| Medio, matizado | Ruta OTP obsoleta para modificar entregas | Se confirmo que el flujo soportado ya era administrativo, no OTP. La ruta vieja devuelve 410 y se retiro el modal sin uso. Se exige version y motivo; la edicion general no puede alterar/borrar la fecha existente evitando esa auditoria. |
| Medio | El costo interno podia salir por JSON aunque el CSV lo ocultara | Lectura, escritura y exportacion del costo restringidas a administracion; editor de operadores no muestra ese campo. |
| Medio | El servidor podia servir archivos de su propio bundle | Bloqueo de archivos internos, dotfiles, mapas de fuentes, extensiones no publicas y escapes por enlaces simbolicos. `/server.js`, `/migrate.js`, `/.env` y `/package.json` devuelven 404. |
| Refuerzo | Logout solo eliminaba la cookie | Ahora revoca las sesiones de la cuenta en la DB y elimina concesiones de boveda. La interfaz no anuncia cierre exitoso si el servidor no lo completo. |

Archivos principales: [servidor](./server.ts),
[controles HTTP](./src/server/security.ts),
[autenticacion](./src/server/auth.ts),
[boveda](./src/server/financeVault.ts),
[impresion](./src/components/InventoryPrintModal.tsx),
[Nginx](./deploy/nginx-radar.conf).

## Cobertura de la lista solicitada

| Control | Estado / comportamiento |
| --- | --- |
| Autenticacion | JWT HS256 con expiracion; identidad, rol activo y version se contrastan con DB. Sin JWT en URLs. Cambios de cuentas revocan sesiones; eventos SSE se revalidan cada 25 segundos. |
| Claves en navegador | No se encontraron claves reconocibles en el codigo cliente/bundle durante el escaneo por patrones. Wasender toma su clave solo del servidor. Vite limita las variables publicas al prefijo de URL API. No se certifica ausencia universal de secretos. |
| DB protegida | MariaDB sin puerto publicado y red Docker interna. Cuenta de runtime local limitada a SELECT/INSERT/UPDATE/DELETE; DDL denegado en una prueba real. Migracion separada. No se altero esquema ni informacion de negocio. |
| HTTPS | Produccion rechaza HTTP (426, salvo health), exige origen HTTPS y activa HSTS/Secure. Plantilla Nginx redirige 80 a 443, TLS 1.2/1.3. Localhost sigue HTTP deliberadamente. |
| Hash de contrasenas | Los seis usuarios locales existentes usan bcrypt. Nuevas contrasenas usan factor 12 y limite de 72 bytes UTF-8 contra truncamiento. No se regeneraron hashes de usuarios reales sin conocer su contrasena. |
| Formularios / consultas | Zod, tipos, limites de cuerpos/fechas/importes y filtros de auditoria; valores SQL parametrizados y nombres dinamicos restringidos/escapados. Errores SQL no se devuelven al cliente. Sin DDL correctivo desde peticiones de usuarios. |
| XSS | Escape en impresion, React para texto de vistas, CSP sin scripts inline/eval, sin objetos/frames. Se mantienen estilos inline por compatibilidad. CSV de ambas exportaciones neutraliza formulas. |
| Registro / vigilancia | Login, fallos 2FA, cambios de factores y eventos sospechosos persistidos; rechazos de origen/CSRF/rate limit auditados sin inundar logs. Sin tokens, claves o contrasenas en esos detalles. Auditoria consultable por admin con boveda. |
| Admin | Rol actual verificado en servidor. Respaldos, auditoria y cambios de usuarios requieren ademas boveda. Finanzas detalladas siguen protegidas. Agregados diarios administrativos conservan la excepcion previamente aprobada, sin movimientos individuales. |
| Variables / debug | Produccion falla al arrancar con variables obligatorias ausentes, JWT corto/de ejemplo, DB root, origen HTTP/comodin/ruta o depurador. `.env.example` no contiene credenciales. Carga de `.env` sin ocultar fallos de lectura. |
| Rate limiting | 600 peticiones/min/IP; 120 escrituras/min/usuario, 30 en rutas sensibles. Login: diez fallos por cuenta o IP/15 min. 2FA: cinco fallos/15 min. SSE: cinco conexiones/usuario, 200 totales. Limites por proceso; no reemplazan proteccion de infraestructura. |
| CORS | Origenes explicitos, sin comodines en produccion; rechazos activos de origen/cross-site, no solo ausencia de cabeceras CORS. Puertos localhost adicionales solo en desarrollo. |
| Cabeceras / cookies | CSP, nosniff, DENY, no-referrer, Permissions-Policy, COOP y HSTS en produccion. Cookies HttpOnly, SameSite y Secure en produccion, sin acceso JavaScript a sesion/factores/CSRF. Respuestas privadas no-store. |
| CSRF | Token firmado, cookie HttpOnly y cabecera obligatoria, ligado a la sesion y con ocho horas de caducidad; tambien login y clientes Bearer. El cliente solo reintenta una vez tras CSRF_INVALID, antes de una escritura. |
| Recuperacion de contrasena | No existe flujo con enlaces de recuperacion; no se agrego uno innecesario. Un desarrollo futuro debe usar tokens aleatorios de un uso, hash almacenado y caducidad corta. |
| Archivos | 10 MiB binarios / 15 MiB JSON, extension-MIME-firma concordantes, base64 valido, nombres aleatorios y permisos privados; sin SVG/ejecutables. Descarga autenticada y sandbox, documentos como adjunto. Avatar raster acotado y URL HTTPS. No incluye antivirus. |
| Precios / pagos | Importes y precision, abonos, total comercial, estados y saldo reembolsable verificados en servidor; autorizacion y transacciones existentes conservadas. No hay procesador de pagos externo; estos registros no equivalen a verificacion de una transferencia bancaria. |
| Dependencias | `npm audit --json`: cero vulnerabilidades conocidas reportadas, incluyendo dependencias de desarrollo. No se forzaron actualizaciones innecesarias sin avisos. Eliminados `motion` y `lucide-react`, sin referencias; herramientas de build fuera de dependencias de runtime. |
| Archivos / Git | Excluidos entornos, respaldos, adjuntos y Git del build; proteccion de rutas publicas comprobada. La copia no incluye `.git`: no fue posible escanear commits ni afirmar que el historial esta limpio. |
| Revocacion externa | No se encontraron claves de proveedor verificablemente comprometidas en el alcance revisado. No se revocaron credenciales externas ni se sustituyeron claves de produccion sin acceso/autorizacion. Ver pendientes. |

## Pruebas ejecutadas

- `npm run lint`: correcto.
- `npm run build`: frontend y API compilados; imagen local reconstruida.
- `npm test`: **252 pruebas aprobadas, 41 archivos, ninguna omitida**.
  Incluye dos pruebas reales de exportacion/restauracion en esquemas temporales.
- [Aceptacion HTTP](./scripts/test-security-hardening.ts):
  **22 grupos aprobados**, API compilada con `NODE_ENV=production` y DB sintetica
  `radar_security_validation`. Comprueba cookies Secure, HTTPS, CORS, CSRF,
  permisos/boveda, backup completo autorizado, aislamiento de concesiones,
  revocacion, regeneracion de factores, login por cuenta con IP variable,
  cooldown 2FA, 429/Retry-After, archivos, validacion, CSV y configuracion insegura.
- Regresion XSS ejecuta el handler real de impresion con todos los campos
  contaminados: el documento resultante no contiene etiquetas ejecutables.
- `nginx -t`: correcto usando certificado temporal autofirmado y red deshabilitada.
  Advertencia de sintaxis antigua `listen ... http2`, compatible con esta version;
  no se emitio ni instalo certificado de produccion.
- Comprobacion en navegador real: ordenes y agregados 200; detalle financiero y
  backup bloqueados 403; archivos internos 404; cookies no legibles por JS y sin
  errores de CSP para scripts de la interfaz.
- App, DB y proxy locales saludables; ingress solo `127.0.0.1:3000`.
  La copia conserva sus **595 ordenes visibles** y usuarios de negocio.

Los scripts usan guardas de nombre y datos sinteticos. No se probaron ataques
activos, reinicios de factores ni escrituras financieras sobre datos reales.
No se enviaron notificaciones a terceros. Solo se consultaron metadatos de
paquetes publicos para las dependencias.

## Acciones pendientes antes de produccion

1. **Rotar la contrasena root del VPS compartida durante la asistencia** y
   preferir acceso SSH por llave, usuario administrativo no-root y firewall.
   No se realizo esa rotacion desde la copia local.
2. Obtener el repositorio Git real y escanear todas las referencias, tags y
   commits. Si hubo claves, revocarlas en cada proveedor aunque se borren del
   ultimo commit. Revisar tambien copias de seguridad antiguas y archivos
   excluidos; el escaneo por patrones no prueba que nunca existio una filtracion.
3. Generar secretos exclusivos de produccion mediante un gestor de secretos,
   revisar permisos de `.env` y rotar JWT/DB/Wasender si hay evidencia de
   exposicion. Nunca reutilizar las credenciales de Docker Desktop.
4. Desplegar estos cambios en una ventana autorizada, con respaldo probado.
   Comprobar TLS/certificados, renovacion, cabeceras reales, proxy confiable,
   firewall y que Node/DB no tengan acceso publico. **No se inspecciono el
   sistema operativo ni la configuracion actual del VPS en esta tarea.**
5. Aplicar los GRANTS de menor privilegio en produccion con una cuenta
   migradora separada. Si DB cruza redes no confiables, habilitar TLS con
   verificacion de certificado y segmentacion; no basta con una variable local.
6. Cifrar disco y respaldos, restringir su custodia y establecer retencion
   operativa. Los dumps completos contienen datos sensibles y material de
   recuperacion de factores por su finalidad; gzip no es cifrado.
7. Conectar supervision externa: alertas de multiples fallos, picos 403/429/5xx,
   cuentas nuevas, cambios de factores y restauraciones. Localmente WhatsApp
   permanece deshabilitado: no hay vigilancia externa continua configurada.
8. Para varias replicas, centralizar rate limits, OTP y concesiones de boveda.
   Un reinicio vuelve a bloquear la boveda; los contadores en memoria reinician.
   Incorporar analisis antimalware si se reciben documentos de terceros no
   confiables. Mantener auditorias periodicas, SO y dependencias actualizados.

No se certifican ausencia de intrusiones previas, seguridad de proveedores o
proteccion efectiva del VPS hasta completar esa validacion de despliegue.
