# Checkpoint Radar V3 - 2026-09-17

## Estado

- Proyecto: `/Users/user/Desktop/Radar V3/radar-3.0`
- Rama: `main`
- Remoto: `git@github.com:Doudoer/radar-3.0.git`
- Produccion: `https://radar-rsy.store/`
- Estado Git al actualizar este checkpoint:
  - `src/components/StatusRequestModal.tsx` modificado.
  - `CHECKPOINT_2026-09-17.md` sin seguimiento.
- Ultimo commit local/remoto: `d57a1a6 fix: make status request action prominent`

## Ultimos cambios implementados

- Se elimino Alertas IA y Reportes IA.
- Se elimino el modulo independiente de llamadas.
- Se elimino Buscar Piezas, Car-Part, VIN Decoder y subastas.
- Se elimino la campana y el servicio de notificaciones.
- Se agrego gestion de usuarios, permisos y baja logica de usuarios ajenos.
- Relacion Semanal exige OTP real generado en la sesion; no existe bypass Super Admin.
- Se agrego backup SQL total desde Sistema para administradores.
- Se agrego bloc de notas personal flotante y persistente por usuario.
- El bloc tiene autosave con debounce y mensajeria interna entre usuarios.
- El detalle de reclamos se convirtio en vista completa, no modal.
- Los modales secundarios de reclamos respetan el viewport.
- Se agrego Solicitar status en Ordenes:
  - rango de fechas;
  - filtros de Cotizacion, Pagado, En preparacion y En espera de confirmacion;
  - seleccion total o individual;
  - descarga de PDF con nombre, ano, marca, modelo, tipo ENG/TRA, descripcion y VIN.
- `pdf-lib` fue agregado para generar el PDF en frontend.
- El PDF de Solicitar status fue redisenado con el formato operativo de patio:
  - orientacion horizontal y tabla paginada;
  - fecha, cliente, ano, marca, modelo, tipo ENG/TRA y especificaciones;
  - clasificacion VENTA/CAMBIO;
  - notas/status de patio con retiro o envio como respaldo;
  - inclusion del filtro Cambio/Reclamo;
  - resaltado de cambios urgentes y ordenes con indicacion de buscar en yarda;
  - encabezados repetidos en paginas adicionales.

## Validaciones recientes

Ejecutadas correctamente antes del checkpoint:

```bash
npm run lint
npm run build
npm run build:api
npm audit --omit=dev
git diff --check
```

Despues del rediseño del PDF se ejecutaron correctamente:

```bash
npm run lint
npm run build
git diff --check
```

Aviso conocido: Vite reporta que el bundle frontend supera 500 KB debido a `pdf-lib`.

## Para continuar despues del reinicio

```bash
cd "/Users/user/Desktop/Radar V3/radar-3.0"
export PATH="/Users/user/.nvm/versions/node/v24.18.0/bin:/usr/bin:/bin"
npm install
npm run lint
npm run build
npm run build:api
```

Para desarrollo con API y frontend separados:

Terminal 1:

```bash
cd "/Users/user/Desktop/Radar V3/radar-3.0"
export PATH="/Users/user/.nvm/versions/node/v24.18.0/bin:/usr/bin:/bin"
PORT=3001 npm run api
```

Terminal 2:

```bash
cd "/Users/user/Desktop/Radar V3/radar-3.0"
export PATH="/Users/user/.nvm/versions/node/v24.18.0/bin:/usr/bin:/bin"
VITE_API_URL=http://localhost:3001/api npm run dev -- --port 3000
```

Abrir `http://localhost:3000`.

Al actualizar este checkpoint, el frontend local estaba disponible en `http://127.0.0.1:3000` y mostraba correctamente la pantalla de inicio de sesion.

## Produccion / Dokploy

- Los cambios estan publicados en `origin/main`.
- Despues de reiniciar, Dokploy puede requerir un redeploy para tomar el ultimo commit.
- Verificar:

```bash
curl -i https://radar-rsy.store/health
```

Debe responder `200` y `database: connected`.

## Siguiente punto sugerido

1. Iniciar sesion localmente y abrir `Ordenes -> Solicitar status`.
2. Seleccionar un rango con ordenes reales y descargar el PDF.
3. Confirmar visualmente que la tabla coincide con el formato de patio y que las notas reales no se desbordan.
4. Ajustar cualquier regla de negocio pendiente para VENTA/CAMBIO o notas de patio si los datos reales requieren otro criterio.
5. Solo despues de aprobarlo localmente, preparar el commit local. No subir cambios al remoto sin solicitud expresa.

## Nota operativa

La sesion SSH usada anteriormente a `root@46.225.4.89` devolvia codigo `255`; no depender de SSH directo sin revisar primero la configuracion/autenticacion. El repositorio remoto si esta accesible mediante Git con `/usr/bin/ssh` explicito.
