import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../services/apiFetch';

interface BackupItem {
  filename: string;
  sizeBytes: number;
  formattedSize: string;
  createdAt: string;
  isSafetySnapshot: boolean;
  isRootFile: boolean;
}

interface RestoreResult {
  ok: boolean;
  message: string;
  restoredTables?: string[];
  clearedTables?: string[];
  preservedUsersCount?: number;
  safetySnapshot?: string;
  durationMs?: number;
  timestamp?: string;
}

interface SystemSettingsViewProps {
  userRole?: 'admin' | 'operador';
  onOpenChangePassword?: () => void;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  userRole = 'admin',
  onOpenChangePassword,
}) => {
  const isSuperAdmin = userRole === 'admin';

  // Backups state
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // File Upload State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileStats, setFileStats] = useState<{ sizeFormatted: string; detectedTables: string[] } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore Modal State
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{
    type: 'local' | 'upload';
    filename?: string;
    file?: File;
    label: string;
    size: string;
  } | null>(null);
  const [createSafetySnapshot, setCreateSafetySnapshot] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStepIndex, setRestoreStepIndex] = useState(0);
  const [restoreStepName, setRestoreStepName] = useState('');
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoadingBackups(true);
    try {
      const response = await apiFetch('/system/backups');
      if (response.ok) {
        const data = await response.json();
        setBackups(data);
      }
    } catch {
      // Ignore error
    } finally {
      setLoadingBackups(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void fetchBackups();
  }, [fetchBackups]);

  // Handle immediate snapshot creation
  const handleCreateSnapshot = async () => {
    setCreatingBackup(true);
    setBackupMessage(null);
    try {
      const response = await apiFetch('/system/backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'manual' }),
      });
      if (!response.ok) throw new Error('No se pudo generar el punto de respaldo');
      const data = await response.json();
      setBackupMessage({ type: 'success', text: `Punto de respaldo "${data.filename}" generado exitosamente.` });
      await fetchBackups();
    } catch (error) {
      setBackupMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al generar respaldo' });
    } finally {
      setCreatingBackup(false);
    }
  };

  // Download SQL file
  const handleDownloadBackup = async (filename?: string) => {
    try {
      const url = filename
        ? `/system/backup/download?file=${encodeURIComponent(filename)}`
        : '/system/backup';
      const response = await apiFetch(url);
      if (!response.ok) throw new Error('No se pudo descargar el archivo.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename || response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'radar-backup.sql';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setBackupMessage({ type: 'error', text: 'Error al descargar el archivo de respaldo.' });
    }
  };

  // Parse uploaded .sql file locally for quick stats
  const processUploadedFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.sql')) {
      setBackupMessage({ type: 'error', text: 'Solo se admiten archivos con formato .sql' });
      return;
    }

    setUploadedFile(file);
    setBackupMessage(null);

    const sizeInMB = file.size / (1024 * 1024);
    const sizeFormatted = sizeInMB >= 1 ? `${sizeInMB.toFixed(2)} MB` : `${(file.size / 1024).toFixed(1)} KB`;

    // Read first 64KB to detect table structures
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      const detected: string[] = [];
      const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?/gi;
      let match;
      while ((match = tableRegex.exec(text)) !== null) {
        if (!detected.includes(match[1]) && detected.length < 8) {
          detected.push(match[1]);
        }
      }
      setFileStats({ sizeFormatted, detectedTables: detected });
    };
    reader.readAsText(file.slice(0, 65536));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  // Open Restore Confirmation Modal
  const openRestoreModalForLocal = (item: BackupItem) => {
    setRestoreTarget({
      type: 'local',
      filename: item.filename,
      label: item.filename,
      size: item.formattedSize,
    });
    setConfirmText('');
    setRestoreResult(null);
    setRestoreError(null);
    setRestoreProgress(0);
    setRestoreStepIndex(0);
    setRestoreStepName('');
    setIsRestoreModalOpen(true);
  };

  const openRestoreModalForUpload = () => {
    if (!uploadedFile) return;
    setRestoreTarget({
      type: 'upload',
      file: uploadedFile,
      label: uploadedFile.name,
      size: fileStats?.sizeFormatted || `${(uploadedFile.size / 1024).toFixed(1)} KB`,
    });
    setConfirmText('');
    setRestoreResult(null);
    setRestoreError(null);
    setRestoreProgress(0);
    setRestoreStepIndex(0);
    setRestoreStepName('');
    setIsRestoreModalOpen(true);
  };

  // Execute the Restore / Rollback Operation
  const executeRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreResult(null);
    setRestoreProgress(10);
    setRestoreStepIndex(1);
    setRestoreStepName('Iniciando y preparando conexión a la base de datos...');

    const interval = setInterval(() => {
      setRestoreProgress((prev) => {
        if (prev < 25) {
          setRestoreStepIndex(1);
          setRestoreStepName('Generando snapshot de seguridad previo...');
          return prev + 3;
        }
        if (prev < 50) {
          setRestoreStepIndex(2);
          setRestoreStepName('Resguardando usuarios y accesos autorizados...');
          return prev + 2;
        }
        if (prev < 75) {
          setRestoreStepIndex(3);
          setRestoreStepName('Vaciando base de datos a cero (dejando tablas en blanco)...');
          return prev + 1.5;
        }
        if (prev < 94) {
          setRestoreStepIndex(4);
          setRestoreStepName('Cargando y ejecutando registros del archivo SQL...');
          return prev + 0.8;
        }
        return prev;
      });
    }, 200);

    try {
      let payload: { filename?: string; sqlContent?: string; createSafetySnapshot: boolean };

      if (restoreTarget.type === 'local' && restoreTarget.filename) {
        payload = {
          filename: restoreTarget.filename,
          createSafetySnapshot,
        };
      } else if (restoreTarget.type === 'upload' && restoreTarget.file) {
        setRestoreStepName('Leyendo contenido del archivo SQL local...');
        const sqlText = await restoreTarget.file.text();
        payload = {
          sqlContent: sqlText,
          createSafetySnapshot,
        };
      } else {
        throw new Error('No se especificó origen de restauración válido');
      }

      const response = await apiFetch('/system/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Error durante la restauración de la base de datos');
      }

      clearInterval(interval);
      setRestoreProgress(100);
      setRestoreStepIndex(5);
      setRestoreStepName('¡Restauración y verificación completadas con éxito!');
      setRestoreResult(data);
      await fetchBackups();
    } catch (error) {
      clearInterval(interval);
      setRestoreError(error instanceof Error ? error.message : 'Error inesperado al restaurar');
    } finally {
      clearInterval(interval);
      setRestoring(false);
    }
  };

  return (
    <div className="radar-view space-y-6">
      {/* Cyber Header Card */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-indigo-500 shadow-[0_0_12px_#22d3ee]" />

        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-[#040814] border border-cyan-500/40 text-cyan-300 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)] shrink-0">
            <span className="material-symbols-outlined text-[26px]">settings</span>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Configuración del Sistema & Seguridad</h1>
              <span className="text-[11px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full shadow-[0_0_8px_rgba(6,182,212,0.25)]">
                /settings
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Parámetros globales de la plataforma, recuperación ante desastres y gestión de base de datos.
            </p>
          </div>
        </div>
      </div>

      {/* SUPER ADMIN: Disaster Recovery & Backup Center */}
      {isSuperAdmin && (
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-6">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cyan-500/15 pb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                  <span className="material-symbols-outlined text-[19px]">database</span>
                </div>
                <h2 className="text-base font-black text-white uppercase font-mono tracking-wider">
                  Centro de Respaldos & Rollback (Disaster Recovery)
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Módulo exclusivo para <strong>Super Administradores</strong>. Permite crear puntos de restauración, descargar copias SQL y aplicar rollbacks instantáneos ante pérdidas de datos.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => void handleCreateSnapshot()}
                disabled={creatingBackup}
                className="cyber-btn-primary px-4 py-2.5 text-xs font-black flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {creatingBackup ? 'sync' : 'add_circle'}
                </span>
                <span>{creatingBackup ? 'Generando Snapshot...' : 'Crear Respaldo Ahora'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleDownloadBackup()}
                className="cyber-btn-secondary px-3.5 py-2.5 text-xs font-bold flex items-center gap-1.5"
                title="Descargar volcado dinámico SQL actual"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                <span className="hidden sm:inline">Descarga Directa</span>
              </button>
            </div>
          </div>

          {backupMessage && (
            <div
              className={`p-3.5 rounded-2xl text-xs font-mono flex items-center justify-between gap-2 ${
                backupMessage.type === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-300'
                  : 'bg-red-950/40 border border-red-500/40 text-red-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {backupMessage.type === 'success' ? 'check_circle' : 'error'}
                </span>
                <span>{backupMessage.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setBackupMessage(null)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          )}

          {/* Section: Upload .sql file for restoration */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-1 bg-[#040814] rounded-2xl border border-cyan-500/20 p-4 flex flex-col justify-between gap-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-cyan-400 text-[18px]">upload_file</span>
                  Subir y Restaurar Archivo .SQL
                </h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Arrastra o selecciona un archivo <code className="text-cyan-300">.sql</code> (ej. tu respaldo funcional) para restaurar tablas y registros a MySQL.
                </p>

                {/* Dropzone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`mt-3.5 p-5 rounded-xl border-2 border-dashed transition-all text-center cursor-pointer flex flex-col items-center justify-center gap-2 ${
                    dragActive
                      ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                      : 'border-cyan-500/30 bg-[#070c18]/80 hover:border-cyan-400 hover:bg-[#0c162d]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".sql"
                    onChange={(e) => e.target.files?.[0] && processUploadedFile(e.target.files[0])}
                    className="hidden"
                  />
                  <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <span className="material-symbols-outlined text-[22px]">cloud_upload</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-200">
                    {uploadedFile ? uploadedFile.name : 'Haz clic o arrastra tu archivo .sql'}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Formato soportado: .SQL (hasta 50MB)</span>
                </div>

                {uploadedFile && fileStats && (
                  <div className="mt-3 p-3 rounded-xl bg-[#091122] border border-cyan-500/30 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-mono text-[11px]">Tamaño detectado:</span>
                      <span className="font-mono text-cyan-300 font-bold">{fileStats.sizeFormatted}</span>
                    </div>
                    {fileStats.detectedTables.length > 0 && (
                      <div>
                        <span className="text-slate-400 font-mono text-[10px] block mb-1">Tablas identificadas:</span>
                        <div className="flex flex-wrap gap-1">
                          {fileStats.detectedTables.map((tbl) => (
                            <span key={tbl} className="px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/30 text-[9px] font-mono text-cyan-300">
                              {tbl}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {uploadedFile && (
                <button
                  type="button"
                  onClick={openRestoreModalForUpload}
                  className="w-full bg-gradient-to-r from-amber-500 to-red-500 hover:from-amber-400 hover:to-red-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer active:scale-95 transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">restore</span>
                  <span>Restaurar desde este archivo</span>
                </button>
              )}
            </div>

            {/* Section: Local / Automatic Backups Table */}
            <div className="lg:col-span-2 bg-[#040814] rounded-2xl border border-cyan-500/20 p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2">
                    <span className="material-symbols-outlined text-emerald-400 text-[18px]">history</span>
                    Respaldos Automáticos y Puntos de Rollback
                  </h3>
                  <button
                    type="button"
                    onClick={() => void fetchBackups()}
                    disabled={loadingBackups}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono cursor-pointer"
                  >
                    <span className={`material-symbols-outlined text-[14px] ${loadingBackups ? 'animate-spin' : ''}`}>
                      refresh
                    </span>
                    <span>Actualizar lista</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Puntos de restauración guardados en el servidor y snapshots de seguridad previos a cambios.
                </p>

                {loadingBackups && backups.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs font-mono flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[18px] animate-spin text-cyan-400">sync</span>
                    <span>Cargando respaldos disponibles...</span>
                  </div>
                ) : backups.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 text-xs font-mono bg-[#070c18] rounded-xl border border-cyan-500/15">
                    No se encontraron respaldos locales. Haz clic en "Crear Respaldo Ahora" para generar el primero.
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                    {backups.map((item) => (
                      <div
                        key={item.filename}
                        className="p-3 bg-[#070c18] rounded-xl border border-cyan-500/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-cyan-500/35 transition-all"
                      >
                        <div className="flex items-start sm:items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              item.isSafetySnapshot
                                ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                                : item.isRootFile
                                ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300'
                                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              {item.isSafetySnapshot ? 'shield' : 'save'}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-white">{item.filename}</span>
                              {item.isSafetySnapshot && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  Safety Snapshot
                                </span>
                              )}
                              {item.isRootFile && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  Raíz
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5 font-mono">
                              <span>📅 {new Date(item.createdAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                              <span>•</span>
                              <span className="text-cyan-300 font-semibold">{item.formattedSize}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => void handleDownloadBackup(item.filename)}
                            className="p-1.5 rounded-lg bg-[#040814] border border-cyan-500/20 hover:border-cyan-400 text-slate-300 hover:text-white transition-all text-xs flex items-center gap-1 cursor-pointer"
                            title="Descargar archivo .sql"
                          >
                            <span className="material-symbols-outlined text-[16px]">download</span>
                            <span className="text-[10px] font-mono">Descargar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openRestoreModalForLocal(item)}
                            className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-400 text-amber-300 font-bold transition-all text-xs flex items-center gap-1 cursor-pointer"
                            title="Restaurar base de datos a este punto"
                          >
                            <span className="material-symbols-outlined text-[16px]">settings_backup_restore</span>
                            <span className="text-[10px] font-mono">Rollback</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Rollback Modal */}
      {isRestoreModalOpen && restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
          <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-red-500/40 rounded-2xl w-full max-w-lg max-h-[90vh] shadow-[0_15px_50px_rgba(239,68,68,0.3)] overflow-hidden flex flex-col text-xs text-slate-300 relative my-auto">
            <div className="h-[2px] bg-gradient-to-r from-transparent via-red-400 to-transparent shadow-[0_0_12px_#ef4444] absolute top-0 inset-x-0" />

            {/* Modal Header */}
            <div className="px-4 py-2.5 border-b border-red-500/20 bg-red-950/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                </div>
                <div>
                  <h3 className="font-black text-white text-xs sm:text-sm tracking-wide uppercase font-mono leading-tight">
                    Restauración de Base de Datos
                  </h3>
                  <span className="text-[9px] text-red-300/80 font-mono">Exclusivo Super Administrador</span>
                </div>
              </div>

              {!restoring && (
                <button
                  type="button"
                  onClick={() => setIsRestoreModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-3.5 sm:p-4 space-y-2.5 overflow-y-auto custom-scrollbar flex-1">
              {restoring ? (
                /* Cyberpunk Animated Progress Section */
                <div className="space-y-2.5">
                  <div className="p-3.5 rounded-xl bg-[#040814] border border-cyan-500/40 shadow-[0_0_25px_rgba(6,182,212,0.2)] space-y-2.5 relative overflow-hidden">
                    <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee] animate-pulse" />

                    {/* Progress Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-ping" />
                        <span className="text-[10px] font-mono font-black text-cyan-300 uppercase tracking-wider">
                          Ejecutando Restauración
                        </span>
                      </div>
                      <span className="text-xs font-mono font-black text-white bg-cyan-950/80 border border-cyan-500/50 px-2 py-0.5 rounded-md shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                        {Math.round(restoreProgress)}%
                      </span>
                    </div>

                    {/* Glowing Progress Bar */}
                    <div className="relative w-full h-2.5 rounded-full bg-slate-950 border border-cyan-500/30 overflow-hidden p-0.5 shadow-inner">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 shadow-[0_0_12px_rgba(34,211,238,0.9)] transition-all duration-300 relative overflow-hidden"
                        style={{ width: `${Math.min(Math.max(restoreProgress, 6), 100)}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      </div>
                    </div>

                    {/* Active Phase Status */}
                    <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-300">
                      <span className="flex items-center gap-1 text-cyan-300 font-semibold truncate">
                        <span className="material-symbols-outlined text-[13px] animate-spin text-cyan-400">sync</span>
                        <span className="truncate">{restoreStepName || 'Procesando volcado SQL...'}</span>
                      </span>
                      <span className="text-slate-400 text-[9.5px] shrink-0 font-mono ml-2">
                        Fase {Math.min(restoreStepIndex, 4)}/4
                      </span>
                    </div>

                    {/* 4-Stage Visual Pipeline */}
                    <div className="grid grid-cols-4 gap-1.5 pt-1.5 border-t border-cyan-500/15">
                      {[
                        { label: 'Snapshot', icon: 'shield' },
                        { label: 'Usuarios', icon: 'group' },
                        { label: 'Vaciado', icon: 'delete_sweep' },
                        { label: 'Carga SQL', icon: 'database' },
                      ].map((step, idx) => {
                        const stepNum = idx + 1;
                        const isDone = restoreStepIndex > stepNum || restoreProgress === 100;
                        const isCurrent = restoreStepIndex === stepNum;
                        return (
                          <div
                            key={step.label}
                            className={`p-1 rounded-md text-center flex flex-col items-center gap-0.5 border transition-all ${
                              isDone
                                ? 'bg-emerald-950/50 border-emerald-500/50 text-emerald-300'
                                : isCurrent
                                ? 'bg-cyan-950/70 border-cyan-400 text-white shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                                : 'bg-slate-900/40 border-slate-800 text-slate-400'
                            }`}
                          >
                            <span className={`material-symbols-outlined text-[12px] ${isCurrent ? 'animate-bounce text-cyan-300' : ''}`}>
                              {isDone ? 'check' : step.icon}
                            </span>
                            <span className="text-[8.5px] font-mono font-bold truncate max-w-full">{step.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <p className="text-center text-[9.5px] text-slate-400 font-mono animate-pulse">
                    ⚠️ No recargues ni cierres la pestaña mientras se ejecuta la restauración.
                  </p>
                </div>
              ) : !restoreResult ? (
                <>
                  <div className="p-2.5 rounded-xl bg-red-950/25 border border-red-500/30 text-[10.5px] text-red-200 leading-snug space-y-1">
                    <p className="font-bold flex items-center gap-1 text-red-300 text-xs">
                      <span className="material-symbols-outlined text-[14px]">report</span>
                      ¡ADVERTENCIA DE SOBREESCRITURA!
                    </p>
                    <p className="text-[10px] text-slate-300">
                      Se vaciarán todas las tablas operativas a cero, <strong className="text-emerald-300">conservando usuarios y claves</strong>, y luego se importará:
                    </p>
                    <div className="p-1.5 bg-[#040814] rounded-lg border border-red-500/20 font-mono text-cyan-300 text-[9.5px] flex justify-between items-center mt-0.5">
                      <span className="truncate">{restoreTarget.label}</span>
                      <span className="font-bold text-white shrink-0 ml-2">({restoreTarget.size})</span>
                    </div>
                  </div>

                  <div className="p-2 bg-[#040814] rounded-xl border border-cyan-500/20 text-xs">
                    <label className="flex items-center gap-2 text-[10.5px] text-slate-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={createSafetySnapshot}
                        onChange={(e) => setCreateSafetySnapshot(e.target.checked)}
                        className="rounded border-cyan-500/40 bg-slate-900 text-cyan-500 focus:ring-cyan-400 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span>
                        Crear punto de restauración previo (<strong>Safety Snapshot</strong>).
                      </span>
                    </label>
                  </div>

                  {restoreError && (
                    <div className="p-2 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 text-[10.5px] font-mono">
                      Error: {restoreError}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10.5px] text-slate-300 block font-mono">
                      Escribe <strong className="text-red-400 font-bold tracking-wider">RESTAURAR</strong> para confirmar:
                    </label>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="RESTAURAR"
                      disabled={restoring}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#040814] border border-cyan-500/30 text-white font-mono text-xs focus:outline-none focus:border-red-400 uppercase tracking-widest text-center"
                    />
                  </div>
                </>
              ) : (
                <div className="py-1 space-y-2">
                  <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      <span>{restoreResult.message}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] font-mono text-slate-400 pt-0.5">
                      {restoreResult.durationMs && (
                        <p>
                          Duración: <strong className="text-white">{(restoreResult.durationMs / 1000).toFixed(2)}s</strong>
                        </p>
                      )}
                      {restoreResult.clearedTables && (
                        <p>
                          Tablas vaciadas: <strong className="text-amber-300">{restoreResult.clearedTables.length}</strong>
                        </p>
                      )}
                      {typeof restoreResult.preservedUsersCount === 'number' && (
                        <p>
                          Usuarios conservados: <strong className="text-emerald-300">{restoreResult.preservedUsersCount}</strong>
                        </p>
                      )}
                      {restoreResult.safetySnapshot && (
                        <p className="truncate col-span-2">
                          Safety Snapshot: <strong className="text-cyan-300">{restoreResult.safetySnapshot}</strong>
                        </p>
                      )}
                    </div>
                  </div>

                  {restoreResult.restoredTables && restoreResult.restoredTables.length > 0 && (
                    <div>
                      <span className="text-[9.5px] font-mono text-slate-400 block mb-0.5">Tablas cargadas:</span>
                      <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto p-1 bg-[#040814] rounded-lg border border-cyan-500/15 custom-scrollbar">
                        {restoreResult.restoredTables.map((tbl) => (
                          <span key={tbl} className="px-1.5 py-0.2 rounded bg-emerald-950/60 border border-emerald-500/30 text-[8.5px] font-mono text-emerald-300">
                            ✓ {tbl}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 border-t border-cyan-500/20 bg-[#0a1022] flex items-center justify-end gap-2 shrink-0">
              {restoring ? (
                <div className="flex items-center gap-1.5 text-cyan-300 font-mono text-xs py-0.5">
                  <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                  <span className="font-bold text-[11px]">Restaurando ({Math.round(restoreProgress)}%)...</span>
                </div>
              ) : !restoreResult ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsRestoreModalOpen(false)}
                    disabled={restoring}
                    className="px-3 py-1.5 rounded-lg bg-[#040814] hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={() => void executeRestore()}
                    disabled={confirmText.trim().toUpperCase() !== 'RESTAURAR' || restoring}
                    className="bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-black px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(239,68,68,0.4)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined text-[15px]">
                      database
                    </span>
                    <span>Confirmar Restauración Total</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsRestoreModalOpen(false);
                    window.location.reload();
                  }}
                  className="cyber-btn-primary px-3.5 py-1.5 text-xs font-black flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[15px]">refresh</span>
                  <span>Finalizar y Recargar</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grid: Server status & Security Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Database & Server Health */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-4">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <h3 className="font-bold text-sm text-white flex items-center gap-2 font-mono uppercase tracking-wider">
            <span className="material-symbols-outlined text-cyan-400 text-[18px]">dns</span>
            <span>Conexión de Base de Datos y Servidor</span>
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Estado del Motor MySQL</span>
              <span className="text-emerald-400 font-mono font-bold flex items-center gap-1.5 neon-badge-emerald px-2.5 py-0.5 rounded-full text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Conectado (MySQL 8.4 Engine)
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Base de Datos Activa</span>
              <span className="font-mono text-cyan-300">radar_v3</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Puerto de Servicio</span>
              <span className="font-mono text-slate-200">3000 / 3001 (Unified Applet)</span>
            </div>
          </div>
        </div>

        {/* Security & MFA */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-4">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <h3 className="font-bold text-sm text-white flex items-center gap-2 font-mono uppercase tracking-wider">
            <span className="material-symbols-outlined text-cyan-400 text-[18px]">security</span>
            <span>Seguridad & Control de Acceso</span>
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Nivel de Acceso Actual</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                isSuperAdmin ? 'neon-badge-emerald' : 'neon-badge-amber'
              }`}>
                {isSuperAdmin ? 'SUPER ADMIN (Total)' : 'OPERADOR (Limitado)'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Protección de Respaldos</span>
              <span className="text-emerald-400 font-mono font-bold">Exclusivo Super Administrador</span>
            </div>
            {onOpenChangePassword && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onOpenChangePassword}
                  className="cyber-btn-secondary w-full py-2.5 px-3 text-xs font-bold justify-center"
                >
                  <span className="material-symbols-outlined text-[16px]">lock_reset</span>
                  <span>Cambiar mi contraseña</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Integrations */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-4 md:col-span-2">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <h3 className="font-bold text-sm text-white flex items-center gap-2 font-mono uppercase tracking-wider">
            <span className="material-symbols-outlined text-cyan-400 text-[18px]">hub</span>
            <span>Integraciones Externas & Mensajería</span>
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Wasender Gateway (WhatsApp)</span>
              <span className="neon-badge-amber px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold">Preparado (configurable vía Dokploy)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
