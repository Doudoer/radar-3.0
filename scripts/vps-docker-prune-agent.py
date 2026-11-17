#!/usr/bin/env python3
"""
Agente ligero de limpieza para el host del VPS (Dokploy / RADAR).
- Ejecuta prune seguro de imágenes Docker y caché de builds (> 7 días),
  sin tocar contenedores activos ni volúmenes de base de datos/uploads.
- Limpia carpetas antiguas de /root/radar-releases conservando siempre las 5 más recientes.

Uso en el VPS:
  MAINTENANCE_SECRET=tu_secreto HOST=172.18.0.1 PORT=9898 python3 scripts/vps-docker-prune-agent.py
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
import re
import shutil
import subprocess
import time

PORT = int(os.environ.get('PORT', '9898'))
HOST = os.environ.get('HOST', '172.18.0.1')
SECRET = os.environ.get('MAINTENANCE_SECRET', '').strip()
RELEASES_DIR = os.environ.get('RADAR_RELEASES_DIR', '/root/radar-releases')
KEEP_RELEASES = max(3, int(os.environ.get('KEEP_RELEASES', '5')))
SHA_DIR_RE = re.compile(r'^[0-9a-f]{40}$')

if not SECRET:
    raise SystemExit('Falta MAINTENANCE_SECRET en variables de entorno.')


def dir_size_bytes(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            fp = os.path.join(root, name)
            try:
                if not os.path.islink(fp):
                    total += os.path.getsize(fp)
            except OSError:
                pass
    return total


def prune_old_releases() -> dict:
    if not os.path.isdir(RELEASES_DIR):
        return {'removedCount': 0, 'keptCount': 0, 'freedBytes': 0}

    entries = []
    now = time.time()
    for name in os.listdir(RELEASES_DIR):
        if not SHA_DIR_RE.match(name):
            continue
        full = os.path.join(RELEASES_DIR, name)
        if not os.path.isdir(full) or os.path.islink(full):
            continue
        try:
            mtime = os.path.getmtime(full)
            entries.append((mtime, name, full))
        except OSError:
            continue

    # Más recientes primero
    entries.sort(key=lambda item: item[0], reverse=True)
    to_keep = entries[:KEEP_RELEASES]
    candidates = entries[KEEP_RELEASES:]

    removed_count = 0
    freed_bytes = 0
    for mtime, _name, full in candidates:
        # Nunca borrar una carpeta modificada en las últimas 2 horas (por seguridad ante deploys en curso)
        if (now - mtime) < 7200:
            to_keep.append((mtime, _name, full))
            continue
        size = dir_size_bytes(full)
        shutil.rmtree(full, ignore_errors=False)
        removed_count += 1
        freed_bytes += size

    return {
        'removedCount': removed_count,
        'keptCount': len(to_keep),
        'freedBytes': freed_bytes,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def check_auth(self) -> bool:
        provided = (self.headers.get('x-maintenance-secret') or '').strip()
        if not provided or not hmac.compare_digest(provided, SECRET):
            self.send_json(401, {'message': 'Secreto inválido'})
            return False
        return True

    def do_GET(self) -> None:  # noqa: N802
        if not self.check_auth():
            return
        if self.path == '/stats':
            try:
                proc = subprocess.run(
                    ['docker', 'system', 'df'],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=True,
                )
                self.send_json(200, {'ok': True, 'output': proc.stdout.strip()})
            except Exception as exc:
                self.send_json(500, {'message': str(exc)})
            return
        self.send_json(404, {'message': 'Ruta no encontrada'})

    def do_POST(self) -> None:  # noqa: N802
        if not self.check_auth():
            return
        if self.path == '/prune':
            try:
                img = subprocess.run(
                    ['docker', 'image', 'prune', '-af', '--filter', 'until=168h'],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=True,
                )
                bld = subprocess.run(
                    ['docker', 'builder', 'prune', '-af', '--filter', 'until=168h'],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=True,
                )
                releases = prune_old_releases()
                self.send_json(
                    200,
                    {
                        'ok': True,
                        'imagesOutput': img.stdout.strip(),
                        'builderOutput': bld.stdout.strip(),
                        'releasesRemoved': releases['removedCount'],
                        'releasesKept': releases['keptCount'],
                        'releasesBytesFreed': releases['freedBytes'],
                    },
                )
            except Exception as exc:
                self.send_json(500, {'message': str(exc)})
            return
        self.send_json(404, {'message': 'Ruta no encontrada'})


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'[RADAR VPS Prune Agent] Escuchando en http://{HOST}:{PORT}', flush=True)
    server.serve_forever()
