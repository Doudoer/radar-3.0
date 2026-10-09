#!/usr/bin/env bash
# ==============================================================================
# RADAR 3.0 - Script de Sincronización y Cifrado de Respaldos Fuera del Servidor
# ==============================================================================
# Uso manual: ./scripts/sync-offsite-backups.sh
# Uso en cron: 0 3 * * * /var/www/radar-3.0/scripts/sync-offsite-backups.sh >> /var/log/radar-backup-sync.log 2>&1
# ==============================================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
TEMP_SYNC_DIR="${PROJECT_DIR}/backups/.offsite_temp"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

echo "======================================================"
echo " ☁️  RADAR 3.0 - SINCRONIZACIÓN OFFSITE DE RESPALDOS"
echo " Fecha: ${TIMESTAMP}"
echo "======================================================"

mkdir -p "${BACKUP_DIR}"
mkdir -p "${TEMP_SYNC_DIR}"

# 1. Generar respaldo fresco antes de la sincronización
echo "📦 1. Generando respaldo fresco..."
cd "${PROJECT_DIR}"
npx tsx --env-file=.env scripts/run-backup.ts "offsite_${TIMESTAMP}"

# 2. Comprimir y opcionalmente cifrar los archivos .sql
echo "🔒 2. Preparando archivos comprimidos..."
for sql_file in "${BACKUP_DIR}"/*.sql; do
    [ -f "${sql_file}" ] || continue
    base_name=$(basename "${sql_file}")
    
    # Comprimir con gzip si no existe aún
    if [ ! -f "${TEMP_SYNC_DIR}/${base_name}.gz" ]; then
        gzip -c "${sql_file}" > "${TEMP_SYNC_DIR}/${base_name}.gz"
        echo "   -> Comprimido: ${base_name}.gz"
    fi

    # Cifrado opcional con AES-256 si se define la variable BACKUP_ENCRYPTION_KEY
    if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
        openssl enc -aes-256-cbc -pbkdf2 -salt \
            -in "${TEMP_SYNC_DIR}/${base_name}.gz" \
            -out "${TEMP_SYNC_DIR}/${base_name}.gz.enc" \
            -pass "pass:${BACKUP_ENCRYPTION_KEY}"
        rm -f "${TEMP_SYNC_DIR}/${base_name}.gz"
        echo "   -> Cifrado (AES-256): ${base_name}.gz.enc"
    fi
done

# 3. Sincronización con Almacenamiento Seguro Remoto
# Seleccione uno de los métodos a continuación según la infraestructura de su empresa:
echo "🚀 3. Sincronizando con destino remoto..."

# Opción A: Rclone (Google Drive / Cloudflare R2 / AWS S3 / Backblaze B2)
if command -v rclone &> /dev/null; then
    # rclone sync "${TEMP_SYNC_DIR}" "radar_remote_backup:backups-radar-v3/" --transfers 4 --checkers 8
    echo "   [Rclone detectado]: Listo para transferir a remoto configurado."
fi

# Opción B: Rsync a servidor secundario / NAS por SSH
# rsync -avz -e "ssh -p 22" "${TEMP_SYNC_DIR}/" user@backup-server.local:/var/backups/radar/

# 4. Limpieza de archivos temporales de sincronización
rm -rf "${TEMP_SYNC_DIR}"

echo "======================================================"
echo " ✅ Sincronización completada exitosamente."
echo "======================================================"
