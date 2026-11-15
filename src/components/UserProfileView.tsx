import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiFetch } from '../services/apiFetch';
import { useFeedback } from './FeedbackProvider';
import { VaultUnlockModal } from './VaultUnlockModal';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { formatLempiras, isoDateInTimeZone, type WeekPayroll } from '../utils/payroll';
import type { WorkflowTask } from '../utils/orderWorkflow';
import { followupQueueUrl, followupSummary, groupFollowupTasks, parseFollowupQueue, type FollowupQueuePayload } from '../utils/followupQueue';

interface ProfileInfo {
  id: number;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string;
  role: string;
  active: boolean;
  createdAt?: string;
  hiredOn: string | null;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  weeklySalary: number | null;
  hasPin: boolean;
}

export interface FaultAppeal {
  id: number;
  message: string;
  status: 'pendiente' | 'aceptada' | 'rechazada';
  resolutionNote: string;
  createdAt?: string;
  resolvedAt?: string;
}

export interface FaultItem {
  id: number;
  faultType: string;
  points: number;
  amount: number;
  faultDate: string;
  notes: string;
  status: 'activa' | 'anulada';
  createdAt?: string;
  annulledAt?: string;
  createdByName: string;
  appeal: FaultAppeal | null;
}

interface ProfilePayload {
  profile: ProfileInfo;
  payroll: { timeZone: string; currentWeek: WeekPayroll; history: WeekPayroll[] };
  faults: FaultItem[];
  canManage: boolean;
}

interface CatalogItem {
  id: number;
  name: string;
  description: string;
  points: number;
  amount: number;
  active: boolean;
}

interface UserProfileViewProps {
  targetUserId: number;
  viewerId?: number;
  viewerRole: string;
  onBack?: () => void;
  onOpenAccountSettings?: () => void;
  variant?: 'office' | 'yard';
}

type Tab = 'resumen' | 'seguimiento' | 'faltas' | 'datos';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  vendedor_yarda: 'Vendedor Yarda',
};

export interface Tone {
  page: string;
  card: string;
  subtle: string;
  input: string;
  heading: string;
  muted: string;
  primary: string;
  secondary: string;
  chip: string;
  tabActive: string;
  warningText: string;
  warningBox: string;
}

export const TONES: Record<'office' | 'yard', Tone> = {
  office: {
    page: 'text-[var(--text-primary)]',
    card: 'bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm',
    subtle: 'bg-[var(--bg-surface)] border border-[var(--border-subtle)]',
    input: 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--brand-solid)]',
    heading: 'text-[var(--text-heading)]',
    muted: 'text-[var(--text-secondary)]',
    primary: 'bg-[var(--brand-solid)] text-[color:#ffffff] hover:opacity-90',
    secondary: 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]',
    chip: 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]',
    tabActive: 'bg-[var(--text-heading)] text-[var(--bg-card)]',
    warningText: 'text-[var(--state-urgency-text)]',
    warningBox: 'border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]',
  },
  yard: {
    page: 'yard-app bg-[var(--yard-bg)] text-[var(--yard-ink)]',
    card: 'bg-[var(--yard-surface)] border border-[var(--yard-line)] shadow-[var(--yard-shadow-1)]',
    subtle: 'bg-[var(--yard-raised)] border border-[var(--yard-line)]',
    input: 'bg-white border border-[var(--yard-line-strong)] text-[var(--yard-ink)] focus:border-[var(--yard-accent-strong)]',
    heading: 'text-[var(--yard-ink)]',
    muted: 'text-[var(--yard-muted)]',
    primary: 'bg-[var(--yard-accent)] text-[var(--yard-accent-ink)] hover:brightness-95',
    secondary: 'bg-[var(--yard-raised)] border border-[var(--yard-line)] text-[var(--yard-ink-soft)]',
    chip: 'bg-[var(--yard-raised)] border border-[var(--yard-line)] text-[var(--yard-muted)]',
    tabActive: 'bg-[var(--yard-accent)] text-[var(--yard-accent-ink)]',
    warningText: 'text-amber-700',
    warningBox: 'border border-amber-300 bg-amber-50 text-amber-800',
  },
};

const formatFaultDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });

const initialsFor = (name: string) =>
  (name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '').join('') || '?';

export const WeekLiquidation: React.FC<{
  week: WeekPayroll;
  history: WeekPayroll[];
  tone: Tone;
  hasSalary: boolean;
  canManage: boolean;
}> = ({ week, history, tone, hasSalary, canManage }) => (
  <>
    <div className={`rounded-3xl p-4 sm:p-5 ${tone.card}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${tone.muted}`}>Liquidación de la semana</p>
          <p className={`mt-1 text-sm font-bold ${tone.heading}`}>{week.label}</p>
          <p className={`mt-0.5 text-[11px] ${tone.muted}`}>Corte lunes a domingo · hora de Honduras</p>
        </div>
        <div className="text-right">
          <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${tone.muted}`}>Cobro estimado</p>
          <p className={`mt-0.5 text-2xl font-black tabular-nums ${week.net < 0 ? tone.warningText : tone.heading}`}>
            {formatLempiras(week.net)}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className={`rounded-2xl px-3 py-2.5 ${tone.subtle}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Salario base</p>
          <p className={`mt-1 text-sm font-black tabular-nums ${tone.heading}`}>{formatLempiras(week.gross)}</p>
        </div>
        <div className={`rounded-2xl px-3 py-2.5 ${tone.subtle}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Descuentos</p>
          <p className={`mt-1 text-sm font-black tabular-nums ${week.deductions > 0 ? tone.warningText : tone.heading}`}>
            {week.deductions > 0 ? `−${formatLempiras(week.deductions)}` : formatLempiras(0)}
          </p>
        </div>
        <div className={`rounded-2xl px-3 py-2.5 ${tone.subtle}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Puntos</p>
          <p className={`mt-1 text-sm font-black tabular-nums ${week.points > 0 ? tone.warningText : tone.heading}`}>
            {week.points} pts
          </p>
        </div>
      </div>
      {!hasSalary && (
        <p className={`mt-3 rounded-xl px-3 py-2 text-[11.5px] ${tone.warningBox}`}>
          {canManage
            ? 'Este usuario aún no tiene salario semanal configurado. Puedes definirlo en la pestaña «Datos».'
            : 'La administración aún no ha configurado tu salario semanal.'}
        </p>
      )}
    </div>
    <div className={`overflow-hidden rounded-3xl ${tone.card}`}>
      <div className={`border-b px-4 py-3 ${tone.subtle}`}>
        <p className={`text-xs font-bold ${tone.heading}`}>Historial de semanas</p>
        <p className={`text-[11px] ${tone.muted}`}>Salario base menos faltas activas de cada semana.</p>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {history.map((entry, index) => (
          <div key={entry.start} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className={`truncate text-xs font-semibold ${tone.heading}`}>
                {entry.label}
                {index === 0 && <span className={`ml-2 rounded-full px-2 py-0.5 text-[9.5px] font-bold ${tone.chip}`}>En curso</span>}
              </p>
              <p className={`text-[10.5px] ${tone.muted}`}>
                Base {formatLempiras(entry.gross)} · {entry.faultCount} {entry.faultCount === 1 ? 'falta' : 'faltas'} · {entry.points} pts
              </p>
            </div>
            <p className={`shrink-0 text-xs font-black tabular-nums ${entry.net < 0 ? tone.warningText : tone.heading}`}>
              {formatLempiras(entry.net)}
            </p>
          </div>
        ))}
      </div>
    </div>
  </>
);

export const FaultHistoryList: React.FC<{
  faults: FaultItem[];
  tone: Tone;
  isSelf: boolean;
  canManage: boolean;
  onAppeal: (fault: FaultItem) => void;
  onAnnul: (fault: FaultItem) => void;
  onResolveAppeal: (appeal: FaultAppeal) => void;
}> = ({ faults, tone, isSelf, canManage, onAppeal, onAnnul, onResolveAppeal }) => (
  <div className="space-y-2.5">
    {faults.length === 0 && (
      <div className={`rounded-2xl px-4 py-8 text-center ${tone.card}`}>
        <span className={`material-symbols-outlined text-[28px] ${tone.muted}`}>verified_user</span>
        <p className={`mt-2 text-sm font-semibold ${tone.heading}`}>Sin faltas registradas</p>
        <p className={`text-[11.5px] ${tone.muted}`}>El historial de incumplimientos aparecerá aquí.</p>
      </div>
    )}
    {faults.map((fault) => (
      <div key={fault.id} className={`rounded-2xl p-3.5 ${tone.card} ${fault.status === 'anulada' ? 'opacity-70' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={`text-sm font-bold ${tone.heading}`}>{fault.faultType}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                fault.status === 'activa' ? tone.warningBox : tone.chip
              }`}>
                {fault.status === 'activa' ? 'Activa' : 'Anulada'}
              </span>
            </div>
            <p className={`mt-0.5 text-[11px] ${tone.muted}`}>
              {formatFaultDate(fault.faultDate)}
              {fault.createdByName ? ` · Registrada por ${fault.createdByName}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-sm font-black tabular-nums ${
              fault.status === 'activa' ? tone.warningText : `${tone.muted} line-through`
            }`}>
              {fault.amount > 0 ? `−${formatLempiras(fault.amount)}` : 'Sin monto'}
            </p>
            <p className={`text-[10.5px] ${tone.muted}`}>{fault.points} pts</p>
            {fault.status === 'anulada' && <p className={`text-[10.5px] font-semibold ${tone.muted}`}>Sin descuento</p>}
          </div>
        </div>
        {fault.notes && <p className={`mt-2 rounded-xl px-2.5 py-2 text-[11.5px] ${tone.subtle}`}>{fault.notes}</p>}
        {fault.appeal && (
          <div className={`mt-2 rounded-xl border px-2.5 py-2 text-[11.5px] ${
            fault.appeal.status === 'pendiente'
              ? tone.warningBox
              : fault.appeal.status === 'aceptada'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : tone.subtle
          }`}>
            <p className="font-bold">
              Apelación {fault.appeal.status === 'pendiente' ? 'pendiente' : fault.appeal.status === 'aceptada' ? 'aceptada' : 'rechazada'}
            </p>
            <p className="mt-0.5 whitespace-pre-line">{fault.appeal.message}</p>
            {fault.appeal.resolutionNote && <p className="mt-1 opacity-80">Respuesta: {fault.appeal.resolutionNote}</p>}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {isSelf && fault.status === 'activa' && !fault.appeal && (
            <button
              type="button"
              onClick={() => onAppeal(fault)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${tone.secondary}`}
            >
              Apelar falta
            </button>
          )}
          {canManage && fault.status === 'activa' && (
            <button
              type="button"
              onClick={() => onAnnul(fault)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${tone.secondary}`}
            >
              Anular falta
            </button>
          )}
          {canManage && fault.appeal?.status === 'pendiente' && (
            <button
              type="button"
              onClick={() => onResolveAppeal(fault.appeal as FaultAppeal)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${tone.primary}`}
            >
              Resolver apelación
            </button>
          )}
        </div>
      </div>
    ))}
  </div>
);

const isVaultError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const code = (error as { code?: string } | null)?.code;
  return code === 'FINANCE_LOCKED' || message.includes('boveda') || message.includes('bóveda');
};

const followupUrgency = (task: WorkflowTask) =>
  task.bucket === 'overdue' || task.overdue ? { label: 'Atrasada', urgent: true }
    : task.bucket === 'today' ? { label: 'Hoy', urgent: true }
    : task.bucket === 'blocked' ? { label: 'Bloqueada', urgent: false }
    : task.bucket === 'waiting' ? { label: 'En espera', urgent: false }
    : { label: 'Próxima', urgent: false };

export const FollowupBoard: React.FC<{ tasks: WorkflowTask[]; tone: Tone }> = ({ tasks, tone }) => {
  const summary = followupSummary(tasks);
  const groups = groupFollowupTasks(tasks);
  if (summary.total === 0) {
    return (
      <div className={`rounded-2xl px-4 py-8 text-center ${tone.card}`}>
        <span className={`material-symbols-outlined text-[28px] ${tone.muted}`}>task_alt</span>
        <p className={`mt-2 text-sm font-semibold ${tone.heading}`}>Sin pendientes de seguimiento</p>
        <p className={`text-[11.5px] ${tone.muted}`}>Aquí aparecerán los seguimientos post-entrega, reclamos y piezas listas para entregar asignados a este colaborador.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className={`rounded-2xl px-4 py-3 ${tone.card}`}>
        <p className={`text-sm font-bold ${tone.heading}`}>{summary.total} pendientes</p>
        <p className={`mt-0.5 text-[11.5px] ${summary.overdue > 0 ? tone.warningText : tone.muted}`}>
          {summary.overdue > 0 ? `${summary.overdue} ${summary.overdue === 1 ? 'atrasado' : 'atrasados'} · ` : ''}
          {summary.readyPieces > 0
            ? `${summary.readyPieces} ${summary.readyPieces === 1 ? 'pieza lista' : 'piezas listas'} en patio`
            : 'Seguimiento post-entrega, reclamos y piezas por entregar'}
        </p>
      </div>
      {groups.filter((group) => group.tasks.length > 0).map((group) => (
        <div key={group.key} className="space-y-2.5">
          <div>
            <p className={`text-xs font-bold ${tone.heading}`}>{group.title} · {group.tasks.length}</p>
            <p className={`text-[11px] ${tone.muted}`}>{group.subtitle}</p>
          </div>
          {group.tasks.map((task) => {
            const urgency = followupUrgency(task);
            return (
              <div key={`${task.order.id}-${task.task}`} className={`rounded-2xl p-3.5 ${tone.card}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-bold ${tone.heading}`}>{task.title}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        urgency.urgent ? tone.warningBox : tone.chip
                      }`}>
                        {urgency.label}
                      </span>
                      {task.task === 'prepare' && task.order.yardPieceReady && (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.warningBox}`}>
                          Pieza lista en patio
                        </span>
                      )}
                    </div>
                    <p className={`mt-0.5 text-[11px] ${tone.muted}`}>
                      {task.order.code}
                      {task.order.customerName ? ` · ${task.order.customerName}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10.5px] ${tone.muted}`}>Vence {formatFaultDate(task.dueDate)}</p>
                    {task.overdue && task.daysOverdue > 0 && (
                      <p className={`text-[10.5px] font-bold ${tone.warningText}`}>{task.daysOverdue} {task.daysOverdue === 1 ? 'día' : 'días'} de atraso</p>
                    )}
                    {task.penaltyPoints < 0 && (
                      <p className={`text-[10.5px] font-bold ${tone.warningText}`}>−{Math.abs(task.penaltyPoints)} pts de puntuación</p>
                    )}
                  </div>
                </div>
                <p className={`mt-2 rounded-xl px-2.5 py-2 text-[11.5px] ${tone.subtle}`}>{task.nextAction || task.requirement}</p>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const Dialog: React.FC<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  tone: Tone;
  children: ReactNode;
  footer?: ReactNode;
}> = ({ title, subtitle, onClose, tone, children, footer }) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogAccessibility({ open: true, dialogRef, onEscape: onClose });
  return (
    <div className="yard-overlay fixed inset-0 z-[170] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl outline-none sm:max-w-lg sm:rounded-3xl ${tone.card}`}
      >
        <div className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${tone.subtle}`}>
          <div className="min-w-0">
            <h3 className={`text-base font-bold ${tone.heading}`}>{title}</h3>
            {subtitle && <p className={`mt-0.5 text-[11.5px] ${tone.muted}`}>{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone.muted}`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">{children}</div>
        {footer && <div className={`flex gap-2 border-t px-5 py-4 ${tone.subtle}`}>{footer}</div>}
      </div>
    </div>
  );
};

export const UserProfileView: React.FC<UserProfileViewProps> = ({
  targetUserId,
  viewerId,
  viewerRole,
  onBack,
  onOpenAccountSettings,
  variant = 'office',
}) => {
  const tone = TONES[variant];
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('resumen');
  const [saving, setSaving] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [faultModalOpen, setFaultModalOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [appealFault, setAppealFault] = useState<FaultItem | null>(null);
  const [resolveAppeal, setResolveAppeal] = useState<FaultAppeal | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const submitFaultRef = useRef<((input: { catalogId: number; faultDate: string; notes: string }) => Promise<boolean>) | null>(null);

  const [draft, setDraft] = useState({
    address: '', emergencyContactName: '', emergencyContactPhone: '', salary: '', hiredOn: '',
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/users/${targetUserId}/profile`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo cargar el perfil.');
      setData(payload as ProfilePayload);
      const profile = (payload as ProfilePayload).profile;
      setDraft({
        address: profile.address || '',
        emergencyContactName: profile.emergencyContactName || '',
        emergencyContactPhone: profile.emergencyContactPhone || '',
        salary: profile.weeklySalary === null ? '' : String(profile.weeklySalary),
        hiredOn: profile.hiredOn || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el perfil.');
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => { void load(); }, [load]);

  const [queue, setQueue] = useState<FollowupQueuePayload | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const response = await apiFetch(followupQueueUrl(targetUserId, viewerRole));
      const payload = await response.json().catch(() => ({}));
      if (response.status === 403) {
        setQueue(null);
        setQueueError('Tu rol no tiene acceso a los seguimientos.');
        return;
      }
      if (!response.ok) {
        setQueue(null);
        setQueueError((payload as { message?: string }).message || 'No se pudieron cargar los seguimientos.');
        return;
      }
      setQueue(parseFollowupQueue(payload));
    } catch (err) {
      setQueue(null);
      setQueueError(err instanceof Error ? err.message : 'No se pudieron cargar los seguimientos.');
    } finally {
      setQueueLoading(false);
    }
  }, [targetUserId, viewerRole]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const handleVaultRetry = useCallback((retry: () => void) => {
    retryRef.current = retry;
    setVaultOpen(true);
  }, []);

  const reportError = useCallback((err: unknown, retry?: () => void) => {
    if (retry && isVaultError(err)) {
      handleVaultRetry(retry);
      return;
    }
    toast({
      title: 'No se pudo completar la acción',
      message: err instanceof Error ? err.message : undefined,
      tone: 'error',
    });
  }, [handleVaultRetry, toast]);

  const profile = data?.profile;
  const canManage = Boolean(data?.canManage) && viewerRole === 'admin';
  const currentWeek = data?.payroll.currentWeek;
  const pendingAppeals = useMemo(
    () => (data?.faults || []).filter((fault) => fault.appeal?.status === 'pendiente').length,
    [data]
  );
  const activeFaults = useMemo(
    () => (data?.faults || []).filter((fault) => fault.status === 'activa').length,
    [data]
  );

  const saveDetails = useCallback(async () => {
    if (!profile) return;
    const salaryValue = draft.salary.trim();
    if (canManage && salaryValue && (!Number.isFinite(Number(salaryValue)) || Number(salaryValue) < 0)) {
      toast({ title: 'Salario inválido', message: 'Escribe un monto mayor o igual a cero.', tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        address: draft.address.trim() || null,
        emergency_contact_name: draft.emergencyContactName.trim() || null,
        emergency_contact_phone: draft.emergencyContactPhone.trim() || null,
      };
      if (canManage) {
        payload.weekly_salary = salaryValue ? Number(salaryValue) : null;
        payload.hired_on = draft.hiredOn || null;
      }
      const response = await apiFetch(`/users/${targetUserId}/profile`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const wrapped = new Error(body.message || 'No se pudo guardar el perfil.');
        (wrapped as Error & { code?: string }).code = body.code;
        throw wrapped;
      }
      toast({ title: 'Perfil actualizado', message: 'Los datos se guardaron correctamente.', tone: 'success' });
      await load(true);
    } catch (err) {
      reportError(err, () => { void saveDetails(); });
    } finally {
      setSaving(false);
    }
  }, [canManage, draft, load, profile, reportError, targetUserId, toast]);

  const submitFault = useCallback(async (input: { catalogId: number; faultDate: string; notes: string }) => {
    setSaving(true);
    try {
      const response = await apiFetch('/faults', {
        method: 'POST',
        body: JSON.stringify({
          user_id: targetUserId,
          catalog_id: input.catalogId,
          fault_date: input.faultDate,
          notes: input.notes.trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const wrapped = new Error(body.message || 'No se pudo registrar la falta.');
        (wrapped as Error & { code?: string }).code = body.code;
        throw wrapped;
      }
      setFaultModalOpen(false);
      toast({ title: 'Falta registrada', message: 'El descuento ya aparece en la liquidación.', tone: 'success' });
      await load(true);
      return true;
    } catch (err) {
      if (isVaultError(err)) {
        handleVaultRetry(() => {
          setFaultModalOpen(true);
          void submitFaultRef.current?.(input);
        });
        return false;
      }
      reportError(err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [handleVaultRetry, load, reportError, targetUserId, toast]);

  submitFaultRef.current = submitFault;

  const annulFault = useCallback(async (fault: FaultItem) => {
    const confirmed = await confirm({
      title: `¿Anular la falta «${fault.faultType}»?`,
      message: `Se devolverá ${formatLempiras(fault.amount)} y ${fault.points} pts a la liquidación.`,
      confirmLabel: 'Anular falta',
    });
    if (!confirmed) return;
    try {
      const response = await apiFetch(`/faults/${fault.id}/annul`, { method: 'POST', body: JSON.stringify({}) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const wrapped = new Error(body.message || 'No se pudo anular la falta.');
        (wrapped as Error & { code?: string }).code = body.code;
        throw wrapped;
      }
      toast({ title: 'Falta anulada', message: 'El descuento se retiró de la liquidación.', tone: 'success' });
      await load(true);
    } catch (err) {
      reportError(err, () => { void annulFault(fault); });
    }
  }, [confirm, load, reportError, toast]);

  const sendAppeal = useCallback(async (fault: FaultItem, message: string) => {
    setSaving(true);
    try {
      const response = await apiFetch(`/faults/${fault.id}/appeal`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo enviar la apelación.');
      setAppealFault(null);
      toast({ title: 'Apelación enviada', message: 'La administración la revisará y te responderá aquí.', tone: 'success' });
      await load(true);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }, [load, reportError, toast]);

  const resolve = useCallback(async (appeal: FaultAppeal, decision: 'aceptada' | 'rechazada', note: string) => {
    setSaving(true);
    try {
      const response = await apiFetch(`/faults/appeals/${appeal.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: note.trim() || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const wrapped = new Error(body.message || 'No se pudo resolver la apelación.');
        (wrapped as Error & { code?: string }).code = body.code;
        throw wrapped;
      }
      setResolveAppeal(null);
      toast({
        title: decision === 'aceptada' ? 'Apelación aceptada' : 'Apelación rechazada',
        message: decision === 'aceptada' ? 'La falta quedó anulada y el descuento se retiró.' : 'La falta y su descuento se mantienen.',
        tone: 'success',
      });
      await load(true);
    } catch (err) {
      reportError(err, () => { void resolve(appeal, decision, note); });
    } finally {
      setSaving(false);
    }
  }, [load, reportError, toast]);

  if (loading && !data) {
    return (
      <div className={`flex min-h-[280px] items-center justify-center ${tone.page}`}>
        <span className={`material-symbols-outlined animate-spin text-[26px] ${tone.muted}`}>sync</span>
      </div>
    );
  }

  if (error || !profile || !data) {
    return (
      <div className={`space-y-3 p-4 ${tone.page}`}>
        <div className={`rounded-2xl p-4 text-sm ${tone.card}`}>{error || 'No se pudo cargar el perfil.'}</div>
        <button type="button" onClick={() => { void load(); }} className={`rounded-xl px-4 py-2 text-xs font-bold ${tone.primary}`}>
          Reintentar
        </button>
      </div>
    );
  }

  const isSelf = viewerId !== undefined && Number(profile.id) === Number(viewerId);

  const detailsForm = (
    <div className={`space-y-4 rounded-3xl p-4 sm:p-5 ${tone.card}`}>
      <div>
        <p className={`text-sm font-bold ${tone.heading}`}>Datos del colaborador</p>
        <p className={`text-[11.5px] ${tone.muted}`}>
          {canManage ? 'La administración puede editar contacto y compensación.' : 'Puedes actualizar tus datos de contacto y emergencia.'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[11px] font-bold">
          <span className={tone.muted}>Dirección</span>
          <input
            type="text"
            value={draft.address}
            maxLength={255}
            onChange={(event) => setDraft((prev) => ({ ...prev, address: event.target.value }))}
            placeholder="Colonia, calle, referencia"
            className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
          />
        </label>
        <label className="block text-[11px] font-bold">
          <span className={tone.muted}>Contacto de emergencia</span>
          <input
            type="text"
            value={draft.emergencyContactName}
            maxLength={160}
            onChange={(event) => setDraft((prev) => ({ ...prev, emergencyContactName: event.target.value }))}
            placeholder="Nombre completo"
            className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
          />
        </label>
        <label className="block text-[11px] font-bold">
          <span className={tone.muted}>Teléfono de emergencia</span>
          <input
            type="tel"
            value={draft.emergencyContactPhone}
            maxLength={40}
            onChange={(event) => setDraft((prev) => ({ ...prev, emergencyContactPhone: event.target.value }))}
            placeholder="Ej. +504 9999-0000"
            className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
          />
        </label>
        {canManage && (
          <>
            <label className="block text-[11px] font-bold">
              <span className={tone.muted}>Salario semanal (L)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={draft.salary}
                onChange={(event) => setDraft((prev) => ({ ...prev, salary: event.target.value }))}
                placeholder="0.00"
                className={`mt-1 w-full rounded-xl px-3 py-2 text-xs tabular-nums outline-none ${tone.input}`}
              />
            </label>
            <label className="block text-[11px] font-bold">
              <span className={tone.muted}>Fecha de ingreso</span>
              <input
                type="date"
                value={draft.hiredOn}
                onChange={(event) => setDraft((prev) => ({ ...prev, hiredOn: event.target.value }))}
                className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
              />
            </label>
          </>
        )}
      </div>
      <div className={`grid gap-2 rounded-2xl px-3 py-2.5 text-[11.5px] sm:grid-cols-3 ${tone.subtle}`}>
        <span><span className={tone.muted}>Correo: </span>{profile.email || '—'}</span>
        <span><span className={tone.muted}>Teléfono: </span>{profile.phone || '—'}</span>
        <span><span className={tone.muted}>Acceso Yarda: </span>{profile.hasPin ? 'PIN configurado' : 'Sin PIN'}</span>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { void saveDetails(); }}
          disabled={saving}
          className={`rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-50 ${tone.primary}`}
        >
          {saving ? 'Guardando…' : 'Guardar datos'}
        </button>
      </div>
    </div>
  );

  return (
    <div className={variant === 'yard' ? 'fixed inset-0 z-[140] overflow-y-auto' : ''}>
      <div className={`${tone.page} ${variant === 'yard' ? 'min-h-full' : 'space-y-4'}`}>
        <div className={variant === 'yard' ? 'mx-auto w-full max-w-3xl px-3 pb-24 pt-4 sm:px-4' : 'space-y-4'}>
          <div className={`rounded-3xl p-4 sm:p-5 ${tone.card}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {onBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    aria-label="Volver"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone.secondary}`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[20px]">arrow_back</span>
                  </button>
                )}
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-mono text-lg font-black ${
                  variant === 'yard' ? 'bg-[var(--yard-accent-soft)] text-[var(--yard-accent-strong)]' : 'bg-[var(--bg-surface)] text-[var(--brand-solid)] border border-[var(--border-subtle)]'
                }`}>
                  {profile.avatarUrl
                    ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                    : initialsFor(profile.name)}
                </div>
                <div className="min-w-0">
                  <h1 className={`truncate text-lg font-black sm:text-xl ${tone.heading}`}>{profile.name}</h1>
                  <p className={`truncate text-[11.5px] ${tone.muted}`}>
                    {ROLE_LABELS[profile.role] || profile.role}
                    {profile.hiredOn ? ` · Ingreso ${formatFaultDate(profile.hiredOn)}` : ''}
                    {!profile.active ? ' · Cuenta inactiva' : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {isSelf && onOpenAccountSettings && (
                  <button
                    type="button"
                    onClick={onOpenAccountSettings}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-bold ${tone.secondary}`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">manage_accounts</span>
                    Cuenta y seguridad
                  </button>
                )}
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => setFaultModalOpen(true)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-bold ${tone.primary}`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add_alert</span>
                      Registrar falta
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatalogOpen(true)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-bold ${tone.secondary}`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">tune</span>
                      Catálogo
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={`flex gap-1.5 rounded-2xl p-1 ${tone.card}`} role="tablist" aria-label="Secciones del perfil">
            {([
              ['resumen', 'Resumen'],
              ['seguimiento', 'Seguimiento'],
              ['faltas', `Faltas${activeFaults ? ` · ${activeFaults}` : ''}`],
              ['datos', 'Datos'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-xl px-2 py-2 text-[11.5px] font-bold transition ${
                  tab === key ? tone.tabActive : `${tone.muted} hover:bg-black/5`
                }`}
              >
                {label}
                {key === 'faltas' && pendingAppeals > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9.5px] font-black text-amber-950">
                    {pendingAppeals}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === 'resumen' && (
            <div className="space-y-4">
              {currentWeek && (
                <WeekLiquidation
                  week={currentWeek}
                  history={data.payroll.history}
                  tone={tone}
                  hasSalary={profile.weeklySalary !== null}
                  canManage={canManage}
                />
              )}
            </div>
          )}

          {tab === 'seguimiento' && (
            <div className="space-y-3">
              {queueLoading ? (
                <div className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-8 text-[11.5px] ${tone.card} ${tone.muted}`}>
                  <span className={`material-symbols-outlined animate-spin text-[18px] ${tone.muted}`}>sync</span>
                  Cargando seguimientos…
                </div>
              ) : queueError ? (
                <div className={`rounded-2xl px-4 py-6 text-center ${tone.card}`}>
                  <p className={`text-[11.5px] ${tone.muted}`}>{queueError}</p>
                  <button
                    type="button"
                    onClick={() => { void loadQueue(); }}
                    className={`mt-3 rounded-xl px-4 py-2 text-xs font-bold ${tone.primary}`}
                  >
                    Reintentar
                  </button>
                </div>
              ) : (
                <FollowupBoard tasks={queue?.tasks || []} tone={tone} />
              )}
            </div>
          )}

          {tab === 'faltas' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`text-[11.5px] ${tone.muted}`}>
                  {activeFaults} {activeFaults === 1 ? 'falta activa' : 'faltas activas'} · descuentos y puntos del catálogo
                </p>
              </div>
              <FaultHistoryList
                faults={data.faults}
                tone={tone}
                isSelf={isSelf}
                canManage={canManage}
                onAppeal={setAppealFault}
                onAnnul={(fault) => { void annulFault(fault); }}
                onResolveAppeal={setResolveAppeal}
              />
            </div>
          )}

          {tab === 'datos' && detailsForm}
        </div>
      </div>

      {faultModalOpen && (
        <FaultFormDialog
          tone={tone}
          userName={profile.name}
          saving={saving}
          onClose={() => setFaultModalOpen(false)}
          onSubmit={submitFault}
        />
      )}

      {catalogOpen && (
        <CatalogDialog
          tone={tone}
          onClose={() => setCatalogOpen(false)}
          onChanged={() => { void load(true); }}
          onVaultError={(retry) => {
            handleVaultRetry(retry);
          }}
          reportError={reportError}
        />
      )}

      {appealFault && (
        <AppealDialog
          tone={tone}
          fault={appealFault}
          saving={saving}
          onClose={() => setAppealFault(null)}
          onSubmit={(message) => { void sendAppeal(appealFault, message); }}
        />
      )}

      {resolveAppeal && (
        <ResolveAppealDialog
          tone={tone}
          appeal={resolveAppeal}
          saving={saving}
          onClose={() => setResolveAppeal(null)}
          onResolve={(decision, note) => { void resolve(resolveAppeal, decision, note); }}
        />
      )}

      <VaultUnlockModal
        isOpen={vaultOpen}
        onClose={() => { setVaultOpen(false); retryRef.current = null; }}
        onSuccess={() => {
          setVaultOpen(false);
          const retry = retryRef.current;
          retryRef.current = null;
          retry?.();
        }}
        title="Desbloquear Bóveda de Seguridad (2FA)"
        description="El salario, las faltas y el catálogo de descuentos requieren autorización en dos pasos (2FA)."
      />
    </div>
  );
};

export const FaultFormDialog: React.FC<{
  tone: Tone;
  userName: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: { catalogId: number; faultDate: string; notes: string }) => Promise<boolean>;
}> = ({ tone, userName, saving, onClose, onSubmit }) => {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogId, setCatalogId] = useState<number | ''>('');
  const [faultDate, setFaultDate] = useState(() => isoDateInTimeZone());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const response = await apiFetch('/faults/catalog');
        const payload = await response.json().catch(() => []);
        if (!response.ok) throw new Error(payload.message || 'No se pudo cargar el catálogo.');
        setCatalog(Array.isArray(payload) ? payload.filter((item) => item.active) : []);
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo.');
      }
    };
    void loadCatalog();
  }, []);

  const selected = catalog.find((item) => item.id === catalogId);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!catalogId) { setError('Selecciona el tipo de falta.'); return; }
    if (!faultDate) { setError('Indica la fecha de la falta.'); return; }
    const ok = await onSubmit({ catalogId: Number(catalogId), faultDate, notes });
    if (!ok) setError('No se pudo registrar la falta. Revisa los datos o desbloquea la bóveda.');
  };

  return (
    <Dialog title="Registrar falta" subtitle={userName} onClose={onClose} tone={tone}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {catalogError && <p className={`rounded-xl px-3 py-2 text-[11.5px] ${tone.warningBox}`}>{catalogError}</p>}
        <label className="block text-[11px] font-bold">
          <span className={tone.muted}>Tipo de falta</span>
          <select
            value={catalogId}
            onChange={(event) => setCatalogId(event.target.value ? Number(event.target.value) : '')}
            className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
          >
            <option value="">Selecciona un tipo…</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.points} pts · {formatLempiras(item.amount)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-bold">
          <span className={tone.muted}>Fecha</span>
          <input
            type="date"
            value={faultDate}
            max={isoDateInTimeZone()}
            onChange={(event) => setFaultDate(event.target.value)}
            className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
          />
        </label>
        <label className="block text-[11px] font-bold">
          <span className={tone.muted}>Nota para el expediente</span>
          <textarea
            value={notes}
            maxLength={500}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Qué pasó, dónde y qué evidencia existe."
            className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
          />
        </label>
        {selected && (
          <p className={`rounded-xl px-3 py-2 text-[11.5px] ${tone.subtle}`}>
            Descuento: <strong>{selected.amount > 0 ? formatLempiras(selected.amount) : 'sin monto definido'}</strong> · <strong>{selected.points} pts</strong>
          </p>
        )}
        {error && <p className={`text-[11.5px] ${tone.warningText}`}>{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={`rounded-xl px-3.5 py-2 text-xs font-bold ${tone.secondary}`}>Cancelar</button>
          <button type="submit" disabled={saving} className={`rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 ${tone.primary}`}>
            {saving ? 'Registrando…' : 'Registrar falta'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export const CatalogDialog: React.FC<{
  tone: Tone;
  onClose: () => void;
  onChanged: () => void;
  onVaultError: (retry: () => void) => void;
  reportError: (err: unknown, retry?: () => void) => void;
}> = ({ tone, onClose, onChanged, onVaultError, reportError }) => {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, { name: string; points: string; amount: string; active: boolean }>>({});
  const [newItem, setNewItem] = useState({ name: '', points: '5', amount: '0' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const response = await apiFetch('/faults/catalog');
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error(payload.message || 'No se pudo cargar el catálogo.');
      const rows: CatalogItem[] = Array.isArray(payload) ? payload : [];
      setCatalog(rows);
      setDrafts(Object.fromEntries(rows.map((row) => [row.id, {
        name: row.name,
        points: String(row.points),
        amount: String(row.amount),
        active: row.active,
      }])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo.');
    }
  }, []);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const createItem = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newItem.name.trim().length < 3) { setError('El nombre debe tener al menos 3 caracteres.'); return; }
    const points = Number(newItem.points);
    const amount = Number(newItem.amount);
    if (!Number.isInteger(points) || points < 0) { setError('Los puntos deben ser un entero positivo.'); return; }
    if (!Number.isFinite(amount) || amount < 0) { setError('El monto debe ser mayor o igual a cero.'); return; }
    setBusy(true);
    try {
      const response = await apiFetch('/faults/catalog', {
        method: 'POST',
        body: JSON.stringify({ name: newItem.name.trim(), points, amount, active: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const wrapped = new Error(body.message || 'No se pudo crear el tipo de falta.');
        (wrapped as Error & { code?: string }).code = body.code;
        throw wrapped;
      }
      setNewItem({ name: '', points: '5', amount: '0' });
      await loadCatalog();
      onChanged();
    } catch (err) {
      reportError(err, () => { void createItem(event); });
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async (item: CatalogItem) => {
    const draft = drafts[item.id];
    if (!draft) return;
    setError(null);
    const points = Number(draft.points);
    const amount = Number(draft.amount);
    if (!Number.isInteger(points) || points < 0) { setError('Los puntos deben ser un entero positivo.'); return; }
    if (!Number.isFinite(amount) || amount < 0) { setError('El monto debe ser mayor o igual a cero.'); return; }
    setBusy(true);
    const submit = async () => {
      const response = await apiFetch(`/faults/catalog/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: draft.name.trim(),
          points,
          amount,
          active: draft.active,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const wrapped = new Error(body.message || 'No se pudo guardar el tipo de falta.');
        (wrapped as Error & { code?: string }).code = body.code;
        throw wrapped;
      }
    };
    try {
      await submit();
      await loadCatalog();
      onChanged();
    } catch (err) {
      if (isVaultError(err)) {
        onVaultError(() => { void saveItem(item); });
      } else {
        reportError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Catálogo de faltas"
      subtitle="Puntos y monto de descuento por tipo de incumplimiento"
      onClose={onClose}
      tone={tone}
    >
      <div className="space-y-4">
        {error && <p className={`rounded-xl px-3 py-2 text-[11.5px] ${tone.warningBox}`}>{error}</p>}
        <form onSubmit={createItem} className={`space-y-2 rounded-2xl p-3 ${tone.subtle}`}>
          <p className={`text-[11px] font-bold ${tone.heading}`}>Agregar tipo</p>
          <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
            <input
              value={newItem.name}
              onChange={(event) => setNewItem((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Nombre de la falta"
              className={`rounded-xl px-2.5 py-2 text-xs outline-none ${tone.input}`}
            />
            <input
              type="number"
              min="0"
              step="1"
              value={newItem.points}
              onChange={(event) => setNewItem((prev) => ({ ...prev, points: event.target.value }))}
              aria-label="Puntos"
              className={`rounded-xl px-2.5 py-2 text-xs tabular-nums outline-none ${tone.input}`}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={newItem.amount}
              onChange={(event) => setNewItem((prev) => ({ ...prev, amount: event.target.value }))}
              aria-label="Monto en lempiras"
              className={`rounded-xl px-2.5 py-2 text-xs tabular-nums outline-none ${tone.input}`}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className={`text-[10px] ${tone.muted}`}>Nombre · puntos · monto (L)</span>
            <button type="submit" disabled={busy} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-50 ${tone.primary}`}>
              Agregar
            </button>
          </div>
        </form>

        <div className="space-y-2">
          {catalog.map((item) => {
            const draft = drafts[item.id];
            if (!draft) return null;
            return (
              <div key={item.id} className={`rounded-2xl p-3 ${tone.card}`}>
                <div className="flex items-center justify-between gap-2">
                  <input
                    value={draft.name}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, name: event.target.value } }))}
                    aria-label={`Nombre de ${item.name}`}
                    className={`min-w-0 flex-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold outline-none ${tone.input}`}
                  />
                  <label className={`flex items-center gap-1 text-[10px] font-bold ${tone.muted}`}>
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, active: event.target.checked } }))}
                    />
                    Activo
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.points}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, points: event.target.value } }))}
                    aria-label={`Puntos de ${item.name}`}
                    className={`w-20 rounded-lg px-2 py-1.5 text-xs tabular-nums outline-none ${tone.input}`}
                  />
                  <span className={`text-[10px] ${tone.muted}`}>pts</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.amount}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, amount: event.target.value } }))}
                    aria-label={`Monto de ${item.name}`}
                    className={`w-28 rounded-lg px-2 py-1.5 text-xs tabular-nums outline-none ${tone.input}`}
                  />
                  <span className={`text-[10px] ${tone.muted}`}>L</span>
                  <button
                    type="button"
                    onClick={() => { void saveItem(item); }}
                    disabled={busy}
                    className={`ml-auto rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-50 ${tone.secondary}`}
                  >
                    Guardar
                  </button>
                </div>
              </div>
            );
          })}
          {catalog.length === 0 && (
            <p className={`rounded-xl px-3 py-2 text-[11.5px] ${tone.subtle}`}>Aún no hay tipos de falta en el catálogo.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export const AppealDialog: React.FC<{
  tone: Tone;
  fault: FaultItem;
  saving: boolean;
  onClose: () => void;
  onSubmit: (message: string) => void;
}> = ({ tone, fault, saving, onClose, onSubmit }) => {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Apelar falta" subtitle={`${fault.faultType} · ${formatFaultDate(fault.faultDate)}`} onClose={onClose} tone={tone}>
      <div className="space-y-3">
        <p className={`rounded-xl px-3 py-2 text-[11.5px] ${tone.subtle}`}>
          Explica por qué esta falta no corresponde. La administración verá tu mensaje y decidirá si anula el descuento.
        </p>
        <textarea
          value={message}
          rows={4}
          maxLength={500}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Describe lo que pasó con el mayor detalle posible."
          aria-label="Mensaje de apelación"
          className={`w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
        />
        {error && <p className={`text-[11.5px] ${tone.warningText}`}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`rounded-xl px-3.5 py-2 text-xs font-bold ${tone.secondary}`}>Cancelar</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (message.trim().length < 10) { setError('Explica tu apelación con al menos 10 caracteres.'); return; }
              setError(null);
              onSubmit(message.trim());
            }}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 ${tone.primary}`}
          >
            {saving ? 'Enviando…' : 'Enviar apelación'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export const ResolveAppealDialog: React.FC<{
  tone: Tone;
  appeal: FaultAppeal;
  saving: boolean;
  onClose: () => void;
  onResolve: (decision: 'aceptada' | 'rechazada', note: string) => void;
}> = ({ tone, appeal, saving, onClose, onResolve }) => {
  const [note, setNote] = useState('');
  return (
    <Dialog title="Resolver apelación" onClose={onClose} tone={tone}>
      <div className="space-y-3">
        <div className={`rounded-xl px-3 py-2 text-[11.5px] ${tone.subtle}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Mensaje del empleado</p>
          <p className="mt-1 whitespace-pre-line">{appeal.message}</p>
        </div>
        <label className="block text-[11px] font-bold">
          <span className={tone.muted}>Respuesta (opcional)</span>
          <textarea
            value={note}
            rows={3}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ej. Se verificó con fotos del patio y se anula el descuento."
            className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={`rounded-xl px-3.5 py-2 text-xs font-bold ${tone.secondary}`}>Cancelar</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onResolve('rechazada', note)}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 ${tone.secondary}`}
          >
            Rechazar apelación
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onResolve('aceptada', note)}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 ${tone.primary}`}
          >
            Aceptar y anular falta
          </button>
        </div>
      </div>
    </Dialog>
  );
};
