# Auditoria de seguridad y calidad - Radar 3.0

**Fecha:** 2026-09-14
**Alcance:** proyecto `radar-3.0`, API Node/MySQL, frontend React/Vite, Docker y despliegue actual en Dokploy.
**Tipo:** revision estatica y validacion ejecutable. No se modifico codigo durante la auditoria.

## Resumen ejecutivo

El proyecto compila correctamente y no tiene vulnerabilidades conocidas reportadas por `npm audit --omit=dev`. La autenticacion bcrypt/JWT existe y las consultas SQL revisadas usan parametros.

Antes de considerarlo produccion definitiva hay cuatro temas prioritarios:

1. La aplicacion se publica actualmente por HTTP y no por HTTPS.
2. La mayoria de endpoints acepta cualquier usuario autenticado, sin autorizacion fina por rol.
3. Los cuerpos JSON no tienen limite ni validacion de esquema.
4. Los tokens JWT siguen siendo validos aunque un usuario sea desactivado hasta que expiren.

Tambien hay un bug confirmado: el frontend llama `/api/gomotive/vehicles`, pero el backend no implementa esa ruta.

## Estado de validaciones

| Validacion | Resultado |
|---|---|
| `npm ci` | Correcto |
| `npm run build` | Correcto |
| `npm run lint` | Correcto |
| `npm run build:api` | Correcto |
| `npm audit --omit=dev` | 0 vulnerabilidades conocidas |
| SQL parametrizado en consultas revisadas | Correcto |
| Password hashing con bcrypt | Presente |
| JWT | Presente |
| Dockerfile unificado frontend + API | Presente |

Vite muestra una advertencia de bundle principal superior a `500 kB`. No bloquea el despliegue, pero afecta el rendimiento inicial.

## Hallazgos prioritarios

### A-01 - Produccion sin HTTPS

**Severidad:** Critica
**Estado:** Confirmado

La aplicacion se esta probando por una IP y HTTP. Credenciales, JWT y datos de negocio viajan sin cifrado de transporte.

**Riesgo:** captura de credenciales o tokens en una red intermediaria.

**Correccion:**

- configurar dominio definitivo;
- publicar mediante Traefik;
- emitir certificado TLS;
- redirigir HTTP a HTTPS;
- cerrar puertos temporales publicos despues de validar el dominio.

**Referencia:** `Dockerfile`, `server.ts`, configuracion de Traefik/Dokploy.

### A-02 - Autorizacion insuficiente por rol

**Severidad:** Alta
**Estado:** Confirmado

El middleware valida que exista un JWT, pero solo `/api/users` exige rol `admin`. Ordenes, clientes, reclamos, llamadas, reportes, inventario y notificaciones quedan disponibles para cualquier usuario autenticado.

**Riesgo:** un usuario `operator` podria leer o modificar informacion y ejecutar operaciones que deberian requerir permisos administrativos.

**Correccion:**

- definir permisos de lectura, creacion, edicion y eliminacion;
- aplicar permisos por endpoint;
- limitar estados criticos de orden;
- validar el rol desde base de datos o claims controlados;
- registrar acciones administrativas.

**Referencia:** `server.ts`, middleware de autenticacion y handlers `/api/*`.

### A-03 - Tokens no revocables al desactivar usuarios

**Severidad:** Alta
**Estado:** Confirmado

`/api/auth/me` comprueba si el usuario esta activo, pero el resto de endpoints solo verifica la firma del JWT. Un token emitido antes de desactivar un usuario puede seguir funcionando durante su periodo de validez.

**Correccion:**

- validar `active` en cada request sensible;
- guardar sesiones revocables;
- o usar `tokenVersion` en `users` y comprobarlo en cada token.

### A-04 - Body HTTP sin limite

**Severidad:** Alta
**Estado:** Confirmado

`readBody()` acumula todos los chunks recibidos sin limite.

**Riesgo:** consumo de memoria y denegacion de servicio mediante requests grandes.

**Correccion:**

- limitar el body, por ejemplo a `1 MB`;
- rechazar `Content-Length` excesivo;
- abortar la lectura al superar el limite;
- validar `Content-Type`.

**Referencia:** `server.ts`, funcion `readBody`.

### A-05 - JSON invalido termina en 500

**Severidad:** Alta
**Estado:** Confirmado

`JSON.parse()` se ejecuta sin una respuesta especifica para errores de sintaxis.

**Resultado:** payload invalido produce error interno en lugar de `400 Bad Request`.

**Correccion:** envolver el parseo, devolver `400` y usar validacion de esquema.

### A-06 - Payloads de orden sin validacion de negocio

**Severidad:** Alta
**Estado:** Confirmado

La API acepta directamente datos de orden enviados por el cliente.

Riesgos identificados:

- precios negativos;
- anticipos mayores al total;
- estados inexistentes;
- `workflowStep` fuera de rango;
- fechas invalidas;
- IDs de clientes no relacionados;
- modificaciones sin permiso;
- datos anidados ausentes que causan errores 500.

**Correccion:** usar esquemas de entrada y reglas de negocio antes de iniciar transacciones.

### A-07 - Falta una transaccion completa al actualizar ordenes

**Severidad:** Alta
**Estado:** Confirmado

La actualizacion de cliente, orden e insercion en `status_orders` no se ejecuta dentro de una unica transaccion.

**Riesgo:** estado parcial si una consulta falla despues de que otra ya se haya confirmado.

**Correccion:** usar una sola conexion, `beginTransaction`, validacion, operaciones y `commit`; hacer `rollback` ante cualquier error.

## Bugs funcionales confirmados

### B-01 - Ruta `/api/gomotive/vehicles` inexistente

**Severidad:** Media-alta
**Estado:** Confirmado

El frontend llama a:

```text
/api/gomotive/vehicles
```

desde `src/components/GomotiveFleetView.tsx`, pero no existe un handler correspondiente en `server.ts`.

**Resultado actual:** respuesta `404` y fallback silencioso a datos locales.

**Decision necesaria:**

- implementar la integracion Gomotive;
- eliminar la vista si no se usara;
- o mostrar claramente que son datos simulados.

### B-02 - Rutas comparadas contra `request.url` completo

**Severidad:** Media
**Estado:** Confirmado

Muchas rutas usan comparaciones exactas como:

```ts
request.url === '/api/orders'
```

Si llega una query string, por ejemplo `/api/orders?page=1`, la ruta no coincide y devuelve `404`.

**Correccion:** parsear `new URL(request.url, base)`, comparar `pathname` y leer `searchParams`.

### B-03 - Errores silenciosos en frontend

**Severidad:** Media
**Estado:** Confirmado

Varias vistas transforman fallos de API en arrays vacios o datos mock:

- `App.tsx`;
- `AIReportsView.tsx`;
- `ClaimsView.tsx`;
- `OperationsView.tsx`;
- `GomotiveFleetView.tsx`;
- `UsersManagementView.tsx`;
- `CallLogsView.tsx`.

**Riesgo:** el usuario ve una pantalla vacia y puede interpretar que no hay datos, cuando en realidad la API fallo.

**Correccion:** estados explicitos de carga, error y vacio; mensajes visibles y seguros.

## Riesgos de autenticacion y sesion

### C-01 - JWT almacenado en `localStorage`

**Severidad:** Media
**Estado:** Confirmado

El frontend guarda `radar_token` en `localStorage`.

**Riesgo:** cualquier XSS que consiga ejecutar JavaScript puede leer el token.

**Correccion recomendada:** cookie `HttpOnly`, `Secure`, `SameSite`, proteccion CSRF y CSP estricta.

### C-02 - Rate limit en memoria

**Severidad:** Media
**Estado:** Confirmado

El rate limit de login utiliza un `Map` local.

Limitaciones:

- se pierde al reiniciar;
- no se comparte entre replicas;
- puede crecer con muchas IPs;
- detras de un proxy puede identificar mal la IP;
- no existe limpieza global de entradas expiradas.

**Correccion:** Redis o almacenamiento compartido, limpieza periodica y limite combinado por IP/correo.

### C-03 - JWT_SECRET ausente

**Severidad:** Media
**Estado:** Riesgo de configuracion

La aplicacion falla el login si no existe `JWT_SECRET`, lo cual evita emitir tokens inseguros. Sin embargo, el arranque no falla inmediatamente y el servicio puede permanecer activo devolviendo errores.

**Correccion:** validar variables obligatorias al iniciar y terminar el proceso con un mensaje claro si faltan.

### C-04 - Falta invalidacion de sesiones

**Severidad:** Media
**Estado:** Confirmado

No hay logout server-side, lista de sesiones, revocacion por usuario ni rotacion de secretos.

## Riesgos HTTP y de despliegue

### D-01 - Falta Content Security Policy

**Severidad:** Media
**Estado:** Confirmado

Hay algunas cabeceras defensivas, pero no una `Content-Security-Policy`.

**Correccion:** definir CSP estricta compatible con los recursos reales de la aplicacion.

### D-02 - Falta `Vary: Origin`

**Severidad:** Baja-media
**Estado:** Riesgo potencial

La respuesta CORS cambia segun `Origin`, pero no declara `Vary: Origin`. Un proxy cache podria reutilizar una respuesta con un origen incorrecto.

### D-03 - Healthcheck publico revela estado operativo

**Severidad:** Baja
**Estado:** Confirmado

`GET /health` devuelve que la base esta conectada.

**Correccion opcional:** mantenerlo para Dokploy, pero devolver informacion minima publicamente y guardar detalles internos en logs.

### D-04 - Contenedor ejecutado como root

**Severidad:** Media
**Estado:** Confirmado

El runtime de `Dockerfile` no declara un usuario no privilegiado.

**Correccion:** crear usuario de runtime, asignar ownership y usar `USER nodeapp`.

### D-05 - Falta `HEALTHCHECK` en Dockerfile

**Severidad:** Media
**Estado:** Confirmado

Existe `/health`, pero Docker no tiene un `HEALTHCHECK` declarado.

**Correccion:** añadir un healthcheck que valide `http://127.0.0.1:3000/health`.

### D-06 - Produccion usa puertos temporales HTTP

**Severidad:** Alta
**Estado:** Confirmado

La aplicacion esta publicada temporalmente mediante IP y HTTP. Antes de considerarla produccion definitiva deben configurarse dominio, HTTPS y Traefik.

## Calidad y mantenimiento

### E-01 - Documentacion desactualizada

`README.md` todavia menciona `radar_db` y una API separada en `localhost:3001`, aunque el sistema actual usa un contenedor combinado y `radar_v3`.

### E-02 - Dos lockfiles

El repositorio contiene `package-lock.json` y `bun.lock`. Docker usa `npm ci`, por lo que conviene elegir npm y retirar `bun.lock` para evitar instalaciones divergentes.

### E-03 - Bundle frontend grande

Vite reporta un bundle principal superior a `500 kB`.

**Correccion:** lazy loading, `manualChunks` y carga diferida de reportes, exportaciones y modulos pesados.

### E-04 - Falta de tests automatizados

No se encontraron pruebas para:

- login correcto e incorrecto;
- usuario inactivo;
- expiracion/revocacion JWT;
- autorizacion por rol;
- payload invalido;
- creacion y actualizacion transaccional de orden;
- reclamos;
- rutas protegidas.

## Posibles mejoras

- Añadir validacion con Zod o Valibot.
- Añadir logging estructurado sin contraseñas ni tokens.
- Añadir correlation ID por request.
- Añadir paginacion a ordenes, clientes, llamadas y notificaciones.
- Añadir indices MySQL para columnas usadas en filtros y joins.
- Añadir backups automaticos de MariaDB y prueba de restauracion.
- Añadir auditoria de cambios de orden y permisos.
- Añadir graceful shutdown para cerrar el pool MySQL.
- Configurar timeouts de MySQL y del servidor HTTP.
- Migrar el token a cookies `HttpOnly`.
- Eliminar datos mock silenciosos del flujo de produccion.
- Dividir el bundle frontend.

## Orden recomendado para corregir

### Fase 1 - Exposicion y seguridad

1. Configurar dominio y HTTPS.
2. Ejecutar el contenedor como usuario no root.
3. Añadir `HEALTHCHECK`.
4. Validar variables obligatorias al arrancar.
5. Limitar body y tiempo de request.

### Fase 2 - Autorizacion y datos

1. Definir permisos por rol.
2. Proteger operaciones de escritura.
3. Validar payloads.
4. Envolver operaciones de orden en transacciones.
5. Implementar revocacion de sesiones.

### Fase 3 - Bugs funcionales

1. Resolver `/api/gomotive/vehicles`.
2. Corregir parseo de query strings.
3. Eliminar fallbacks silenciosos.
4. Añadir manejo visible de errores.

### Fase 4 - Calidad

1. Crear tests de API y autenticacion.
2. Actualizar README.
3. Elegir un unico lockfile.
4. Optimizar bundle.
5. Configurar observabilidad y backups.

## Decisiones pendientes

- ¿Se implementara Gomotive o se eliminara su vista?
- ¿Que acciones puede realizar cada rol: `admin`, `operator` y futuros roles?
- ¿Se migrara JWT de `localStorage` a cookies `HttpOnly` ahora o en una fase posterior?
- ¿Que dominio definitivo se usara para frontend y API?
- ¿Se requiere auditoria completa de cambios y acciones administrativas?

## Conclusion

El sistema esta en un estado funcional para pruebas controladas, pero no debe considerarse endurecido para produccion definitiva hasta resolver HTTPS, autorizacion por rol, validacion de entrada y revocacion de sesiones. El siguiente cambio recomendado es la Fase 1, empezando por HTTPS y los limites del servidor.
