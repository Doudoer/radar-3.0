# Despliegue de Radar

## Camino normal

1. Subir cambios mediante un PR hacia `main`.
2. GitHub Actions ejecuta `npm ci`, las pruebas con `TZ=UTC`, TypeScript,
   build y las pruebas del release gate. Los PR no reciben claves de despliegue.
3. Al actualizar `main`, el job del entorno `production` envia el archivo del
   mismo SHA al VPS mediante SSH con clave dedicada y comando restringido.
4. El gate construye una imagen candidata y conserva la imagen anterior,
   configuracion, SQL comprimido validado, SHA256 y archivos persistentes.
5. Si existen migraciones pendientes, pausa la app, restaura el respaldo en
   MariaDB aislada, ensaya las migraciones y compara cada valor/columna original
   y conteo. Solo entonces migra produccion con un usuario temporal y verifica
   nuevamente los datos originales. La app anterior vuelve a arrancar.
6. Actions avanza la rama `production` al mismo SHA, sin force push. Dokploy
   observa **production**, no `main`, y despliega mediante su integracion GitHub.
7. El gate espera el SHA del checkout, deployment terminado, reemplazo de
   Swarm convergido a un contenedor, imagen realmente activa, healthcheck Docker
   y `/health` HTTPS con base conectada. Cero o dos contenedores durante el
   reemplazo, checkout Git en recreacion (exit 128) y ruta HTTPS aun no lista
   se reintentan dentro del plazo de verificacion, con registro explicito.
   Otros errores de comandos siguen deteniendo la release.

No enviar cambios directamente a `production`: saltaria las pruebas y el gate.
La concurrencia de Actions no cancela una release activa; el servidor tambien
usa un lock exclusivo. No hay migraciones automaticas al arrancar la API.

## Instalacion y acceso

- Workflow: [production.yml](./.github/workflows/production.yml).
- Gate auditado: [release.py](./deploy/release.py). Se instala como archivo
  root-owned `/usr/local/lib/radar/release.py`; actualizarlo deliberadamente
  por una sesion administrativa al modificarlo, no desde el artefacto recibido.
- La clave SSH de CI tiene `restrict` y forced command. Solo admite
  `prepare <sha-completo>` y `verify <sha-completo>`; no shell, PTY ni forwarding.
- Secrets del entorno GitHub `production`: `RADAR_DEPLOY_SSH_KEY`,
  `RADAR_DEPLOY_KNOWN_HOSTS`, `RADAR_DEPLOY_HOST`. Nunca guardar sus valores
  en Git, mensajes o logs.
- Mantener el entorno de despliegue limitado a `main`.
- Clon de trabajo local: `/Users/doudoer/Developer/radar-3.0`.

El runtime conserva su cuenta DML sin DDL. El gate crea una cuenta migradora
temporal, elimina sus permisos y archivos de credenciales al terminar. No
ejecuta seeds ni reemplaza produccion por una base local. Los binds siguen:
`/var/lib/radar-data/uploads` y `/var/lib/radar-data/backups`.

## Fallos y recuperacion

- Prueba/build/rehearsal fallidos: no se promueve `production`.
- El gate rechaza migraciones no aditivas, archivos de credenciales y enlaces
  en el artefacto, asi como revisiones que omitan migraciones ya aplicadas.
- Las migraciones aditivas pueden quedar aplicadas parcialmente si MariaDB
  falla: el gate mantiene la app anterior y exige inspeccion administrativa
  antes de reintentar. No borra automaticamente el directorio fallido.
- Verificacion fallida tras promover: vuelve a la imagen anterior sin restaurar
  SQL ni sobrescribir nuevas ventas. Revisar Actions y logs privados de Dokploy.
- Respaldos y evidencia: `/root/radar-releases/<sha>/`, privados para root.
  Conservarlos fuera de Git. No hay borrado automatico de releases; revisar
  espacio y retencion de forma administrativa.
- Para reintentar un SHA que ya tiene directorio, inspeccionar primero el
  error y respaldo; no borrar evidencia ni promover manualmente a ciegas.
- DDL destructivo, cambios incompatibles o migraciones de datos necesitan un
  procedimiento revisado aparte, no relajar el gate automaticamente.

## Verificacion local del gate

```sh
python3 -m unittest discover -s tests -p test_release.py
TZ=UTC npm test
npm run lint
npm run build
```

RED se registro al ejecutar las pruebas antes de implementar el gate
(`deploy/release.py` ausente). Las pruebas unitarias cubren comandos permitidos,
SHA exacto, rechazo de traversal/enlaces/credenciales, inventario de migraciones
y nuevas lineas en variables. El ensayo SQL y el despliegue real son evidencia
operativa adicional; las pruebas unitarias no demuestran por si solas
recuperacion ante perdida total del VPS o fallos de disco.
