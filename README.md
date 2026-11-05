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

Guia operativa: [Despliegue a produccion](./DESPLIEGUE_PRODUCCION.md).
Incluye acceso Git/SSH, PR a `main`, Dokploy, verificacion y recuperacion.

### Actualizacion productiva del 2026-11-02

La release `38f7457` se publico por GitHub y fue compilada/desplegada por Dokploy.
Se conservaron las 28 tablas originales mediante migraciones aditivas, sin
restaurar la base local ni ejecutar seed. El corte preservo 647 ordenes,
604 clientes y 7 usuarios; se verificaron los valores originales por fila.

Los adjuntos y respaldos usan binds persistentes en
`/var/lib/radar-data/uploads` y `/var/lib/radar-data/backups`, no la capa efimera
del contenedor. No retirar esos mounts en futuros despliegues. La base sigue
en su volumen existente. Solo Traefik publica la app; el puerto directo 8083
se retiro. La cuenta de runtime no tiene permisos DDL: futuras migraciones
requieren una cuenta temporal separada y respaldo/restauracion ensayados.

Ver [informe de seguridad](./SECURITY-REVIEW.md) para validaciones, ubicacion
privada de respaldos y limites. Sigue pendiente rotar la clave Wasender
expuesta en el historial; moverla al entorno no revoca la clave anterior.

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

## Flujo verificable de ordenes

La vista **Mi trabajo de hoy** reúne las tareas de las ordenes creadas desde
el **21 de octubre de 2026 inclusive** (fecha de negocio `America/New_York`)
y todas las nuevas. El operador ve sus asignaciones por ID; administracion
ve la bandeja global, las ordenes sin asignar y la supervision por responsable
actual. El acceso tambien esta disponible desde el encabezado y la busqueda.
Al iniciar sesion con tareas accionables se muestra esta bandeja; no se bloquea
el resto del sistema.

- Cotizacion queda completada automaticamente al crear la orden, sin otro
  formulario. Muestra la fecha de creacion y el agente autenticado registrado
  en la auditoria de creacion, independiente del responsable actual. Si falta
  ese registro historico, muestra "No registrado"; no inventa un agente.
  Confirmacion, preparacion/cita y entrega requieren detalle, referencia
  verificable, confirmacion, autor autenticado y fecha, en ese orden.
  El numero legacy de etapa no demuestra cumplimiento de estas gestiones.
- Primera gestion pendiente: Confirmacion, un dia habil desde la creacion
  de la orden, no desde una gestion de cotizacion registrada posteriormente.
  Preparacion: fecha comprometida al confirmar.
  Entrega: fecha acordada al preparar. Dias habiles: lunes a viernes, sin
  calendario de feriados.
- Sin respuesta no completa el objetivo: exige proxima accion y reintento
  el siguiente dia habil. No elimina el aviso de atraso del objetivo original.
  Un bloqueo identifica a quien debe resolverlo y fija la proxima revision;
  se muestra separado del atraso imputable al operador.
- El supervisor recibe un indicador interno al acumular un dia habil de
  atraso. La tabla distingue objetivos confirmados dentro del plazo,
  intentos, vencimientos y bloqueos. No se agregan envios WhatsApp automaticos.
- El estado logistico se sigue cambiando desde la orden. El servidor exige
  la cotizacion inicial ya registrada para avanzar a Pagado, confirmacion para Preparacion
  y preparacion verificada para Listo/En camino. La entrega se registra desde
  el flujo, con saldo liquidado, evidencia y las validaciones existentes de
  inventario, estado y garantia. Administracion sigue registrando los cobros.
- Post-entrega mantiene los hitos **3, 7 y 14 dias calendario**. Un mensaje
  enviado no confirma al cliente. El dia 3 confirma recepcion y cita de
  instalacion si sigue sin montar; los dias 7 y 14 requieren funcionamiento
  confirmado. Un hito temprano exitoso no cancela los siguientes.
- Reclamos y reembolsos siguen sus servicios propios. Registrar una incidencia
  en el flujo no crea ni cierra un caso: hay que gestionarlo en su vista.
  Reactivaciones y retrocesos reabren las etapas pertinentes sin borrar el
  historial ni cambiar la entrega o garantia originales. Cotizacion no se
  reabre: una reactivacion temprana vuelve a Confirmacion.
- Las ordenes existentes tambien muestran Cotizacion completada desde su
  creacion, sin insertar evidencias nuevas ni modificar datos historicos;
  deben regularizar las etapas siguientes pendientes. Se conservan los
  eventos anteriores de cotizacion y el historial de contactos.
  Las anteriores al corte conservan su flujo legacy, accesible desde
  **Seguimiento historico**. La API antigua de contactos rechaza avances de
  ordenes sujetas al nuevo flujo para evitar dos motores contradictorios.

Persistencia aditiva: `migrations/022_order_workflow_events.sql`, aplicada con
el runner explicito de migraciones y una cuenta DDL separada. No requiere
seed ni modificar las ordenes existentes. Las tareas se derivan al consultar;
no se agrega un cron externo. Los eventos tienen version de orden y transaccion
con bloqueo de fila para impedir guardados simultaneos o duplicados.
La tabla de eventos no agrega claves foraneas sobre tablas legacy: sus IDs
son `INT` firmado en la instancia existente y `INT UNSIGNED` en instalaciones
nuevas. La API verifica la existencia de la orden bajo bloqueo y conserva los
eventos como historial, sin convertir IDs ni alterar las tablas originales.

Validacion reproducible:

- Reglas/API: `npm test -- tests/order-workflow.test.ts tests/order-workflow-api.test.ts`.
- Cobertura enfocada: agregar `--coverage --coverage.include=src/utils/orderWorkflow.ts --coverage.include=src/server/orderWorkflow.ts`.
- Interaccion: `WORKFLOW_TEST_URL=http://127.0.0.1:3000 npx tsx scripts/test-order-workflow-ui.ts`.
  Solo acepta frontend local, intercepta todas las API y usa datos sinteticos.
  Prueba conflicto, reintento, evidencia, entrega, historial, bloqueos,
  claro/oscuro y 1440/1150/768/375px; no escribe en la base real.
- `scripts/test-order-workflow-db.ts` verifica SQL y transacciones con todas
  las migraciones en una base local desechable; requiere una cuenta local
  autorizada para crear/eliminar **solo esa base de prueba**. La elimina al
  terminar, incluso si falla. No acepta hosts remotos.

## Cobros divididos, core y entrega

En el detalle de la orden, **Registrar cobro / ver pagos y core** permite
registrar cobros parciales sin entregar. Seleccionar **Entregado** desde el
detalle o la tabla abre el formulario de cobro y entrega; no registra dinero
ni una entrega por cambiar solamente la etiqueta.

- Un cobro admite hasta 20 lineas con importe, metodo y referencia:
  Cash App, Zelle, cashier check, tarjeta o efectivo. Los metodos distintos
  de efectivo requieren referencia. Se confirma que el dinero fue recibido
  y verificado; transferencias o cheques pendientes no cuentan como cobrado.
  Es un registro interno: no procesa tarjetas ni mueve dinero en bancos.
  Nunca se deben registrar numeros completos de tarjeta ni CVV.
- Se conserva el acumulado anterior y se suma cada cobro nuevo en centavos.
  El formulario muestra saldo anterior, ajuste de core, cobro nuevo y saldo
  final. No permite importes negativos, fracciones de centavo ni sobrecobros.
- El cliente paga el core o entrega fisicamente la pieza usada. Recibirla
  requiere referencia y confirmacion, conserva un comprobante inmutable y
  elimina el cargo una sola vez. No permite eliminarlo si los cobros previos
  superan el total sin core: corresponde tramitar la devolucion en Reembolsos,
  no borrar pagos. Los pagos historicos no identifican a que concepto se
  asignaron; el formulario no inventa esa distribucion.
- Administracion conserva el permiso para registrar cobros y recibir core.
  El operador asignado puede consultar el historial y confirmar una entrega
  ya liquidada. La edicion general ya no modifica el acumulado cobrado.
  El abono informado al crear una orden conserva el comportamiento anterior
  y se identifica sin metodo; los nuevos cobros usan el formulario desglosado.
- La entrega exige saldo cero, evidencia y confirmacion fisica. Las ordenes
  del flujo verificable siguen exigiendo las etapas previas. En ese flujo,
  el cobro, core, evidencia, inventario, entrega y comienzo de garantia se
  guardan juntos en una transaccion. Si falla cualquier paso no se guarda
  ninguno. Las entregas legacy tambien pasan por el formulario con evidencia.
- Cada linea conserva metodo, referencia, fecha y autor. Los registros
  anteriores permanecen como **Metodo no registrado**, sin inventar fechas.
  Version de orden y bloqueo de fila rechazan reintentos o cobros concurrentes
  con datos antiguos. Ante un error de conexion, recargar y revisar el
  historial antes de intentar nuevamente.

Migracion aditiva: `migrations/023_order_payments.sql`; ejecutar con la cuenta
DDL, respaldo previo y sin seed. No modifica importes historicos.
Validacion: `npm test -- tests/order-payments.test.ts tests/order-payments-api.test.ts`
y los scripts locales `scripts/test-order-workflow-db.ts` y
`scripts/test-order-workflow-ui.ts`, que usan solo datos sinteticos.

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
guardada. DM Sans e iconos Material Symbols se sirven desde los paquetes
Fontsource incluidos en el build, sin depender de Google para esas fuentes.
Los modales de seguimiento post-entrega y registro de contacto se renderizan
fuera de `#root`; su estilo compartido usa `.horizon-followup-portal` para
mantener el mismo tema claro/oscuro sin alterar las reglas de seguimiento.

### Revision visual del 4 de noviembre de 2026

Se compararon los componentes comunes con el codigo de Horizon UI Chakra
([revision de referencia](https://github.com/horizon-ui/horizon-ui-chakra/tree/27a99f9fb391e9da126e91cf109b3afd953fb58b),
licencia MIT). Su demo publica estaba pausada; la referencia utilizada fue
el tema, las tarjetas, los botones, los inputs, el sidebar y el navbar del repositorio.
No se incorporaron Chakra, rutas ni datos de demostracion al producto.

| Superficie de Radar | Adaptacion visual |
| --- | --- |
| Sidebar y encabezado | Navegacion con indicador violeta, titulo de vista, herramientas agrupadas y drawer movil |
| Dashboard y vistas | Fondo `#f4f7fe` / `#0b1437`, tarjetas blancas / `#111c44`, radios de 20px y sombras suaves |
| Tablas, formularios y botones | Encabezados discretos, inputs de 16px, foco visible y acciones primarias violetas |
| Modales y ventanas flotantes | Hook `horizon-modal`, panel uniforme, fondos y controles compartidos; incluye portales de seguimiento |
| Estados operativos | Verde, ambar y rojo conservan su significado; no se transforman en superficies neutras |

Los cambios no modifican callbacks, API, estados de orden, calculos financieros,
garantias ni autorizacion. Las reglas del tema siguen dentro de `@media screen`
para no cambiar los documentos impresos. Esta revision local no implica despliegue.

Comprobacion de navegador reproducible: compilar con `VITE_API_URL=/api npm run build`,
servir el frontend con `npm run preview -- --host 127.0.0.1 --port 3000` y ejecutar
`npm run test:ui:horizon` en otra terminal. Requiere Google Chrome local
(`CHROME_PATH` permite indicar su ejecutable). Intercepta las API con datos sinteticos
y no usa credenciales reales, bases de datos ni envios externos. Comprueba
1440/768/375px, claro/oscuro, navegacion, detalle de orden y modales comunes.
`HORIZON_SCREENSHOT_DIR` habilita capturas opcionales fuera del repositorio.
Las comprobaciones de alcance CSS e impresion estan en `tests/horizon-theme.test.ts`.
La suite general contiene aserciones de fecha sensibles al huso horario:
en esta Mac dos fallan con el huso local y pasan con `TZ=UTC`; en UTC, la prueba
de `Hoy` del dashboard falla cuando el dia UTC difiere del dia de negocio
`America/New_York`. No se cambiaron esas reglas ni esas pruebas en esta revision.

La segunda revision corrige la composicion, no solamente los colores:
navegacion agrupada en Operacion y Administracion, encabezado con un solo
titulo principal, KPIs compactos con icono lateral como `MiniStatistics`
de Horizon, controles de periodo en una tarjeta y graficas violetas.
La lista de ordenes agrupa acciones, pestanas de estatus, filtros y tabla
en una superficie unica; conserva todos los segmentos y sus contadores.
El asistente de ordenes usa pasos redondeados, sin cambiar su validacion.
Las pruebas de navegador verifican la geometria de los KPIs y la seleccion
de segmentos, ademas de las comprobaciones anteriores.

La referencia visual confirmada es **HORIZON FREE / Main Dashboard** de la
[imagen oficial del repositorio](https://i.ibb.co/fdyTwz1/introduction-image-2.png).
El dashboard sigue su composicion: seis indicadores en una fila de escritorio,
dos tarjetas de graficas de igual ancho y una fila inferior con tabla,
volumen y distribucion circular. Los controles de periodo son compactos,
sin tarjeta introductoria. Las graficas representan ingresos netos acumulados,
ingresos netos por fecha efectiva y ordenes creadas; no se incluyen ventas,
trafico ni porcentajes ficticios de la demo. Se conservan estados vacios,
errores de acceso financiero, precision de centavos, periodos y acciones.
La comprobacion visual mide altura de indicadores, alineacion de filas,
igualdad de ancho de graficas y posicion de los modulos inferiores.

### Adaptacion global de vistas y modales

Las vistas de ordenes y su detalle, clientes, inventario, reclamos, reembolsos,
operaciones, relacion semanal, sistema y usuarios usan el contrato `horizon-view`.
Los encabezados usan `horizon-view-header`: titulo legible, descripcion y acciones,
sin el marco HUD ni rutas decorativas. El detalle de orden separa identificacion,
acciones, pestanas y seguimiento; sus tres tarjetas de resumen tienen espacio
interior y jerarquia tipografica compartidos. Factura y rotulo adoptan solamente
el encabezado de pantalla; sus documentos y reglas de impresion no se redisenan.

Los paneles `horizon-modal` comparten tipografia, superficie, inputs y limites
de altura. Las vistas no conservan transformaciones de entrada que hacian que
los overlays fijos quedaran contenidos y recortados dentro de la vista.
Los modales quedan por encima del widget de notas; se conserva la prioridad
del portal de registro de seguimiento. Las acciones de mensajeria se distribuyen
en varias filas cuando no caben, sin ocultar botones ni cambiar los envios.

`npm run test:ui:horizon` comprueba las diez rutas en ambos temas a
1440/1150/768/375px, el detalle de orden y sus pestanas, y quince variantes
adicionales de dialogo a 1150/375px: asesor, mensajeria, cliente nuevo/edicion,
inventario nuevo/edicion/ficha/impresion, reclamo nuevo/llamadas, colaborador,
traspaso, nomina, gastos recurrentes y gasto nuevo. Incluye el formulario de
reembolso y detalle de reclamo, y verifica finanzas bloqueadas y desbloqueadas
solo con respuestas sinteticas. Comprueba dimensiones reales, fuentes, superficies,
desbordamiento y acciones no recortadas. No realiza escrituras ni envios externos.
Esta cobertura no equivale a probar cada estado posible de cada formulario,
ni certifica fidelidad visual pixel a pixel o cobertura de codigo del 80%.

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
- `Pagado` indica que se recibió el downpayment y la orden puede procesarse; no
  significa que el total esté liquidado. Para pasar a `Entregado`, el total
  registrado debe estar cubierto. Los cobros se registran en finanzas al aumentar
  el downpayment; el cambio de estatus por sí solo no genera un cobro.
- El seguimiento post-entrega incluye órdenes entregadas después del
  26 de octubre de 2026 (fecha de negocio `America/New_York`). Las anteriores
  se excluyen de la lista de pendientes sin modificar su bitácora.
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
- La garantía requiere evidencia de entrega: fecha e inicio registrados o un evento
  `Entregado` en la bitácora. Si falta la fecha, se usa la primera entrega de la
  bitácora; resolver reclamos no reinicia el plazo. El detalle muestra el vencimiento
  y la API rechaza nuevos reclamos con garantía expirada (HTTP 409).
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

Seguir la [guia de despliegue](./DESPLIEGUE_PRODUCCION.md): subir una rama no
actualiza produccion; hay que integrar a `main`, confirmar el despliegue de esa
revision en Dokploy y verificar la aplicacion por HTTPS.

## Estado actual

El proyecto está operativo en local y preparado para producción. Los módulos de uploads y Wasender están desacoplados y configurables, pero permanecen sin envíos externos automáticos hasta que se definan credenciales, destinatarios y reglas de negocio. Las llamadas no tienen un módulo independiente ni endpoints de registro directo; los datos históricos que puedan estar asociados a reclamos se conservan como referencia.
