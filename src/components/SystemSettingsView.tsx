import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../services/apiFetch';
import { HEALTH_URL } from '../services/apiBase';
import { useTheme } from '../hooks/useTheme';
import { WasenderNotificationsManager } from './WasenderNotificationsManager';
import { VaultUnlockModal } from './VaultUnlockModal';

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
  preservedInventoryCount?: number;
  safetySnapshot?: string;
  durationMs?: number;
  timestamp?: string;
}

export type SystemSettingsTab = 'general' | 'whatsapp' | 'pbx' | 'penalties' | 'backups' | 'maintenance';

interface SystemSettingsViewProps {
  userRole?: 'admin' | 'operador';
  onOpenChangePassword?: () => void;
  initialTab?: SystemSettingsTab;
}

const formatWasenderTimestamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'hora no disponible';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return `${date.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })} · ${time}`;
};

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  userRole,
  onOpenChangePassword,
  initialTab = 'general',
}) => {
  const { theme, setTheme } = useTheme();
  const isSuperAdmin = userRole === 'admin';
  const [activeTab, setActiveTab] = useState<SystemSettingsTab>(() => {
    if (!isSuperAdmin && (initialTab === 'pbx' || initialTab === 'penalties' || initialTab === 'backups' || initialTab === 'maintenance')) {
      return 'general';
    }
    return initialTab;
  });

  // Backups state
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [downloadingBackup, setDownloadingBackup] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isVaultLocked, setIsVaultLocked] = useState(false);
  const [vaultExpiresAt, setVaultExpiresAt] = useState(0);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

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

  // Wasender Gateway State
  const [wasenderStatus, setWasenderStatus] = useState<{
    configured: boolean;
    isTestMode: boolean;
    designatedTestPhone: string;
    sessionName: string;
    connectedPhone: string;
    businessName: string;
    verifiedAt: string | null;
    service: string;
  } | null>(null);
  const [dbHealth, setDbHealth] = useState<{ ok: boolean; service?: string; database?: string } | null>(null);
  const [testCustomMessage, setTestCustomMessage] = useState('');
  const [sendingTestPing, setSendingTestPing] = useState(false);
  const [testPingFeedback, setTestPingFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [penaltiesEnabled, setPenaltiesEnabled] = useState<boolean | null>(null);
  const [penaltiesSaving, setPenaltiesSaving] = useState(false);
  const [penaltiesMessage, setPenaltiesMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pbxSettings, setPbxSettings] = useState<{
    enabled: boolean;
    liveAlertsEnabled: boolean;
    secretConfigured: boolean;
    amiSecretConfigured?: boolean;
    geminiApiKeyConfigured?: boolean;
    secretSource: 'db' | 'env' | 'none';
    webhookPath: string;
    amiHost: string;
    amiPort: number;
    amiUser: string;
    ringTimeoutSeconds: number;
    healthStatus: 'online' | 'error' | 'offline' | 'waiting' | 'disabled' | 'misconfigured';
    bridgeStatus: 'online' | 'error' | 'offline';
    lastHeartbeatAt: string | null;
    lastEventAt: string | null;
    lastError: string | null;
    totalCalls: number;
    activeCount: number;
  } | null>(null);
  const [pbxDraft, setPbxDraft] = useState({
    amiHost: '5.161.82.204',
    amiPort: '5038',
    amiUser: 'radar_monitor',
    amiSecret: '',
    ringTimeoutSeconds: '120',
    liveAlertsEnabled: true,
    webhookSecret: '',
    geminiApiKey: '',
  });
  const [monitorCode, setMonitorCode] = useState('');
  const [hasMonitorCode, setHasMonitorCode] = useState(false);
  const [monitorCodeSaving, setMonitorCodeSaving] = useState(false);
  const [yardGlobalCode, setYardGlobalCode] = useState('');
  const [hasYardGlobalCode, setHasYardGlobalCode] = useState(false);
  const [yardCodeSaving, setYardCodeSaving] = useState(false);
  const [yardCodeMessage, setYardCodeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [callsCodeMessage, setCallsCodeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [maintenanceStorage, setMaintenanceStorage] = useState<{
    orderFilesCount: number;
    orderBytes: number;
    pbxAudioCount: number;
    pbxAudioBytes: number;
    backupsFilesCount: number;
    backupsBytes: number;
    totalBytes: number;
  } | null>(null);
  const [vpsStats, setVpsStats] = useState<{
    hostname: string;
    platform: string;
    uptimeSeconds: number;
    cpuCount: number;
    cpuModel: string;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    cpuLoadPct: number;
    ramTotalBytes: number;
    ramUsedBytes: number;
    ramFreeBytes: number;
    ramUsedPct: number;
    processRssBytes: number;
    diskTotalBytes: number;
    diskUsedBytes: number;
    diskFreeBytes: number;
    diskUsedPct: number;
    sampledAt: string;
  } | null>(null);
  const [maintenanceDraft, setMaintenanceDraft] = useState({
    autoEnabled: false,
    deliveredGraceDays: '0',
    refundedRetentionDays: '30',
    pbxAudioRetentionDays: '30',
    backupsRetentionDays: '30',
    alertsEnabled: true,
    ramAlertThresholdPct: '85',
    diskAlertThresholdPct: '85',
    cpuAlertThresholdPct: '90',
    dockerPruneUrl: '',
    dockerPruneSecret: '',
    dockerPruneSecretConfigured: false,
    lastRunAt: null as string | null,
    lastAlertAt: null as string | null,
  });
  const [showDockerGuide, setShowDockerGuide] = useState(false);
  const [maintenanceReport, setMaintenanceReport] = useState<{
    dryRun: boolean;
    executedAt: string;
    deliveredExpired: { ordersCount: number; filesCount: number; bytes: number };
    refundedExpired: { ordersCount: number; filesCount: number; bytes: number };
    cancelledImmediate: { ordersCount: number; filesCount: number; bytes: number };
    pbxAudios: { ordersCount: number; filesCount: number; bytes: number };
    backupsExpired?: { ordersCount: number; filesCount: number; bytes: number };
    orphans: { ordersCount: number; filesCount: number; bytes: number };
    totalFiles: number;
    totalBytesFreed: number;
  } | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState<'loading' | 'saving' | 'preview' | 'run' | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPbxGuide, setShowPbxGuide] = useState(false);
  const [pbxSaving, setPbxSaving] = useState(false);
  const [pbxRefreshing, setPbxRefreshing] = useState(false);
  const [pbxTesting, setPbxTesting] = useState(false);
  const [pbxMessage, setPbxMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<Array<{
    id: number; orderCode: string; task: string; channel: string; kind: string;
    fileUrl: string; uploader: string; createdAt: string;
  }>>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceReviewing, setEvidenceReviewing] = useState<number | null>(null);
  const [evidenceMessage, setEvidenceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchPendingEvidence = useCallback(async () => {
    setEvidenceLoading(true);
    try {
      const response = await apiFetch('/followup-evidence');
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setEvidenceItems(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      // el panel de amonestaciones conserva su último estado conocido
    } finally {
      setEvidenceLoading(false);
    }
  }, []);

  const reviewEvidence = async (id: number, status: 'approved' | 'rejected') => {
    if (evidenceReviewing !== null) return;
    setEvidenceReviewing(id);
    setEvidenceMessage(null);
    try {
      const response = await apiFetch(`/followup-evidence/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo revisar la evidencia.');
      setEvidenceItems(items => items.filter(item => item.id !== id));
      setEvidenceMessage({
        type: 'success',
        text: status === 'approved' ? 'Evidencia aprobada. El contador puede reanudarse.' : 'Evidencia rechazada. El contador se reanuda desde la revisión.',
      });
    } catch (error) {
      setEvidenceMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo revisar la evidencia.' });
    } finally {
      setEvidenceReviewing(null);
    }
  };

  const fetchDbHealth = useCallback(async () => {
    try {
      const res = await fetch(HEALTH_URL, { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setDbHealth(data);
      } else {
        setDbHealth({ ok: false });
      }
    } catch {
      setDbHealth({ ok: false });
    }
  }, []);

  const fetchWasenderStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/wasender/status');
      if (!res.ok) throw new Error('Estado Wasender no disponible');
      setWasenderStatus(await res.json());
    } catch {
      setWasenderStatus(null);
    }
  }, []);

  const handleSendTestPing = async (messageOverride?: string) => {
    setSendingTestPing(true);
    setTestPingFeedback(null);
    try {
      const message = (messageOverride ?? testCustomMessage).trim();
      const res = await apiFetch('/wasender/test-ping', {
        method: 'POST',
        body: JSON.stringify({
          message: message || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.dispatched) {
        if (data.verifiedAt) {
          setWasenderStatus((prev) => (prev ? { ...prev, verifiedAt: data.verifiedAt } : prev));
        }
        const verificationLabel = data.verifiedAt
          ? formatWasenderTimestamp(data.verifiedAt)
          : formatWasenderTimestamp(new Date().toISOString());
        setTestPingFeedback({
          type: 'success',
          text: `Conexión verificada a las ${verificationLabel}. Destino: ${data.recipientMasked || 'no informado'}.`,
        });
      } else {
        setTestPingFeedback({
          type: 'error',
          text: data.error || 'Error al transmitir mensaje de prueba vía Wasender.',
        });
      }
    } catch (err) {
      setTestPingFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al contactar el servidor Wasender.',
      });
    } finally {
      setSendingTestPing(false);
    }
  };

  const wasenderVerification = (() => {
    if (!wasenderStatus) return { label: 'Estado no disponible', tone: 'neutral' as const };
    if (!wasenderStatus.configured) return { label: 'No configurado', tone: 'urgency' as const };
    if (wasenderStatus.isTestMode) return { label: 'Modo prueba', tone: 'info' as const };
    if (wasenderStatus.verifiedAt) return { label: 'Verificado', tone: 'success' as const };
    return { label: 'Configurado · sin verificar', tone: 'info' as const };
  })();
  const wasenderBadgeToneClass =
    wasenderVerification.tone === 'success'
      ? 'border-[color:var(--state-success)]/40 bg-[color:var(--state-success)]/10 text-[var(--state-success)]'
      : wasenderVerification.tone === 'urgency'
        ? 'border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]'
        : wasenderVerification.tone === 'info'
          ? 'border-[color:var(--state-info)]/40 bg-[color:var(--state-info)]/10 text-[var(--state-info)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)]';
  const wasenderLastVerification = wasenderStatus?.verifiedAt
    ? formatWasenderTimestamp(wasenderStatus.verifiedAt)
    : null;

  const checkVaultStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/auth/2fa/vault');
      const data = await res.json();
      if (res.ok) {
        const active = Boolean(data.unlocked && data.expiresAt > Date.now());
        setIsVaultLocked(!active);
        setVaultExpiresAt(active ? data.expiresAt : 0);
        return active;
      }
    } catch {
      // ignore
    }
    return false;
  }, []);

  const handleLockVault = async () => {
    try {
      await apiFetch('/auth/2fa/lock', { method: 'POST', body: '{}' });
      setIsVaultLocked(true);
      setVaultExpiresAt(0);
      setBackupMessage({ type: 'success', text: 'Bóveda de seguridad bloqueada exitosamente.' });
    } catch {
      // ignore
    }
  };

  const fetchBackups = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoadingBackups(true);
    try {
      const response = await apiFetch('/system/backups');
      const data = await response.json();
      if (!response.ok) {
        if (data.code === 'FINANCE_LOCKED' || response.status === 403) {
          setIsVaultLocked(true);
          setVaultExpiresAt(0);
          setBackups([]);
          setBackupMessage({ type: 'error', text: 'Desbloquea la bóveda de seguridad para consultar los respaldos.' });
          return;
        }
        throw new Error(data.message || 'No se pudo consultar los respaldos');
      }
      if (!Array.isArray(data)) throw new Error('Respuesta de respaldos invalida');
      setBackups(data);
      setBackupMessage(null);
    } catch (error) {
      setBackups([]);
      setBackupMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo consultar los respaldos' });
    } finally {
      setLoadingBackups(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void checkVaultStatus().then(active => { if (active) void fetchBackups(); });
    void fetchWasenderStatus();
    void fetchDbHealth();
    void fetchPendingEvidence();
    void fetchPbxSettings();
    void fetchMaintenance();
    void apiFetch('/settings')
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (response.ok) setPenaltiesEnabled(Boolean(payload.penaltiesEnabled));
      })
      .catch(() => setPenaltiesEnabled(null));
  }, [checkVaultStatus, fetchBackups, fetchWasenderStatus, fetchDbHealth, fetchPendingEvidence]);

  const fetchMaintenance = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const response = await apiFetch('/settings/maintenance');
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.settings) {
        setMaintenanceStorage(payload.storage || null);
        setVpsStats(payload.vps || null);
        setMaintenanceDraft({
          autoEnabled: Boolean(payload.settings.autoEnabled),
          deliveredGraceDays: String(payload.settings.deliveredGraceDays ?? 0),
          refundedRetentionDays: String(payload.settings.refundedRetentionDays ?? 30),
          pbxAudioRetentionDays: String(payload.settings.pbxAudioRetentionDays ?? 30),
          backupsRetentionDays: String(payload.settings.backupsRetentionDays ?? 30),
          alertsEnabled: payload.settings.alertsEnabled !== false,
          ramAlertThresholdPct: String(payload.settings.ramAlertThresholdPct ?? 85),
          diskAlertThresholdPct: String(payload.settings.diskAlertThresholdPct ?? 85),
          cpuAlertThresholdPct: String(payload.settings.cpuAlertThresholdPct ?? 90),
          dockerPruneUrl: payload.settings.dockerPruneUrl || '',
          dockerPruneSecret: '',
          dockerPruneSecretConfigured: Boolean(payload.settings.dockerPruneSecretConfigured),
          lastRunAt: payload.settings.lastRunAt || null,
          lastAlertAt: payload.settings.lastAlertAt || null,
        });
        if (payload.settings.lastSummary) {
          setMaintenanceReport(payload.settings.lastSummary);
        }
      }
    } catch {
      // Ignore transient load error
    }
  }, [isSuperAdmin]);

  const formatBytesLabel = (bytes: number): string => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const saveMaintenanceSettings = async (
    event?: React.FormEvent,
    overrides?: { autoEnabled?: boolean; alertsEnabled?: boolean },
  ) => {
    event?.preventDefault();
    if (maintenanceBusy) return;
    setMaintenanceBusy('saving');
    setMaintenanceMessage(null);
    try {
      const response = await apiFetch('/settings/maintenance', {
        method: 'PUT',
        body: JSON.stringify({
          autoEnabled: overrides?.autoEnabled ?? maintenanceDraft.autoEnabled,
          deliveredGraceDays: Number(maintenanceDraft.deliveredGraceDays) || 0,
          refundedRetentionDays: Number(maintenanceDraft.refundedRetentionDays) || 30,
          pbxAudioRetentionDays: Number(maintenanceDraft.pbxAudioRetentionDays) || 30,
          backupsRetentionDays: Number(maintenanceDraft.backupsRetentionDays) || 30,
          alertsEnabled: overrides?.alertsEnabled ?? maintenanceDraft.alertsEnabled,
          ramAlertThresholdPct: Number(maintenanceDraft.ramAlertThresholdPct) || 85,
          diskAlertThresholdPct: Number(maintenanceDraft.diskAlertThresholdPct) || 85,
          cpuAlertThresholdPct: Number(maintenanceDraft.cpuAlertThresholdPct) || 90,
          dockerPruneUrl: maintenanceDraft.dockerPruneUrl.trim(),
          ...(maintenanceDraft.dockerPruneSecret.trim() ? { dockerPruneSecret: maintenanceDraft.dockerPruneSecret.trim() } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo guardar la política de mantenimiento.');
      setMaintenanceStorage(payload.storage || null);
      if (payload.vps) setVpsStats(payload.vps);
      setMaintenanceDraft((prev) => ({
        ...prev,
        autoEnabled: Boolean(payload.settings?.autoEnabled),
        deliveredGraceDays: String(payload.settings?.deliveredGraceDays ?? prev.deliveredGraceDays),
        refundedRetentionDays: String(payload.settings?.refundedRetentionDays ?? prev.refundedRetentionDays),
        pbxAudioRetentionDays: String(payload.settings?.pbxAudioRetentionDays ?? prev.pbxAudioRetentionDays),
        backupsRetentionDays: String(payload.settings?.backupsRetentionDays ?? prev.backupsRetentionDays),
        alertsEnabled: payload.settings?.alertsEnabled !== false,
        ramAlertThresholdPct: String(payload.settings?.ramAlertThresholdPct ?? prev.ramAlertThresholdPct),
        diskAlertThresholdPct: String(payload.settings?.diskAlertThresholdPct ?? prev.diskAlertThresholdPct),
        cpuAlertThresholdPct: String(payload.settings?.cpuAlertThresholdPct ?? prev.cpuAlertThresholdPct),
        dockerPruneUrl: payload.settings?.dockerPruneUrl ?? prev.dockerPruneUrl,
        dockerPruneSecret: '',
        dockerPruneSecretConfigured: Boolean(payload.settings?.dockerPruneSecretConfigured),
      }));
      setMaintenanceMessage({ type: 'success', text: 'Políticas de mantenimiento y alertas guardadas correctamente.' });
    } catch (error) {
      setMaintenanceMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al guardar mantenimiento.' });
    } finally {
      setMaintenanceBusy(null);
    }
  };

  const runMaintenanceAction = async (mode: 'preview' | 'run' | 'test-alert' | 'docker-prune') => {
    if (maintenanceBusy) return;
    if (mode === 'run' && typeof window !== 'undefined' && !window.confirm('¿Confirmas eliminar permanentemente los archivos vencidos según las reglas de retención? Los registros de órdenes y llamadas se conservan.')) {
      return;
    }
    setMaintenanceBusy(mode === 'test-alert' || mode === 'docker-prune' ? 'saving' : mode);
    setMaintenanceMessage(null);
    try {
      const response = await apiFetch(`/settings/maintenance/${mode}`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo ejecutar la operación.');
      if (mode === 'test-alert') {
        if (payload.vps) setVpsStats(payload.vps);
        setMaintenanceMessage({
          type: payload.sent ? 'success' : 'error',
          text: payload.sent
            ? 'Alerta de prueba enviada por WhatsApp (Wasender) al Super Administrador.'
            : 'No se pudo enviar la alerta (verifica que Wasender esté activo y el Super Admin tenga teléfono registrado).',
        });
      } else if (mode === 'docker-prune') {
        if (payload.vps) setVpsStats(payload.vps);
        const relCount = Number(payload.releasesRemoved || 0);
        const relBytes = Number(payload.releasesBytesFreed || 0);
        const relInfo = relCount > 0 ? `Releases limpiadas: ${relCount} (${formatBytesLabel(relBytes)}).` : 'Releases antiguas: al día.';
        setMaintenanceMessage({
          type: 'success',
          text: `Limpieza VPS completada. ${relInfo} ${payload.imagesOutput || ''} ${payload.builderOutput || ''}`.trim(),
        });
      } else {
        setMaintenanceReport(payload.report || null);
        setMaintenanceStorage(payload.storage || null);
        if (payload.vps) setVpsStats(payload.vps);
        if (payload.settings?.lastRunAt) {
          setMaintenanceDraft((prev) => ({ ...prev, lastRunAt: payload.settings.lastRunAt }));
        }
        setMaintenanceMessage({
          type: 'success',
          text: mode === 'preview'
            ? `Análisis completado: ${payload.report?.totalFiles || 0} archivos (${formatBytesLabel(payload.report?.totalBytesFreed || 0)}) listos para liberar.`
            : `Limpieza completada: ${payload.report?.totalFiles || 0} archivos eliminados (${formatBytesLabel(payload.report?.totalBytesFreed || 0)} liberados).`,
        });
      }
    } catch (error) {
      setMaintenanceMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error en mantenimiento.' });
    } finally {
      setMaintenanceBusy(null);
    }
  };

  const fetchPbxSettings = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const [response, codeRes, yardCodeRes] = await Promise.all([
        apiFetch('/settings/pbx'),
        apiFetch('/settings/pbx/monitor-code'),
        apiFetch('/settings/yard/access-code'),
      ]);
      const codePayload = await codeRes.json().catch(() => ({}));
      if (codeRes.ok) setHasMonitorCode(Boolean(codePayload.hasMonitorCode));
      const yardCodePayload = await yardCodeRes.json().catch(() => ({}));
      if (yardCodeRes.ok) setHasYardGlobalCode(Boolean(yardCodePayload.hasGlobalCode));
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setPbxSettings(payload);
        setPbxDraft((prev) => ({
          ...prev,
          amiHost: payload.amiHost || '5.161.82.204',
          amiPort: String(payload.amiPort || 5038),
          amiUser: payload.amiUser || 'radar_monitor',
          ringTimeoutSeconds: String(payload.ringTimeoutSeconds || 120),
          liveAlertsEnabled: payload.liveAlertsEnabled !== false,
        }));
      }
    } catch {
      // Ignore transient load error
    }
  }, [isSuperAdmin]);

  const refreshPbxStatus = async () => {
    if (pbxRefreshing) return;
    setPbxRefreshing(true);
    setPbxMessage(null);
    try {
      const response = await apiFetch('/settings/pbx/reconnect', { method: 'POST', body: JSON.stringify({}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo verificar el estado PBX.');
      setPbxSettings(payload);
      setPbxMessage({
        type: payload.healthStatus === 'online' ? 'success' : 'error',
        text: payload.healthStatus === 'online'
          ? 'Conexión AMI en línea con Issabel PBX.'
          : payload.lastError || 'Sin respuesta aún de Issabel PBX. Revisa el puerto TCP 5038 en el firewall.',
      });
    } catch (error) {
      setPbxMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al verificar PBX.' });
    } finally {
      setPbxRefreshing(false);
    }
  };

  const savePbxConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pbxSaving) return;
    setPbxSaving(true);
    setPbxMessage(null);
    try {
      const body: Record<string, unknown> = {
        amiHost: pbxDraft.amiHost.trim(),
        amiPort: Number(pbxDraft.amiPort) || 5038,
        amiUser: pbxDraft.amiUser.trim(),
        ringTimeoutSeconds: Number(pbxDraft.ringTimeoutSeconds) || 120,
        liveAlertsEnabled: pbxDraft.liveAlertsEnabled,
      };
      if (pbxDraft.amiSecret.trim()) {
        body.amiSecret = pbxDraft.amiSecret.trim();
      }
      if (pbxDraft.webhookSecret.trim()) {
        body.webhookSecret = pbxDraft.webhookSecret.trim();
      }
      if (pbxDraft.geminiApiKey.trim()) {
        body.geminiApiKey = pbxDraft.geminiApiKey.trim();
      }
      const response = await apiFetch('/settings/pbx', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo guardar la configuración PBX.');
      setPbxSettings(payload);
      setPbxDraft((prev) => ({ ...prev, amiSecret: '', webhookSecret: '', geminiApiKey: '' }));
      setPbxMessage({
        type: 'success',
        text: 'Configuración de Issabel PBX guardada correctamente.',
      });
    } catch (error) {
      setPbxMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al guardar configuración PBX.' });
    } finally {
      setPbxSaving(false);
    }
  };

  const togglePbx = async () => {
    if (!pbxSettings || pbxSaving) return;
    const next = !pbxSettings.enabled;
    setPbxSaving(true);
    setPbxMessage(null);
    try {
      const response = await apiFetch('/settings/pbx', {
        method: 'PUT',
        body: JSON.stringify({ enabled: next }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo cambiar el estado del PBX.');
      setPbxSettings(payload);
      setPbxMessage({
        type: 'success',
        text: next
          ? 'Monitoreo Issabel PBX habilitado. Las alertas entrantes están activas.'
          : 'Monitoreo Issabel PBX deshabilitado. No se mostrarán alertas nuevas hasta activarlo.',
      });
    } catch (error) {
      setPbxMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al actualizar PBX.' });
    } finally {
      setPbxSaving(false);
    }
  };

  const sendPbxTestCall = async () => {
    if (pbxTesting) return;
    setPbxTesting(true);
    setPbxMessage(null);
    try {
      const response = await apiFetch('/settings/pbx/test', { method: 'POST', body: JSON.stringify({}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo enviar la prueba.');
      setPbxMessage({
        type: 'success',
        text: 'Alerta de prueba enviada (se cerrará automáticamente en 12 segundos).',
      });
      void fetchPbxSettings();
    } catch (error) {
      setPbxMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al probar PBX.' });
    } finally {
      setPbxTesting(false);
    }
  };

  const saveMonitorCode = async (event: React.FormEvent, clear = false) => {
    event.preventDefault();
    if (monitorCodeSaving) return;
    const cleaned = clear ? '' : monitorCode.trim();
    if (!clear && cleaned.length < 4) {
      const msg = { type: 'error' as const, text: 'El código de acceso a Llamadas debe tener al menos 4 caracteres.' };
      setPbxMessage(msg);
      setCallsCodeMessage(msg);
      return;
    }
    setMonitorCodeSaving(true);
    setPbxMessage(null);
    setCallsCodeMessage(null);
    try {
      const response = await apiFetch('/settings/pbx/monitor-code', {
        method: 'PUT',
        body: JSON.stringify({ code: cleaned }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo guardar el código.');
      setHasMonitorCode(Boolean(payload.hasMonitorCode));
      setMonitorCode('');
      const msg = {
        type: 'success' as const,
        text: payload.hasMonitorCode
          ? 'Código global de acceso a Llamadas (calls.radar-rsy.store / /llamadas) guardado.'
          : 'Código global de Llamadas desactivado (solo PIN/usuario autorizado).',
      };
      setPbxMessage(msg);
      setCallsCodeMessage(msg);
    } catch (error) {
      const msg = { type: 'error' as const, text: error instanceof Error ? error.message : 'Error al guardar el código.' };
      setPbxMessage(msg);
      setCallsCodeMessage(msg);
    } finally {
      setMonitorCodeSaving(false);
    }
  };

  const saveYardGlobalCode = async (event: React.FormEvent, clear = false) => {
    event.preventDefault();
    if (yardCodeSaving) return;
    const cleaned = clear ? '' : yardGlobalCode.trim();
    if (!clear && cleaned.length < 4) {
      setYardCodeMessage({ type: 'error', text: 'El código global de Yarda debe tener al menos 4 caracteres.' });
      return;
    }
    setYardCodeSaving(true);
    setYardCodeMessage(null);
    try {
      const response = await apiFetch('/settings/yard/access-code', {
        method: 'PUT',
        body: JSON.stringify({ code: cleaned }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo actualizar el código de Yarda.');
      setHasYardGlobalCode(Boolean(payload.hasGlobalCode));
      setYardGlobalCode('');
      setYardCodeMessage({
        type: 'success',
        text: payload.hasGlobalCode
          ? 'Código global de acceso a Yarda guardado.'
          : 'Código global de Yarda desactivado (solo PIN de empleado o clave).',
      });
    } catch (error) {
      setYardCodeMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al guardar el código.' });
    } finally {
      setYardCodeSaving(false);
    }
  };

  const togglePenalties = async () => {
    if (penaltiesEnabled === null || penaltiesSaving) return;
    const next = !penaltiesEnabled;
    setPenaltiesSaving(true);
    setPenaltiesMessage(null);
    try {
      const response = await apiFetch('/settings/penalties', {
        method: 'PUT',
        body: JSON.stringify({ enabled: next }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo cambiar el estado de las amonestaciones.');
      setPenaltiesEnabled(Boolean(payload.penaltiesEnabled));
      setPenaltiesMessage({
        type: 'success',
        text: next
          ? 'Amonestaciones habilitadas. Los contadores se reanudan desde este momento.'
          : 'Amonestaciones deshabilitadas. Lo acumulado y lo liquidado se conserva.',
      });
    } catch (error) {
      setPenaltiesMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cambiar el estado.' });
    } finally {
      setPenaltiesSaving(false);
    }
  };

  // Handle immediate snapshot creation
  const handleCreateSnapshot = async () => {
    if (vaultExpiresAt <= Date.now()) {
      setPendingAction(() => () => void handleCreateSnapshot());
      setIsUnlockModalOpen(true);
      return;
    }
    setCreatingBackup(true);
    setBackupMessage(null);
    try {
      const response = await apiFetch('/system/backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'manual' }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === 'FINANCE_LOCKED' || response.status === 403) {
          setIsVaultLocked(true);
          setPendingAction(() => () => void handleCreateSnapshot());
          setIsUnlockModalOpen(true);
          return;
        }
        throw new Error(data.message || 'No se pudo generar el punto de respaldo');
      }
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
    if (vaultExpiresAt <= Date.now()) {
      setPendingAction(() => () => void handleDownloadBackup(filename));
      setIsUnlockModalOpen(true);
      return;
    }
    const downloadKey = filename || '__direct__';
    setDownloadingBackup(downloadKey);
    setBackupMessage(null);
    try {
      const url = filename
        ? `/system/backup/download?file=${encodeURIComponent(filename)}`
        : '/system/backup';
      const response = await apiFetch(url);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.code === 'FINANCE_LOCKED' || response.status === 403) {
          setIsVaultLocked(true);
          setPendingAction(() => () => void handleDownloadBackup(filename));
          setIsUnlockModalOpen(true);
          return;
        }
        throw new Error(data.message || 'No se pudo descargar el archivo.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const headerName = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1];
      const fallbackName = filename ? filename.replace(/\.gz$/i, '') : 'radar-backup.sql';
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = headerName || fallbackName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
    } catch (error) {
      setBackupMessage({ type: 'error', text: error instanceof Error ? error.message : 'Error al descargar el archivo de respaldo.' });
    } finally {
      setDownloadingBackup(null);
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
    if (vaultExpiresAt <= Date.now()) {
      setPendingAction(() => () => openRestoreModalForLocal(item));
      setIsUnlockModalOpen(true);
      return;
    }
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
    if (vaultExpiresAt <= Date.now()) {
      setPendingAction(() => () => openRestoreModalForUpload());
      setIsUnlockModalOpen(true);
      return;
    }
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
    setRestoreError('Restauración directa deshabilitada. Solicite una recuperación verificada al administrador por el procedimiento operativo.');
  };

  return (
    <div className="radar-view horizon-view space-y-6">
      {/* Cyber Header Card */}
      <div className="horizon-view-header">

        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-[#040814] border border-cyan-500/40 text-cyan-300 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)] shrink-0">
            <span aria-hidden="true" className="material-symbols-outlined text-[26px]">settings</span>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Configuración del Sistema & Seguridad</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Parámetros globales de la plataforma, recuperación ante desastres y gestión de base de datos.
            </p>
          </div>
        </div>
      </div>

      {/* Section Tabs */}
      <div
        role="tablist"
        aria-label="Secciones de configuración del sistema"
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 shadow-[var(--card-shadow)]"
      >
        {[
          { id: 'general' as const, label: 'General y Apariencia', icon: 'tune', show: true },
          { id: 'whatsapp' as const, label: 'WhatsApp y Notificaciones', icon: 'send', show: true, dot: wasenderStatus ? (wasenderStatus.configured ? 'bg-emerald-400' : 'bg-amber-400') : undefined },
          { id: 'pbx' as const, label: 'Central PBX y Llamadas', icon: 'call', show: isSuperAdmin, dot: pbxSettings?.healthStatus === 'online' ? 'bg-emerald-400' : pbxSettings?.healthStatus === 'error' ? 'bg-rose-400' : undefined },
          { id: 'penalties' as const, label: 'Amonestaciones', icon: 'notifications_active', show: isSuperAdmin, badge: evidenceItems.length > 0 ? evidenceItems.length : undefined },
          { id: 'backups' as const, label: 'Respaldos y Rollback', icon: 'database', show: isSuperAdmin },
          { id: 'maintenance' as const, label: 'Mantenimiento', icon: 'cleaning_services', show: isSuperAdmin },
        ]
          .filter((tab) => tab.show)
          .map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[var(--brand-solid)] text-white shadow-[0_0_16px_rgba(6,182,212,0.3)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-heading)]'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
                {tab.dot && (
                  <span className={`w-2 h-2 rounded-full ${tab.dot}`} />
                )}
                {tab.badge !== undefined && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black leading-none ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
      </div>

      {activeTab === 'penalties' && isSuperAdmin && (
        <div className="relative overflow-hidden rounded-3xl border border-cyan-500/25 bg-[#070c18]/90 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur-2xl md:p-6">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                penaltiesEnabled === false
                  ? 'border-amber-400/40 bg-amber-500/10 text-amber-300'
                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
              }`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">notifications_active</span>
              </div>
              <div>
                <h2 className="font-mono text-sm font-black uppercase tracking-wider text-white">Amonestaciones automáticas</h2>
                <p className="mt-1 max-w-2xl text-xs text-slate-400">
                  Genera cargos por seguimientos post-entrega, reclamos y piezas listas sin notificar. Al deshabilitarlas, los contadores se pausan y no se generan cargos nuevos; lo acumulado y lo liquidado se conserva. Las faltas manuales no dependen de este interruptor. El descuento aplica 0.8333% por unidad sobre el salario semanal de cada colaborador; el porcentaje es el mismo para todo el equipo.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-wide ${
                penaltiesEnabled === null
                  ? 'border-slate-600 text-slate-400'
                  : penaltiesEnabled
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-400/40 bg-amber-500/10 text-amber-300'
              }`}>
                {penaltiesEnabled === null ? 'Sin estado' : penaltiesEnabled ? 'Habilitadas' : 'Deshabilitadas'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={penaltiesEnabled === true}
                aria-label="Habilitar amonestaciones automáticas"
                disabled={penaltiesEnabled === null || penaltiesSaving}
                onClick={() => { void togglePenalties(); }}
                className={`relative h-8 w-14 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  penaltiesEnabled
                    ? 'border-emerald-400/50 bg-emerald-500/30'
                    : 'border-slate-600 bg-slate-800'
                }`}
              >
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${
                  penaltiesEnabled ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>
          </div>
          {penaltiesMessage && (
            <p className={`mt-3 rounded-2xl px-3 py-2 font-mono text-[11px] ${
              penaltiesMessage.type === 'success'
                ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'border border-amber-400/40 bg-amber-950/30 text-amber-200'
            }`}>
              {penaltiesMessage.text}
            </p>
          )}
          <div className="mt-4 space-y-2.5 border-t border-cyan-500/15 pt-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-mono text-[11px] font-black uppercase tracking-wider text-slate-300">
                Evidencias por verificar {evidenceItems.length > 0 && <span className="text-amber-300">({evidenceItems.length})</span>}
              </h3>
              <button
                type="button"
                disabled={evidenceLoading}
                onClick={() => { void fetchPendingEvidence(); }}
                className="cyber-btn-secondary px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
              >
                {evidenceLoading ? 'Actualizando…' : 'Actualizar'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Mientras una evidencia de contacto está pendiente, los contadores de esa orden se pausan. Apruébala o recházala para que el cálculo continúe.
            </p>
            {evidenceMessage && (
              <p className={`rounded-xl px-3 py-2 font-mono text-[11px] ${
                evidenceMessage.type === 'success'
                  ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                  : 'border border-amber-400/40 bg-amber-950/30 text-amber-200'
              }`}>
                {evidenceMessage.text}
              </p>
            )}
            {evidenceItems.length === 0 ? (
              <p className="rounded-xl border border-slate-700/60 bg-[#040814] px-3 py-2.5 text-[11px] text-slate-400">
                Sin evidencias pendientes de revisión.
              </p>
            ) : (
              <ul className="space-y-2">
                {evidenceItems.map(item => {
                  const taskLabel = ({ post_3: 'Día 3', post_7: 'Día 7', post_14: 'Día 14' } as Record<string, string>)[item.task] || item.task;
                  const channelLabel = ({ call: 'Llamada', sms: 'SMS', whatsapp: 'WhatsApp' } as Record<string, string>)[item.channel] || item.channel;
                  return (
                    <li key={item.id} className="rounded-xl border border-slate-700/70 bg-[#040814] p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <strong className="font-mono text-[11px] font-bold text-white">#{item.orderCode} · Seguimiento {taskLabel}</strong>
                          <p className="text-[11px] text-slate-400">
                            {channelLabel} · {item.uploader} · {new Date(item.createdAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            disabled={evidenceReviewing !== null}
                            onClick={() => { void reviewEvidence(item.id, 'approved'); }}
                            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300 disabled:opacity-50"
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            disabled={evidenceReviewing !== null}
                            onClick={() => { void reviewEvidence(item.id, 'rejected'); }}
                            className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300 disabled:opacity-50"
                          >
                            Rechazar
                          </button>
                        </div>
                      </div>
                      {item.kind === 'call_audio' ? (
                        <audio controls preload="metadata" src={item.fileUrl} className="w-full h-9" aria-label={`Audio de llamada de la orden ${item.orderCode}`} />
                      ) : (
                        <a href={item.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:underline">
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">image</span>
                          <span>Ver captura de la conversación</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* SUPER ADMIN: Issabel PBX Monitor Configuration */}
      {activeTab === 'pbx' && isSuperAdmin && (
        <div className="relative overflow-hidden rounded-3xl border border-cyan-500/25 bg-[#070c18]/90 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur-2xl md:p-6">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-cyan-400" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                pbxSettings?.healthStatus === 'online'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : pbxSettings?.healthStatus === 'error'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
              }`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">call</span>
              </div>
              <div>
                <h2 className="font-mono text-sm font-black uppercase tracking-wider text-white">Central Telefónica (Issabel PBX)</h2>
                <p className="mt-1 max-w-2xl text-xs text-slate-400">
                  Monitoreo en modo solo lectura desde Issabel PBX y PortSIP. Muestra alertas de llamadas entrantes a todo el equipo de oficina y registra entrantes, salientes y perdidas.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-wide ${
                pbxSettings?.healthStatus === 'online'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : pbxSettings?.healthStatus === 'error'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : pbxSettings?.healthStatus === 'offline' || pbxSettings?.healthStatus === 'misconfigured'
                      ? 'border-amber-400/40 bg-amber-500/10 text-amber-300'
                      : 'border-slate-600 bg-slate-800/60 text-slate-300'
              }`}>
                {!pbxSettings
                  ? 'Cargando…'
                  : pbxSettings.healthStatus === 'online'
                    ? 'En línea'
                    : pbxSettings.healthStatus === 'error'
                      ? 'Con error'
                      : pbxSettings.healthStatus === 'offline'
                        ? 'Sin señal'
                        : pbxSettings.healthStatus === 'misconfigured'
                          ? 'Falta secreto'
                          : pbxSettings.healthStatus === 'disabled'
                            ? 'Deshabilitado'
                            : 'Esperando puente'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={pbxSettings?.enabled === true}
                aria-label="Habilitar monitoreo Issabel PBX"
                disabled={!pbxSettings || pbxSaving}
                onClick={() => { void togglePbx(); }}
                className={`relative h-8 w-14 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  pbxSettings?.enabled
                    ? 'border-emerald-400/50 bg-emerald-500/30'
                    : 'border-slate-600 bg-slate-800'
                }`}
              >
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${
                  pbxSettings?.enabled ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>
          </div>

          {pbxSettings?.lastError && (
            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 font-mono text-[11px] text-rose-300">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] shrink-0">error</span>
              <span>Último error reportado por el puente Issabel: {pbxSettings.lastError}</span>
            </div>
          )}

          {pbxMessage && (
            <p className={`mt-3 rounded-2xl px-3 py-2 font-mono text-[11px] ${
              pbxMessage.type === 'success'
                ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'border border-amber-400/40 bg-amber-950/30 text-amber-200'
            }`}>
              {pbxMessage.text}
            </p>
          )}

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-cyan-500/15 bg-slate-950/60 px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Secreto Webhook</p>
              <p className={`mt-1 font-mono text-xs font-bold ${pbxSettings?.secretConfigured ? 'text-emerald-300' : 'text-amber-300'}`}>
                {pbxSettings?.secretConfigured ? 'PBX_WEBHOOK_SECRET OK' : 'No configurado'}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-500/15 bg-slate-950/60 px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Último latido AMI</p>
              <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                {pbxSettings?.lastHeartbeatAt ? new Date(pbxSettings.lastHeartbeatAt).toLocaleString('es-HN') : 'Sin latido aún'}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-500/15 bg-slate-950/60 px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Último evento</p>
              <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                {pbxSettings?.lastEventAt ? new Date(pbxSettings.lastEventAt).toLocaleString('es-HN') : 'Sin llamadas aún'}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-500/15 bg-slate-950/60 px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Historial / Activas</p>
              <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                {pbxSettings ? `${pbxSettings.totalCalls} registradas · ${pbxSettings.activeCount} sonando` : '—'}
              </p>
            </div>
          </div>

          <form onSubmit={(e) => { void savePbxConfig(e); }} className="mt-4 space-y-3 border-t border-cyan-500/15 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] font-black uppercase tracking-wider text-[var(--text-heading)]">
                Configuración de conexión
              </p>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={pbxDraft.liveAlertsEnabled}
                  onChange={(e) => setPbxDraft((prev) => ({ ...prev, liveAlertsEnabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-cyan-500/40 accent-cyan-500"
                />
                <span>Mostrar alertas flotantes en vivo</span>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block text-[11px] font-bold text-[var(--text-muted)]">
                IP / Host Issabel PBX
                <input
                  type="text"
                  required
                  value={pbxDraft.amiHost}
                  onChange={(e) => setPbxDraft((prev) => ({ ...prev, amiHost: e.target.value }))}
                  placeholder="5.161.82.204"
                  className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block text-[11px] font-bold text-[var(--text-muted)]">
                Puerto AMI
                <input
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={pbxDraft.amiPort}
                  onChange={(e) => setPbxDraft((prev) => ({ ...prev, amiPort: e.target.value }))}
                  placeholder="5038"
                  className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block text-[11px] font-bold text-[var(--text-muted)]">
                Usuario AMI (solo lectura)
                <input
                  type="text"
                  required
                  value={pbxDraft.amiUser}
                  onChange={(e) => setPbxDraft((prev) => ({ ...prev, amiUser: e.target.value }))}
                  placeholder="radar_monitor"
                  className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block text-[11px] font-bold text-[var(--text-muted)]">
                Contraseña AMI (Issabel)
                <input
                  type="password"
                  value={pbxDraft.amiSecret}
                  onChange={(e) => setPbxDraft((prev) => ({ ...prev, amiSecret: e.target.value }))}
                  placeholder={pbxSettings?.amiSecretConfigured ? 'Configurada (vacío = conservar)' : 'Clave de radar_monitor'}
                  className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block text-[11px] font-bold text-[var(--text-muted)]">
                Expiración alerta (seg)
                <input
                  type="number"
                  min={15}
                  max={300}
                  required
                  value={pbxDraft.ringTimeoutSeconds}
                  onChange={(e) => setPbxDraft((prev) => ({ ...prev, ringTimeoutSeconds: e.target.value }))}
                  placeholder="120"
                  className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block flex-1 text-[11px] font-bold text-[var(--text-muted)]">
                Nuevo Secreto Webhook (x-pbx-secret)
                <input
                  type="text"
                  value={pbxDraft.webhookSecret}
                  onChange={(e) => setPbxDraft((prev) => ({ ...prev, webhookSecret: e.target.value }))}
                  placeholder={pbxSettings?.secretConfigured ? 'Configurado (deja vacío para conservar el actual)' : 'Escribe o genera un secreto compartido'}
                  className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
                  setPbxDraft((prev) => ({ ...prev, webhookSecret: token }));
                }}
                className="rounded-xl border border-cyan-500/30 bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] font-bold text-[var(--text-secondary)] hover:border-cyan-400 cursor-pointer"
              >
                Generar secreto
              </button>
              <button
                type="submit"
                disabled={pbxSaving}
                className="rounded-xl bg-[var(--brand-solid)] px-4 py-2 font-mono text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {pbxSaving ? 'Guardando…' : 'Guardar configuración'}
              </button>
            </div>
            <label className="block text-[11px] font-bold text-[var(--text-muted)]">
              Gemini API Key (Auditoría IA de Grabaciones)
              <input
                type="password"
                value={pbxDraft.geminiApiKey}
                onChange={(e) => setPbxDraft((prev) => ({ ...prev, geminiApiKey: e.target.value }))}
                placeholder={pbxSettings?.geminiApiKeyConfigured ? 'Configurada (deja vacío para conservar la actual)' : 'Pega aquí tu GEMINI_API_KEY'}
                className="mt-1 w-full rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
              />
            </label>
          </form>

          <form onSubmit={(e) => { void saveMonitorCode(e); }} className="mt-4 rounded-xl border border-cyan-500/30 bg-[var(--bg-card-subtle)] p-3.5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-[240px] flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
                  Código de acceso · Monitor de Llamadas (/llamadas y App macOS)
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  hasMonitorCode
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                    : 'bg-amber-500/15 border-amber-500/35 text-amber-500'
                }`}>
                  {hasMonitorCode ? 'Configurado' : 'Sin configurar'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Código exclusivo para ver el monitoreo de llamadas en vivo sin usar una cuenta de usuario del ERP.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={monitorCode}
                onChange={(e) => setMonitorCode(e.target.value)}
                placeholder={hasMonitorCode ? 'Nuevo código (mín. 4 caracteres)' : 'Define código (mín. 4 caracteres)'}
                className="w-56 rounded-xl border border-cyan-500/35 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={monitorCodeSaving || monitorCode.trim().length < 4}
                className="rounded-xl bg-[var(--brand-solid)] px-3.5 py-2 font-mono text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {monitorCodeSaving ? 'Guardando…' : 'Guardar código'}
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-cyan-500/15 pt-3.5">
            <p className="font-mono text-[11px] text-slate-400">
              Endpoint: <span className="text-cyan-300">{pbxSettings?.webhookPath || '/api/pbx/events'}</span> · Puente en VPS Issabel: <span className="text-slate-200">scripts/issabel-ami-bridge.mjs</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPbxGuide((prev) => !prev)}
                className="rounded-xl border border-cyan-500/30 bg-slate-900 px-3 py-1.5 font-mono text-[11px] font-bold text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                {showPbxGuide ? 'Ocultar comando VPS' : 'Ver comando VPS'}
              </button>
              <button
                type="button"
                disabled={pbxRefreshing}
                onClick={() => { void refreshPbxStatus(); }}
                className="rounded-xl border border-cyan-500/30 bg-slate-900 px-3 py-1.5 font-mono text-[11px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {pbxRefreshing ? 'Verificando…' : 'Actualizar estado'}
              </button>
              <button
                type="button"
                disabled={!pbxSettings?.enabled || pbxTesting}
                onClick={() => { void sendPbxTestCall(); }}
                className="rounded-xl bg-cyan-500/20 border border-cyan-400/40 px-3 py-1.5 font-mono text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50 cursor-pointer"
              >
                {pbxTesting ? 'Enviando…' : 'Probar alerta en vivo'}
              </button>
            </div>
          </div>

          {showPbxGuide && (
            <pre className="mt-3 overflow-x-auto rounded-2xl border border-cyan-500/20 bg-slate-950/90 p-3 font-mono text-[11px] text-cyan-200">
{`AMI_HOST=127.0.0.1 AMI_PORT=${pbxDraft.amiPort || '5038'} AMI_USER=${pbxDraft.amiUser || 'radar_monitor'} \\
AMI_SECRET=<PASSWORD_AMI> \\
RADAR_WEBHOOK_URL=${typeof window !== 'undefined' ? `${window.location.origin}/api/pbx/events` : 'https://tu-dominio/api/pbx/events'} \\
PBX_WEBHOOK_SECRET=${pbxDraft.webhookSecret || '<TU_PBX_WEBHOOK_SECRET>'} \\
node scripts/issabel-ami-bridge.mjs`}
            </pre>
          )}
        </div>
      )}

      {/* SUPER ADMIN: Automatic Storage Maintenance & File Retention */}
      {activeTab === 'maintenance' && isSuperAdmin && (
        <div className="relative overflow-hidden rounded-3xl border border-cyan-500/25 bg-[#070c18]/90 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur-2xl md:p-6 space-y-5">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-cyan-400" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-cyan-500/15 pb-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-cyan-300">
                <span aria-hidden="true" className="material-symbols-outlined text-[22px]">cleaning_services</span>
              </div>
              <div>
                <h2 className="font-mono text-sm font-black uppercase tracking-wider text-white">
                  Mantenimiento Automático y Limpieza de Archivos
                </h2>
                <p className="mt-1 max-w-2xl text-xs text-slate-400">
                  Libera espacio en disco eliminando imágenes, PDFs y audios vencidos sin borrar los registros contables ni el historial de la base de datos.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase border ${
                maintenanceDraft.autoEnabled
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-500/35 bg-slate-500/10 text-slate-300'
              }`}>
                {maintenanceDraft.autoEnabled ? 'Automático ON' : 'Manual'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={maintenanceDraft.autoEnabled}
                aria-label="Activar mantenimiento automático diario"
                disabled={maintenanceBusy !== null}
                onClick={() => {
                  const next = !maintenanceDraft.autoEnabled;
                  setMaintenanceDraft((prev) => ({ ...prev, autoEnabled: next }));
                  void saveMaintenanceSettings(undefined, { autoEnabled: next });
                }}
                className={`relative inline-flex h-7 w-12 items-center rounded-full border transition cursor-pointer ${
                  maintenanceDraft.autoEnabled
                    ? 'border-emerald-400 bg-emerald-500/30'
                    : 'border-slate-600 bg-slate-800'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  maintenanceDraft.autoEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)] flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-cyan-400">monitoring</span>
                  <span>Estado del Servidor VPS en Tiempo Real</span>
                </h3>
                {vpsStats && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {vpsStats.hostname} · {vpsStats.cpuCount} núcleos · Uptime {Math.floor(vpsStats.uptimeSeconds / 3600)}h {Math.floor((vpsStats.uptimeSeconds % 3600) / 60)}m
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { void fetchMaintenance(); }}
                className="rounded-xl border border-cyan-500/30 bg-[var(--bg-card)] px-3 py-1.5 font-mono text-[11px] font-bold text-cyan-300 hover:border-cyan-400 cursor-pointer flex items-center gap-1"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">refresh</span>
                <span>Actualizar</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  label: 'Procesador (CPU)',
                  pct: vpsStats?.cpuLoadPct ?? 0,
                  threshold: Number(maintenanceDraft.cpuAlertThresholdPct) || 90,
                  sub: vpsStats ? `Load ${vpsStats.loadAvg1m} / ${vpsStats.loadAvg5m} · ${vpsStats.cpuCount} cores` : 'Cargando…',
                  icon: 'memory',
                },
                {
                  label: 'Memoria RAM',
                  pct: vpsStats?.ramUsedPct ?? 0,
                  threshold: Number(maintenanceDraft.ramAlertThresholdPct) || 85,
                  sub: vpsStats ? `${formatBytesLabel(vpsStats.ramUsedBytes)} / ${formatBytesLabel(vpsStats.ramTotalBytes)} (App ${formatBytesLabel(vpsStats.processRssBytes)})` : 'Cargando…',
                  icon: 'developer_board',
                },
                {
                  label: 'Almacenamiento (Disco)',
                  pct: vpsStats?.diskUsedPct ?? 0,
                  threshold: Number(maintenanceDraft.diskAlertThresholdPct) || 85,
                  sub: vpsStats ? `${formatBytesLabel(vpsStats.diskUsedBytes)} / ${formatBytesLabel(vpsStats.diskTotalBytes)} · Libre ${formatBytesLabel(vpsStats.diskFreeBytes)}` : 'Cargando…',
                  icon: 'hard_drive',
                },
              ].map((metric) => {
                const isCrit = metric.pct >= metric.threshold;
                const isWarn = !isCrit && metric.pct >= 70;
                const barCls = isCrit ? 'bg-rose-500' : isWarn ? 'bg-amber-400' : 'bg-emerald-400';
                const txtCls = isCrit ? 'text-rose-400' : isWarn ? 'text-amber-300' : 'text-emerald-400';
                return (
                  <div key={metric.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-cyan-400">{metric.icon}</span>
                        {metric.label}
                      </span>
                      <span className={`font-mono text-base font-black tabular-nums ${txtCls}`}>
                        {vpsStats ? `${metric.pct}%` : '—'}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${Math.min(100, metric.pct)}%` }} />
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{metric.sub}</p>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 pt-2 border-t border-cyan-500/15 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 cursor-pointer font-bold text-[var(--text-heading)]">
                  <input
                    type="checkbox"
                    checked={maintenanceDraft.alertsEnabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setMaintenanceDraft((prev) => ({ ...prev, alertsEnabled: next }));
                      void saveMaintenanceSettings(undefined, { alertsEnabled: next });
                    }}
                    className="rounded border-cyan-500/40"
                  />
                  <span>Alertas de colapso por WhatsApp (Wasender) al Super Admin</span>
                </label>
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <span>Umbrales:</span>
                  <label className="inline-flex items-center gap-1">
                    <span>RAM%</span>
                    <input
                      type="number"
                      min={50}
                      max={99}
                      value={maintenanceDraft.ramAlertThresholdPct}
                      onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, ramAlertThresholdPct: e.target.value }))}
                      className="w-14 rounded-lg border border-cyan-500/25 bg-[var(--bg-card)] px-2 py-1 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <span>Disco%</span>
                    <input
                      type="number"
                      min={50}
                      max={99}
                      value={maintenanceDraft.diskAlertThresholdPct}
                      onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, diskAlertThresholdPct: e.target.value }))}
                      className="w-14 rounded-lg border border-cyan-500/25 bg-[var(--bg-card)] px-2 py-1 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <span>CPU%</span>
                    <input
                      type="number"
                      min={50}
                      max={100}
                      value={maintenanceDraft.cpuAlertThresholdPct}
                      onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, cpuAlertThresholdPct: e.target.value }))}
                      className="w-14 rounded-lg border border-cyan-500/25 bg-[var(--bg-card)] px-2 py-1 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </label>
                </div>
              </div>
              <button
                type="button"
                disabled={maintenanceBusy !== null}
                onClick={() => { void runMaintenanceAction('test-alert'); }}
                className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
              >
                Probar alerta WhatsApp
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Archivos de Órdenes</p>
              <p className="mt-1 text-xl font-black text-[var(--text-heading)] tabular-nums">
                {maintenanceStorage ? formatBytesLabel(maintenanceStorage.orderBytes) : '—'}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {maintenanceStorage ? `${maintenanceStorage.orderFilesCount} archivos (imágenes / PDFs)` : 'Calculando…'}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Audios de Llamadas PBX</p>
              <p className="mt-1 text-xl font-black text-cyan-400 tabular-nums">
                {maintenanceStorage ? formatBytesLabel(maintenanceStorage.pbxAudioBytes) : '—'}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {maintenanceStorage ? `${maintenanceStorage.pbxAudioCount} grabaciones (.wav/.mp3)` : 'Calculando…'}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Respaldos SQL</p>
              <p className="mt-1 text-xl font-black text-violet-400 tabular-nums">
                {maintenanceStorage ? formatBytesLabel(maintenanceStorage.backupsBytes ?? 0) : '—'}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {maintenanceStorage ? `${maintenanceStorage.backupsFilesCount ?? 0} respaldos (.sql/.dump)` : 'Calculando…'}
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Espacio Total</p>
              <p className="mt-1 text-xl font-black text-emerald-400 tabular-nums">
                {maintenanceStorage ? formatBytesLabel(maintenanceStorage.totalBytes) : '—'}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {maintenanceDraft.lastRunAt ? `Última limpieza: ${new Date(maintenanceDraft.lastRunAt).toLocaleString('es-VE')}` : 'Sin ejecuciones previas'}
              </p>
            </div>
          </div>

          <form onSubmit={(e) => { void saveMaintenanceSettings(e); }} className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
              Reglas de Retención Configuradas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 space-y-1.5">
                <span className="font-bold text-[var(--text-heading)] block">Órdenes Entregadas</span>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Se borran al <strong>expirar la garantía</strong> (sin reclamos abiertos). Días extra opcionales:
                </p>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={maintenanceDraft.deliveredGraceDays}
                  onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, deliveredGraceDays: e.target.value }))}
                  className="w-full rounded-lg border border-cyan-500/25 bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none"
                />
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 space-y-1.5">
                <span className="font-bold text-[var(--text-heading)] block">Órdenes Reembolsadas</span>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Días de conservación tras el reembolso antes de borrar archivos:
                </p>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={maintenanceDraft.refundedRetentionDays}
                  onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, refundedRetentionDays: e.target.value }))}
                  className="w-full rounded-lg border border-cyan-500/25 bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none"
                />
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 space-y-1.5">
                <span className="font-bold text-[var(--text-heading)] block">Órdenes Canceladas</span>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Sus archivos se eliminan <strong>inmediatamente</strong> al cancelarse (y en cada barrido).
                </p>
                <span className="inline-flex rounded-full border border-amber-500/35 bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                  Inmediato (0 días)
                </span>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 space-y-1.5">
                <span className="font-bold text-[var(--text-heading)] block">Audios de Llamadas PBX</span>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Días antes de borrar el audio (conserva puntaje IA y transcripción):
                </p>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={maintenanceDraft.pbxAudioRetentionDays}
                  onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, pbxAudioRetentionDays: e.target.value }))}
                  className="w-full rounded-lg border border-cyan-500/25 bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none"
                />
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 space-y-1.5">
                <span className="font-bold text-[var(--text-heading)] block">Respaldos SQL Antiguos</span>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Días antes de borrar respaldos (siempre conserva los 5 más recientes):
                </p>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={maintenanceDraft.backupsRetentionDays}
                  onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, backupsRetentionDays: e.target.value }))}
                  className="w-full rounded-lg border border-cyan-500/25 bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-cyan-500/15">
              <button
                type="submit"
                disabled={maintenanceBusy !== null}
                className="rounded-xl bg-[var(--brand-solid)] px-4 py-2 font-mono text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {maintenanceBusy === 'saving' ? 'Guardando…' : 'Guardar reglas'}
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={maintenanceBusy !== null}
                  onClick={() => { void runMaintenanceAction('preview'); }}
                  className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3.5 py-2 font-mono text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 cursor-pointer"
                >
                  {maintenanceBusy === 'preview' ? 'Analizando…' : 'Analizar espacio recuperable'}
                </button>
                <button
                  type="button"
                  disabled={maintenanceBusy !== null}
                  onClick={() => { void runMaintenanceAction('run'); }}
                  className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2 font-mono text-xs font-bold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50 cursor-pointer"
                >
                  {maintenanceBusy === 'run' ? 'Limpiando…' : 'Ejecutar limpieza ahora'}
                </button>
              </div>
            </div>
          </form>

          {maintenanceMessage && (
            <p className={`rounded-xl px-3 py-2 text-xs font-mono ${
              maintenanceMessage.type === 'success'
                ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'border border-rose-500/40 bg-rose-950/40 text-rose-300'
            }`}>
              {maintenanceMessage.text}
            </p>
          )}

          {maintenanceReport && (
            <div className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                  {maintenanceReport.dryRun ? 'Vista Previa (Simulación sin borrar)' : 'Resultado de la Limpieza'}
                </h3>
                <span className="font-mono text-xs font-bold text-emerald-400">
                  {maintenanceReport.totalFiles} archivos · {formatBytesLabel(maintenanceReport.totalBytesFreed)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
                {[
                  { label: 'Entregadas (garantía exp.)', data: maintenanceReport.deliveredExpired },
                  { label: 'Reembolsadas (> retención)', data: maintenanceReport.refundedExpired },
                  { label: 'Canceladas (inmediato)', data: maintenanceReport.cancelledImmediate },
                  { label: 'Audios PBX antiguos', data: maintenanceReport.pbxAudios },
                  { label: 'Respaldos SQL antiguos', data: maintenanceReport.backupsExpired || { ordersCount: 0, filesCount: 0, bytes: 0 } },
                  { label: 'Archivos huérfanos', data: maintenanceReport.orphans },
                ].map((cat) => (
                  <div key={cat.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5">
                    <p className="text-[10.5px] font-bold text-[var(--text-muted)]">{cat.label}</p>
                    <p className="mt-1 font-mono font-black text-[var(--text-heading)]">
                      {cat.data.filesCount} arch. · {formatBytesLabel(cat.data.bytes)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Limpieza de Docker en el VPS (Imágenes y caché de builds acumulados por deploys) */}
          <div className="rounded-2xl border border-cyan-500/20 bg-[var(--bg-surface)] p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)] flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-cyan-400">layers_clear</span>
                  Limpieza de Docker en el VPS (Imágenes de Deploys / Dokploy)
                </h3>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Elimina imágenes Docker viejas y caché de builds (&gt; 7 días) en el servidor anfitrión sin tocar volúmenes ni la base de datos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDockerGuide((v) => !v)}
                className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
              >
                {showDockerGuide ? 'Ocultar guía VPS' : 'Ver comando para el VPS'}
              </button>
            </div>

            {showDockerGuide && (
              <div className="rounded-xl border border-cyan-500/25 bg-[var(--bg-card)] p-3 space-y-2 text-[11px] text-[var(--text-muted)]">
                <p>
                  Por seguridad, el contenedor de RADAR no monta el socket de Docker. Para habilitar este botón en producción, inicia el agente ligero en el host del VPS:
                </p>
                <pre className="overflow-x-auto rounded-lg bg-black/50 p-2.5 font-mono text-[11px] text-emerald-300 select-all">
MAINTENANCE_SECRET=&lt;SECRETO&gt; HOST=172.18.0.1 PORT=9898 python3 scripts/vps-docker-prune-agent.py
                </pre>
                <p>
                  Luego ingresa la URL interna del agente (ej. <code className="font-mono text-cyan-300">http://172.18.0.1:9898</code>) y el mismo secreto abajo.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[var(--text-muted)] block">
                  URL del Agente Docker en el VPS
                </label>
                <input
                  type="url"
                  placeholder="http://host.docker.internal:9898"
                  value={maintenanceDraft.dockerPruneUrl}
                  onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, dockerPruneUrl: e.target.value }))}
                  className="w-full rounded-lg border border-cyan-500/25 bg-[var(--bg-card)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[var(--text-muted)] block">
                  Secreto del Agente (<code className="font-mono text-cyan-300">x-maintenance-secret</code>)
                  {maintenanceDraft.dockerPruneSecretConfigured && (
                    <span className="ml-2 text-emerald-400 font-normal">(configurado)</span>
                  )}
                </label>
                <input
                  type="password"
                  placeholder={maintenanceDraft.dockerPruneSecretConfigured ? '•••••••• (dejar vacío para mantener)' : 'Ingresa el secreto configurado en el VPS'}
                  value={maintenanceDraft.dockerPruneSecret}
                  onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, dockerPruneSecret: e.target.value }))}
                  className="w-full rounded-lg border border-cyan-500/25 bg-[var(--bg-card)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-cyan-500/15">
              <button
                type="button"
                disabled={maintenanceBusy !== null}
                onClick={() => { void saveMaintenanceSettings(); }}
                className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3.5 py-2 font-mono text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 cursor-pointer"
              >
                {maintenanceBusy === 'saving' ? 'Guardando…' : 'Guardar'}
              </button>
              <button
                type="button"
                disabled={maintenanceBusy !== null || !maintenanceDraft.dockerPruneUrl.trim()}
                onClick={() => { void runMaintenanceAction('docker-prune'); }}
                className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 font-mono text-xs font-bold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 cursor-pointer"
              >
                {maintenanceBusy === 'docker-prune' ? 'Limpiando Docker…' : 'Limpiar Docker ahora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUPER ADMIN: Disaster Recovery & Backup Center */}
      {activeTab === 'backups' && isSuperAdmin && (
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-6">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cyan-500/15 pb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                  <span aria-hidden="true" className="material-symbols-outlined text-[19px]">database</span>
                </div>
                <h2 className="text-base font-black text-white uppercase font-mono tracking-wider">
                  Centro de Respaldos & Rollback (Disaster Recovery)
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Módulo exclusivo para <strong>Super Administradores</strong>. Permite crear puntos de restauración, descargar copias SQL y aplicar rollbacks instantáneos ante pérdidas de datos.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {!isVaultLocked && vaultExpiresAt > Date.now() ? (
                <div className="flex items-center gap-2 bg-[#040814] px-3 py-1.5 rounded-xl border border-emerald-500/30">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Bóveda Desbloqueada
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleLockVault()}
                    className="text-[10px] font-mono text-slate-400 hover:text-white px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 transition-colors cursor-pointer"
                    title="Bloquear bóveda de seguridad inmediatamente"
                  >
                    Bloquear
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#040814] border border-cyan-500/20 text-slate-400 text-xs font-mono">
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-cyan-400">shield</span>
                  <span>Protegido con 2FA</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleCreateSnapshot()}
                disabled={creatingBackup}
                className="cyber-btn-primary px-4 py-2.5 text-xs font-black flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  {creatingBackup ? 'sync' : 'add_circle'}
                </span>
                <span>{creatingBackup ? 'Generando Snapshot...' : 'Crear Respaldo Ahora'}</span>
              </button>

              <button
                type="button"
                disabled={downloadingBackup !== null}
                onClick={() => void handleDownloadBackup()}
                className="cyber-btn-secondary px-3.5 py-2.5 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                title="Descargar volcado dinámico SQL actual"
              >
                <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${downloadingBackup === '__direct__' ? 'animate-spin' : ''}`}>
                  {downloadingBackup === '__direct__' ? 'sync' : 'download'}
                </span>
                <span className="hidden sm:inline">{downloadingBackup === '__direct__' ? 'Descargando…' : 'Descarga Directa'}</span>
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
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  {backupMessage.type === 'success' ? 'check_circle' : 'error'}
                </span>
                <span>{backupMessage.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setBackupMessage(null)}
                className="text-slate-400 hover:text-white"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          )}

          {/* Section: Upload .sql file for restoration */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-1 bg-[#040814] rounded-2xl border border-cyan-500/20 p-4 flex flex-col justify-between gap-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2 mb-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-[18px]">upload_file</span>
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
                    <span aria-hidden="true" className="material-symbols-outlined text-[22px]">cloud_upload</span>
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
                  disabled
                  title="Restauración directa deshabilitada por seguridad"
                  className="w-full bg-gradient-to-r from-amber-500 to-red-500 hover:from-amber-400 hover:to-red-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer active:scale-95 transition-all"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">restore</span>
                  <span>Restaurar desde este archivo</span>
                </button>
              )}
            </div>

            {/* Section: Local / Automatic Backups Table */}
            <div className="lg:col-span-2 bg-[#040814] rounded-2xl border border-cyan-500/20 p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2">
                    <span aria-hidden="true" className="material-symbols-outlined text-emerald-400 text-[18px]">history</span>
                    Respaldos Automáticos y Puntos de Rollback
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      if (isVaultLocked) {
                        setIsUnlockModalOpen(true);
                        return;
                      }
                      void fetchBackups();
                    }}
                    disabled={loadingBackups}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono cursor-pointer"
                  >
                    <span aria-hidden="true" className={`material-symbols-outlined text-[14px] ${loadingBackups ? 'animate-spin' : ''}`}>
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
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] animate-spin text-cyan-400">sync</span>
                    <span>Cargando respaldos disponibles...</span>
                  </div>
                ) : isVaultLocked ? (
                  <div className="py-10 px-4 text-center bg-[#070c18] rounded-xl border border-amber-500/30 space-y-3">
                    <p className="text-amber-300 text-xs font-mono flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">shield_lock</span>
                      <span>La lista de respaldos requiere desbloquear la bóveda de seguridad.</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsUnlockModalOpen(true)}
                      className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">lock_open</span>
                      <span>Desbloquear bóveda</span>
                    </button>
                  </div>
                ) : backupMessage?.type === 'error' ? (
                  <div className="py-8 px-4 text-center bg-[#070c18] rounded-xl border border-amber-500/35 space-y-3">
                    <p className="text-amber-200 text-xs font-mono flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">cloud_off</span>
                      <span>No pudimos cargar la lista de respaldos.</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchBackups()}
                      disabled={loadingBackups}
                      className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 text-amber-200 border border-amber-500/40 text-xs font-mono font-bold inline-flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${loadingBackups ? 'animate-spin' : ''}`}>refresh</span>
                      <span>Reintentar</span>
                    </button>
                  </div>
                ) : backups.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 text-xs font-mono bg-[#070c18] rounded-xl border border-cyan-500/15">
                    No se encontraron respaldos locales. Haz clic en "Crear Respaldo Ahora" para generar el primero.
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                    {backups.map((item) => {
                      const isAuto = item.filename.includes('cron_daily') || item.filename.includes('automatic');
                      const isManual = item.filename.includes('manual');
                      return (
                      <div
                        key={item.filename}
                        className="p-3 bg-[#070c18] rounded-xl border border-cyan-500/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-cyan-500/35 transition-all"
                      >
                        <div className="flex items-start sm:items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              item.isSafetySnapshot
                                ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                                : isAuto
                                ? 'bg-purple-500/15 border border-purple-500/30 text-purple-300'
                                : item.isRootFile
                                ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300'
                                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                            }`}
                          >
                            <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                              {item.isSafetySnapshot ? 'shield' : isAuto ? 'schedule' : 'save'}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold text-white">{item.filename}</span>
                              {item.isSafetySnapshot && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  Safety Snapshot
                                </span>
                              )}
                              {isAuto && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                  Automático
                                </span>
                              )}
                              {isManual && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  Manual
                                </span>
                              )}
                              {item.isRootFile && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
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
                            disabled={downloadingBackup !== null}
                            onClick={() => void handleDownloadBackup(item.filename)}
                            className="p-1.5 rounded-lg bg-[#040814] border border-cyan-500/20 hover:border-cyan-400 text-slate-300 hover:text-white transition-all text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Descargar archivo .sql"
                          >
                            <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${downloadingBackup === item.filename ? 'animate-spin' : ''}`}>
                              {downloadingBackup === item.filename ? 'sync' : 'download'}
                            </span>
                            <span className="text-[10px] font-mono">{downloadingBackup === item.filename ? 'Bajando…' : 'Descargar'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openRestoreModalForLocal(item)}
                            disabled
                            title="Restauración directa deshabilitada por seguridad"
                            className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-400 text-amber-300 font-bold transition-all text-xs flex items-center gap-1 cursor-pointer"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">settings_backup_restore</span>
                            <span className="text-[10px] font-mono">Rollback</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Rollback Modal */}
      {isRestoreModalOpen && restoreTarget && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
          <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-red-500/40 rounded-2xl w-full max-w-lg max-h-[min(94vh,680px)] shadow-[0_15px_50px_rgba(239,68,68,0.3)] overflow-hidden flex flex-col text-xs text-slate-300 relative my-auto">
            <div className="h-[2px] bg-gradient-to-r from-transparent via-red-400 to-transparent shadow-[0_0_12px_#ef4444] absolute top-0 inset-x-0" />

            {/* Modal Header */}
            <div className="px-4 py-2.5 border-b border-red-500/20 bg-red-950/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">warning</span>
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
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
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
                        <span aria-hidden="true" className="material-symbols-outlined text-[13px] animate-spin text-cyan-400">sync</span>
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
                        { label: 'Resguardo', icon: 'shield_person' },
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
                            <span aria-hidden="true" className={`material-symbols-outlined text-[12px] ${isCurrent ? 'animate-bounce text-cyan-300' : ''}`}>
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
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">report</span>
                      ¡ADVERTENCIA DE SOBREESCRITURA!
                    </p>
                    <p className="text-[10px] text-slate-300">
                      Se vaciarán las tablas operativas a cero, <strong className="text-emerald-300">conservando usuarios, claves e inventario de piezas</strong>, y luego se importará:
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
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">check_circle</span>
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
                      {typeof restoreResult.preservedInventoryCount === 'number' && (
                        <p>
                          Inventario conservado: <strong className="text-emerald-300">{restoreResult.preservedInventoryCount} piezas</strong>
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
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] animate-spin">sync</span>
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
                    disabled
                    className="bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-black px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(239,68,68,0.4)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer active:scale-95 transition-all"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
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
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px]">refresh</span>
                  <span>Finalizar y Recargar</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grid: Server status & Security Info */}
      {activeTab === 'general' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Database & Server Health */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-4">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <h3 className="font-bold text-sm text-white flex items-center gap-2 font-mono uppercase tracking-wider">
            <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-[18px]">dns</span>
            <span>Conexión de Base de Datos y Servidor</span>
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Estado del Motor MySQL</span>
              <span className={`font-mono font-bold flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] ${
                dbHealth?.ok ? 'neon-badge-emerald text-emerald-400' : 'neon-badge-amber text-amber-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dbHealth?.ok ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {dbHealth === null ? 'Comprobando conexión...' : dbHealth.ok ? 'En Línea (Conectado)' : 'No disponible'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Base de Datos Activa</span>
              <span className="font-mono text-cyan-300">
                {dbHealth === null ? 'Consultando...' : dbHealth.ok ? 'radar_v3 (MariaDB InnoDB)' : 'Sin conexión'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-cyan-500/15">
              <span className="text-slate-400 font-mono">Puerto de Servicio</span>
              <span className="font-mono text-slate-200">
                {dbHealth === null ? 'Consultando...' : dbHealth.ok ? '3000 (API) / 3306 (SQL)' : 'Sin conexión'}
              </span>
            </div>
          </div>
        </div>

        {/* Security & MFA */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-4">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <h3 className="font-bold text-sm text-white flex items-center gap-2 font-mono uppercase tracking-wider">
            <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-[18px]">security</span>
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

            {isSuperAdmin && (
              <form onSubmit={(e) => { void saveYardGlobalCode(e, false); }} className="pt-2 space-y-2 border-t border-cyan-500/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-bold text-slate-200">
                    Código Global · Acceso a Yarda
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    hasYardGlobalCode
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-500/35 bg-slate-500/10 text-slate-300'
                  }`}>
                    {hasYardGlobalCode ? 'Activo (Global + PIN)' : 'Solo PIN de empleado'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Permite entrar al portal de Yarda con un código único global sin asignar usuario, además de los PIN individuales por empleado.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={yardGlobalCode}
                    onChange={(e) => setYardGlobalCode(e.target.value)}
                    placeholder={hasYardGlobalCode ? 'Nuevo código global (deja vacío para conservar)' : 'Ej. 2026 o clave de 4+ dígitos'}
                    className="flex-1 min-w-[180px] rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    disabled={yardCodeSaving || !yardGlobalCode.trim()}
                    className="rounded-xl bg-[var(--brand-solid)] px-3.5 py-2 font-mono text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    {yardCodeSaving ? 'Guardando…' : 'Guardar código'}
                  </button>
                  {hasYardGlobalCode && (
                    <button
                      type="button"
                      disabled={yardCodeSaving}
                      onClick={(e) => { void saveYardGlobalCode(e, true); }}
                      className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 font-mono text-[11px] font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      Desactivar
                    </button>
                  )}
                </div>
                {yardCodeMessage && (
                  <p className={`text-[11px] font-mono ${yardCodeMessage.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {yardCodeMessage.text}
                  </p>
                )}
              </form>
            )}
            {isSuperAdmin && (
              <form onSubmit={(e) => { void saveMonitorCode(e, false); }} className="pt-3 space-y-2 border-t border-cyan-500/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-bold text-slate-200">
                    Código Global · Acceso a Llamadas
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    hasMonitorCode
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-500/35 bg-slate-500/10 text-slate-300'
                  }`}>
                    {hasMonitorCode ? 'Activo (Global)' : 'Sin código global'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Permite entrar al portal de Llamadas (<code className="font-mono text-cyan-300">calls.radar-rsy.store</code> / <code className="font-mono text-cyan-300">/llamadas</code>) con un código global único sin asignar usuario.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={monitorCode}
                    onChange={(e) => setMonitorCode(e.target.value)}
                    placeholder={hasMonitorCode ? 'Nuevo código global (deja vacío para conservar)' : 'Ej. 2026 o clave de 4+ dígitos'}
                    className="flex-1 min-w-[180px] rounded-xl border border-cyan-500/25 bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    disabled={monitorCodeSaving || !monitorCode.trim()}
                    className="rounded-xl bg-[var(--brand-solid)] px-3.5 py-2 font-mono text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    {monitorCodeSaving ? 'Guardando…' : 'Guardar código'}
                  </button>
                  {hasMonitorCode && (
                    <button
                      type="button"
                      disabled={monitorCodeSaving}
                      onClick={(e) => { void saveMonitorCode(e, true); }}
                      className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 font-mono text-[11px] font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      Desactivar
                    </button>
                  )}
                </div>
                {callsCodeMessage && (
                  <p className={`text-[11px] font-mono ${callsCodeMessage.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {callsCodeMessage.text}
                  </p>
                )}
              </form>
            )}
            {onOpenChangePassword && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onOpenChangePassword}
                  className="cyber-btn-secondary w-full py-2.5 px-3 text-xs font-bold justify-center"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">lock_reset</span>
                  <span>Cambiar mi contraseña</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Appearance & Theme Selector */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-4 md:col-span-2">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <h3 className="font-bold text-sm text-white flex items-center gap-2 font-mono uppercase tracking-wider">
            <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-[18px]">palette</span>
            <span>Apariencia y Tema Visual del Sistema</span>
          </h3>
          <p className="text-xs text-slate-400">
            Personaliza el modo de visualización de la plataforma. La selección se guarda automáticamente en tu navegador.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-1">
            {/* Dark Mode Card */}
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-2xl border flex items-center gap-3 transition-all cursor-pointer text-left ${
                theme === 'dark'
                  ? 'bg-cyan-950/40 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.25)]'
                  : 'bg-[var(--bg-card-subtle)] border-cyan-500/20 hover:border-cyan-500/40'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-slate-900 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 shadow-inner">
                <span aria-hidden="true" className="material-symbols-outlined text-[22px]">dark_mode</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <strong className="text-xs font-bold text-white block font-mono">Modo Cyberpunk Oscuro</strong>
                  {theme === 'dark' && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                  )}
                </div>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Fondo obsidian con rejilla holográfica y acentos cian neón.
                </span>
              </div>
            </button>

            {/* Light Mode Card */}
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`p-4 rounded-2xl border flex items-center gap-3 transition-all cursor-pointer text-left ${
                theme === 'light'
                  ? 'bg-cyan-500/15 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.25)]'
                  : 'bg-[var(--bg-card-subtle)] border-cyan-500/20 hover:border-cyan-500/40'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-white border border-cyan-500/40 flex items-center justify-center text-cyan-600 shrink-0 shadow-sm">
                <span aria-hidden="true" className="material-symbols-outlined text-[22px]">light_mode</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <strong className="text-xs font-bold text-white block font-mono">Modo Claro Optimizado</strong>
                  {theme === 'light' && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                  )}
                </div>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Fondo claro de alto contraste, tipografía nítida y legibilidad diurna.
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Integrations: Wasender Gateway & Notifications */}
      {activeTab === 'whatsapp' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="relative rounded-3xl bg-[var(--bg-card)] backdrop-blur-2xl border border-[var(--border-subtle)] p-5 md:p-6 shadow-[var(--card-shadow)] overflow-hidden flex flex-col gap-5 md:col-span-2">

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[var(--brand-soft)] border border-[var(--brand)]/30 flex items-center justify-center text-[var(--brand)]">
                <span aria-hidden="true" className="material-symbols-outlined text-[22px]">send</span>
              </div>
              <div>
                <h3 className="font-bold text-sm text-[var(--text-heading)] flex items-center gap-2 font-mono uppercase tracking-wider">
                  <span>Wasender Gateway (WhatsApp API)</span>
                </h3>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Motor de mensajería automatizada, notificaciones de órdenes, alertas de despacho y códigos de seguridad 2FA.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-[11px] font-mono font-bold flex items-center gap-1.5 border ${wasenderBadgeToneClass}`}
                role="status"
              >
                <span aria-hidden="true" className="w-2 h-2 rounded-full bg-current" />
                {wasenderVerification.label}
                {wasenderVerification.tone === 'success' && wasenderLastVerification ? ` · ${wasenderLastVerification}` : ''}
              </span>
              <button
                type="button"
                onClick={() => void handleSendTestPing('')}
                disabled={sendingTestPing || !wasenderStatus?.configured}
                className="px-3 py-1.5 rounded-xl border border-[var(--brand)]/35 bg-[var(--brand-soft)] text-[var(--brand)] hover:border-[var(--brand)]/60 text-[11px] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendingTestPing ? (
                  <>
                    <span aria-hidden="true" className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span>Probando...</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="material-symbols-outlined text-[15px]">network_check</span>
                    <span>Probar conexión</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void fetchWasenderStatus()}
                className="p-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-color)] transition-colors"
                title="Actualizar estado Wasender"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">refresh</span>
              </button>
            </div>
          </div>

          {wasenderStatus?.isTestMode && (
            <div className="flex items-start gap-2 rounded-xl border border-[color:var(--state-info)]/35 bg-[color:var(--state-info)]/10 px-3 py-2 text-[11px] text-[var(--text-primary)]" role="status">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--state-info)]">info</span>
              <span>Modo prueba activo: todos los envíos se redirigen al teléfono de pruebas, no a clientes reales.</span>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] rounded-2xl p-3.5 flex flex-col justify-between">
              <span className="text-[11px] text-[var(--text-secondary)] font-mono uppercase">Sesión Conectada</span>
              <span className="font-bold text-[var(--text-primary)] text-sm mt-1">{wasenderStatus?.sessionName || 'No disponible'}</span>
              <span className="font-mono text-[11px] text-[var(--brand)] mt-0.5">{wasenderStatus?.connectedPhone || 'Sin registrar'}</span>
            </div>

            <div className="bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] rounded-2xl p-3.5 flex flex-col justify-between">
              <span className="text-[11px] text-[var(--text-secondary)] font-mono uppercase">Empresa</span>
              <span className="font-bold text-[var(--text-primary)] text-sm mt-1">{wasenderStatus?.businessName || 'Sin registrar'}</span>
              <span className="text-[10px] text-[var(--text-secondary)] mt-0.5">Nombre comercial configurado</span>
            </div>

            <div className="bg-[var(--bg-card-subtle)] border border-[color:var(--state-info)]/30 rounded-2xl p-3.5 flex flex-col justify-between">
              <span className="text-[11px] text-[var(--text-secondary)] font-mono uppercase font-bold flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[13px]">shield</span>
                <span>Teléfono de Pruebas</span>
              </span>
              <span className="font-mono font-bold text-[var(--text-primary)] text-sm mt-1">
                {wasenderStatus?.designatedTestPhone || 'Sin registrar'}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                {wasenderStatus?.isTestMode ? 'Redirección activa' : 'Enrutamiento de pruebas'}
              </span>
            </div>

            <div className="bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] rounded-2xl p-3.5 flex flex-col justify-between">
              <span className="text-[11px] text-[var(--text-secondary)] font-mono uppercase">Última verificación</span>
              <span className="font-bold text-[var(--text-primary)] text-sm mt-1">
                {wasenderLastVerification || 'Sin verificar'}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] mt-0.5">Registrada por «Probar conexión»</span>
            </div>
          </div>

          {/* Interactive Live Message Test Box */}
          <div className="bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-heading)] font-mono">
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">terminal</span>
                <span>Mensaje de prueba en vivo</span>
              </div>
              <span className="text-[11px] text-[var(--text-secondary)]">
                Destino: <strong className="font-mono text-[var(--text-primary)]">{wasenderStatus?.designatedTestPhone || 'Sin registrar'}</strong>
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={testCustomMessage}
                onChange={(e) => setTestCustomMessage(e.target.value)}
                placeholder="Escribe un mensaje de prueba (o déjalo vacío para ping con hora)..."
                aria-label="Mensaje de prueba para WhatsApp"
                className="flex-1 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] px-3.5 py-2.5 text-xs text-[var(--input-text)] focus:outline-none focus:border-[var(--brand)] placeholder:text-[var(--text-secondary)] font-mono"
              />
              <button
                type="button"
                onClick={() => void handleSendTestPing()}
                disabled={sendingTestPing || !wasenderStatus?.configured}
                className="px-4 py-2.5 rounded-xl bg-[var(--brand-solid)] hover:bg-[var(--brand-hover)] text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {sendingTestPing ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span>Transmitiendo...</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">send</span>
                    <span>Enviar prueba</span>
                  </>
                )}
              </button>
            </div>

            {testPingFeedback && (
              <div
                role={testPingFeedback.type === 'success' ? 'status' : 'alert'}
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 animate-fade-in ${
                  testPingFeedback.type === 'success'
                    ? 'bg-[color:var(--state-success)]/10 border-[color:var(--state-success)]/40 text-[var(--text-primary)]'
                    : 'bg-[var(--state-urgency-tint)] border-[var(--state-urgency-border)] text-[var(--state-urgency-text)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`material-symbols-outlined text-[18px] ${testPingFeedback.type === 'success' ? 'text-[var(--state-success)]' : 'text-[var(--state-urgency)]'}`}
                >
                  {testPingFeedback.type === 'success' ? 'check_circle' : 'error'}
                </span>
                <span>{testPingFeedback.text}</span>
              </div>
            )}
          </div>
        </div>

        {/* Multichannel Notification Routing & External Numbers Manager */}
        <div className="md:col-span-2">
          <WasenderNotificationsManager userRole={userRole} />
        </div>
      </div>
      )}

      {/* Vault Unlock 2FA Modal */}
      <VaultUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => {
          setIsUnlockModalOpen(false);
          setPendingAction(null);
        }}
        onSuccess={(exp) => {
          setIsVaultLocked(false);
          setVaultExpiresAt(exp);
          setIsUnlockModalOpen(false);
          setBackupMessage({
            type: 'success',
            text: 'Bóveda de seguridad autorizada exitosamente por 15 minutos.',
          });
          if (pendingAction) {
            const action = pendingAction;
            setPendingAction(null);
            setTimeout(() => action(), 100);
          } else {
            void fetchBackups();
          }
        }}
      />
    </div>
  );
};
