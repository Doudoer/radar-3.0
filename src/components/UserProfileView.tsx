import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiFetch } from '../services/apiFetch';
import { useFeedback } from './FeedbackProvider';
import { VaultUnlockModal } from './VaultUnlockModal';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import { formatUsd, isoDateInTimeZone, type WeekPayroll } from '../utils/payroll';
import { penaltyAmount, penaltyPercent } from '../utils/penalties';
import type { EmployeeCommissionsSummary, EmployeeSettlementSummary } from '../utils/commissions';
import type { WorkflowTask } from '../utils/orderWorkflow';
import { followupQueueUrl, followupSummary, groupFollowupTasks, parseFollowupQueue, type FollowupQueuePayload } from '../utils/followupQueue';
import { PRESET_AVATARS, DEFAULT_AVATAR } from '../utils/avatars';
import type { AuthUser } from '../hooks/useAuthSession';

interface ProfileInfo {
  id: number;
  name: string;
  email: string;
  phone: string;
  pbxExtension?: string;
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

export interface PenaltyAppealData {
  id: number;
  category: string;
  reason: string;
  evidenceUrls?: string[];
  status: 'pending' | 'approved' | 'rejected';
  resolutionNote?: string | null;
  reviewedBy?: number | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface PenaltySourceLine {
  id?: number;
  source: 'post_delivery' | 'ready_piece' | 'ack_notification' | 'claim' | 'call_missed' | 'call_rejected';
  units: number;
  percent: number;
  amount: number;
  orderId?: number;
  orderCode?: string;
  customerName?: string;
  date?: string | null;
  status?: string;
  appeal?: PenaltyAppealData | null;
}

export interface PenaltySnapshot {
  userId: number;
  weeklySalary: number | null;
  rate: number;
  enabled: boolean;
  period: { start: string; end: string; label: string; cutoffLabel: string };
  open: { units: number; percent: number; amount: number; lines: PenaltySourceLine[] };
  appealed?: { units: number; percent: number; amount: number; count: number };
  details: PenaltySourceLine[];
  history: Array<{ periodEnd: string; units: number; percent: number; amount: number; cutAt: string; status: string }>;
  commissions?: EmployeeCommissionsSummary;
  carryoverDebt?: { totalDebt: number; lastPeriodEnd: string | null };
  settlement?: EmployeeSettlementSummary;
}

export const PENALTY_APPEAL_CATEGORIES: Record<string, { label: string; icon: string }> = {
  technical_issue: { label: 'Falla técnica / conexión / corte', icon: 'wifi_off' },
  customer_hung_up: { label: 'Cliente cortó llamada', icon: 'phone_disabled' },
  customer_postponed: { label: 'Cliente pospuso / no disponible', icon: 'schedule' },
  wrong_number: { label: 'Número equivocado o inactivo', icon: 'error_outline' },
  authorized_absence: { label: 'Permiso laboral justificado', icon: 'event_busy' },
  other: { label: 'Otra causa justificada', icon: 'help_outline' },
};

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
  penalties?: PenaltySnapshot;
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
  onUserUpdated?: (updatedUser: Partial<AuthUser>) => void;
  onConfigureEmployee?: (userId: number) => void;
  variant?: 'office' | 'yard';
}

type Tab = 'resumen' | 'rendimiento' | 'faltas' | 'datos' | 'equipo';

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
  tabUnderline: string;
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
    tabUnderline: 'border-[var(--brand-solid)] text-[var(--text-heading)]',
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
    tabUnderline: 'border-[var(--yard-accent)] text-[var(--yard-ink)]',
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
  history?: WeekPayroll[];
  tone: Tone;
  hasSalary: boolean;
  canManage: boolean;
  penaltyAmount?: number;
  cutoffLabel?: string;
  settlement?: EmployeeSettlementSummary;
  commissions?: EmployeeCommissionsSummary;
  carryoverDebt?: { totalDebt: number; lastPeriodEnd: string | null };
}> = ({ week, tone, hasSalary, canManage, penaltyAmount = 0, cutoffLabel, settlement }) => {
  const penalty = Number((penaltyAmount || 0).toFixed(2));
  const projected = settlement ? settlement.netPayout : Number((week.net - penalty).toFixed(2));

  return (
    <>
      <section className={`rounded-3xl px-5 py-5 sm:px-6 sm:py-6 ${tone.card}`} aria-labelledby="profile-week-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="profile-week-heading" className={`font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${tone.muted}`}>Esta semana</p>
          {settlement?.baseSalaryProtected && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">verified</span>
              Sueldo base intocable
            </span>
          )}
        </div>
        <p className={`mt-2 text-[38px] font-black leading-none tabular-nums sm:text-[44px] ${
          !hasSalary && (!settlement || settlement.netPayout <= 0) ? tone.muted : projected < 0 ? tone.warningText : tone.heading
        }`}>
          {hasSalary || (settlement && settlement.netPayout > 0) ? formatUsd(projected) : 'Sin salario'}
        </p>
        <p className={`mt-2 text-xs ${tone.muted}`}>
          {week.label}{' · '}{cutoffLabel || 'Corte lunes a domingo · hora de Honduras'}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--border-subtle)] pt-4 sm:flex sm:flex-wrap sm:gap-x-10">
          <div>
            <dt className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Salario base</dt>
            <dd className={`mt-0.5 text-sm font-black tabular-nums ${tone.heading}`}>
              {formatUsd(settlement ? settlement.weeklySalary : week.gross)}
            </dd>
          </div>
          {settlement && settlement.earnedCommissions > 0 && (
            <div>
              <dt className={`text-[10px] font-bold uppercase tracking-wide text-emerald-500`}>Comisiones</dt>
              <dd className="mt-0.5 text-sm font-black tabular-nums text-emerald-400">+{formatUsd(settlement.earnedCommissions)}</dd>
            </div>
          )}
          {settlement && settlement.appliedDeduction > 0 && (
            <div>
              <dt className={`text-[10px] font-bold uppercase tracking-wide text-rose-500`}>Deducido de comisión</dt>
              <dd className="mt-0.5 text-sm font-black tabular-nums text-rose-400">−{formatUsd(settlement.appliedDeduction)}</dd>
            </div>
          )}
          <div>
            <dt className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Faltas</dt>
            <dd className={`mt-0.5 text-sm font-black tabular-nums ${week.deductions > 0 ? tone.warningText : tone.heading}`}>
              {week.deductions > 0 ? `−${formatUsd(week.deductions)}` : formatUsd(0)}
            </dd>
          </div>
          {!settlement && penalty > 0 && (
            <div>
              <dt className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Amonestaciones</dt>
              <dd className={`mt-0.5 text-sm font-black tabular-nums ${tone.warningText}`}>−{formatUsd(penalty)}</dd>
            </div>
          )}
          <div>
            <dt className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Puntos</dt>
            <dd className={`mt-0.5 text-sm font-black tabular-nums ${week.points > 0 ? tone.warningText : tone.heading}`}>
              {week.points} pts
            </dd>
          </div>
        </dl>
        {!hasSalary && (
          <p className={`mt-4 rounded-xl px-3 py-2 text-[11.5px] ${tone.warningBox}`}>
            {canManage
              ? 'Este usuario aún no tiene salario semanal configurado. Puedes definirlo en la pestaña «Datos».'
              : 'La administración aún no ha configurado tu salario semanal.'}
          </p>
        )}
      </section>
    </>
  );
};

export const CommissionsCard: React.FC<{
  commissions?: EmployeeCommissionsSummary;
  settlement?: EmployeeSettlementSummary;
  tone: Tone;
}> = ({ commissions, settlement, tone }) => {
  if (!commissions) return null;

  return (
    <section className={`rounded-3xl px-5 py-5 sm:px-6 ${tone.card}`} aria-labelledby="profile-commissions-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-emerald-400">payments</span>
            <h2 id="profile-commissions-heading" className={`font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${tone.muted}`}>
              Comisiones por Desempeño
            </h2>
          </div>
          <p className={`mt-1 text-xs ${tone.muted}`}>
            $5 USD por venta con anticipo (retención de 12h en yarda) · $2 USD por orden cerrada vendida y entregada esta misma semana.
          </p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-black leading-none tabular-nums text-emerald-400`}>
            {formatUsd(commissions.earnedAmount)}
          </p>
          <p className={`mt-1 text-[11px] font-bold tabular-nums ${tone.muted}`}>
            {commissions.earnedCount} comisiones liberadas
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] p-3">
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Liberadas esta semana</p>
          <p className="mt-1 text-lg font-black text-emerald-400">{formatUsd(commissions.earnedAmount)}</p>
          <p className="text-[10px] text-[var(--text-secondary)]">{commissions.earnedCount} ventas / entregas</p>
        </div>
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3">
          <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">En verificación yarda (12h)</p>
          <p className="mt-1 text-lg font-black text-cyan-300">{formatUsd(commissions.pendingYardAmount)}</p>
          <p className="text-[10px] text-cyan-400/80">{commissions.pendingYardCount} órdenes en retención</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] p-3">
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Anuladas (yarda / reembolsos)</p>
          <p className="mt-1 text-lg font-black text-[var(--text-muted)]">{formatUsd(commissions.voidedAmount)}</p>
          <p className="text-[10px] text-[var(--text-secondary)]">{commissions.voidedCount} órdenes anuladas</p>
        </div>
      </div>

      {commissions.items.length > 0 && (
        <details className="group mt-4 border-t border-[var(--border-subtle)] pt-3">
          <summary className={`flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] font-bold [&::-webkit-details-marker]:hidden ${tone.heading}`}>
            <span aria-hidden="true" className="material-symbols-outlined text-[15px] transition-transform group-open:rotate-180">expand_more</span>
            Detalle de órdenes y comisiones ({commissions.items.length})
          </summary>
          <div className="mt-3 divide-y divide-[var(--border-subtle)]">
            {commissions.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="text-[var(--text-primary)]">#{item.orderCode}</strong>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      item.status === 'earned'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : item.status === 'pending_yard_check'
                          ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                          : item.status === 'voided_refund'
                            ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    }`}>
                      {item.status === 'earned'
                        ? 'Acreditada'
                        : item.status === 'pending_yard_check'
                          ? `En verificación (${Math.floor((item.minutesRemaining || 0) / 60)}h ${(item.minutesRemaining || 0) % 60}m restantes)`
                          : item.status === 'voided_refund'
                            ? 'Anulada por Reembolso'
                            : 'Anulada por Yarda'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {item.type === 'downpayment_sale' ? 'Venta con downpayment ($5)' : 'Orden entregada y cerrada ($2)'}
                    {item.customerName ? ` · ${item.customerName}` : ''}
                    {item.vehicle ? ` · ${item.vehicle}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-black ${
                    item.status === 'earned'
                      ? 'text-emerald-400'
                      : item.status === 'pending_yard_check'
                        ? 'text-cyan-400'
                        : 'text-neutral-500 line-through'
                  }`}>
                    {item.status === 'voided_refund' ? `-${formatUsd(item.amount)}` : `+${formatUsd(item.amount)}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
};

const PENALTY_SOURCE_LABELS: Record<PenaltySourceLine['source'], { label: string; icon: string }> = {
  post_delivery: { label: 'Post-entrega', icon: 'home_repair_service' },
  claim: { label: 'Reclamos', icon: 'assignment_late' },
  ready_piece: { label: 'Piezas listas', icon: 'inventory_2' },
  ack_notification: { label: 'Notificación al cliente', icon: 'mark_chat_unread' },
  call_missed: { label: 'Llamada no contestada en horario', icon: 'phone_missed' },
  call_rejected: { label: 'Llamada colgada / rechazada', icon: 'phone_disabled' },
};

const formatPercent = (value: number) => `${Number(value || 0).toFixed(2)}%`;

const shortDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) : '—';

export const PenaltyCard: React.FC<{
  penalties: PenaltySnapshot;
  tone: Tone;
  canManage?: boolean;
  isSelf?: boolean;
  onAppealPenalty?: (penalty: PenaltySourceLine) => void;
  onResolvePenaltyAppeal?: (penalty: PenaltySourceLine) => void;
  onOpenAppealsBatch?: () => void;
}> = ({
  penalties,
  tone,
  canManage = false,
  isSelf = false,
  onAppealPenalty,
  onResolvePenaltyAppeal,
  onOpenAppealsBatch,
}) => {
  const sourceRows = (['post_delivery', 'claim', 'ready_piece', 'ack_notification', 'call_missed', 'call_rejected'] as const).map(source => {
    const lines = penalties.open.lines.filter(line => line.source === source);
    return {
      source,
      units: lines.reduce((total, line) => total + line.units, 0),
      percent: lines.reduce((total, line) => total + line.percent, 0),
      amount: lines.reduce((total, line) => total + line.amount, 0),
    };
  });

  return (
    <section className={`rounded-3xl px-5 py-5 sm:px-6 ${tone.card}`} aria-labelledby="profile-penalties-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="profile-penalties-heading" className={`font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${tone.muted}`}>Amonestaciones</h2>
            {canManage && onOpenAppealsBatch && (
              <button
                type="button"
                onClick={onOpenAppealsBatch}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-400/30 hover:bg-sky-500/25 transition cursor-pointer"
                title="Bandeja de apelaciones de amonestaciones"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[11px]">balance</span>
                <span>Apelaciones</span>
              </button>
            )}
          </div>
          <p className={`mt-1 text-xs ${tone.muted}`}>{penalties.period.cutoffLabel}</p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-black leading-none tabular-nums ${penalties.open.amount > 0 ? tone.warningText : tone.heading}`}>
            {formatPercent(penalties.open.percent)}
          </p>
          <p className={`mt-1 text-[11px] font-bold tabular-nums ${penalties.open.amount > 0 ? tone.warningText : tone.muted}`}>
            {formatUsd(penalties.open.amount)}
          </p>
        </div>
      </div>

      {penalties.appealed && penalties.appealed.count > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5 text-xs text-sky-200">
          <div className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true" className="material-symbols-outlined text-sky-400 text-[18px] shrink-0">balance</span>
            <span className="truncate">
              <strong>{penalties.appealed.count} cargo(s) en pausa cautelar</strong> ({formatUsd(penalties.appealed.amount)}). No se descontarán mientras estén bajo evaluación.
            </span>
          </div>
          {canManage && onOpenAppealsBatch && (
            <button
              type="button"
              onClick={onOpenAppealsBatch}
              className="shrink-0 px-2.5 py-1 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-400/40 text-[11px] font-bold transition cursor-pointer"
            >
              Revisar apelaciones
            </button>
          )}
        </div>
      )}

      {!penalties.enabled && (
        <p className={`mt-3 rounded-xl px-3 py-2 text-[11.5px] ${tone.warningBox}`}>
          Las amonestaciones automáticas están deshabilitadas. Los contadores quedan en pausa y no se generan cargos nuevos; lo ya acumulado se conserva.
        </p>
      )}

      <ul className="mt-4 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
        {sourceRows.map(row => {
          const meta = PENALTY_SOURCE_LABELS[row.source];
          return (
            <li key={row.source} className="flex items-center justify-between gap-3 py-2.5">
              <span className={`flex items-center gap-2 text-xs font-semibold ${tone.heading}`}>
                <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${tone.muted}`}>{meta.icon}</span>
                {meta.label}
              </span>
              <span className="shrink-0 text-right">
                <span className={`block text-xs font-black tabular-nums ${row.amount > 0 ? tone.warningText : tone.heading}`}>
                  {row.units > 0 ? `${row.units} u · ${formatPercent(row.percent)}` : 'Sin cargos'}
                </span>
                <span className={`block text-[10.5px] tabular-nums ${tone.muted}`}>{formatUsd(row.amount)}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className={`mt-3 text-[10.5px] ${tone.muted}`}>
        Salario base {penalties.weeklySalary === null ? 'sin configurar' : formatUsd(penalties.weeklySalary)}
        {' · '}tarifa fija {formatPercent(penalties.rate)} por unidad
        {penalties.weeklySalary !== null ? ` · 1 u = ${formatUsd(penaltyAmount(penalties.weeklySalary, penalties.rate))}` : ''}
      </p>

      <details className="group mt-3 border-t border-[var(--border-subtle)] pt-3">
        <summary className={`flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] font-bold [&::-webkit-details-marker]:hidden ${tone.heading}`}>
          <span aria-hidden="true" className="material-symbols-outlined text-[15px] transition-transform group-open:rotate-180">expand_more</span>
          Cómo se calcula
        </summary>
        <p className={`mt-1.5 text-[10.5px] ${tone.muted}`}>
          El porcentaje es el mismo para todo el equipo: {formatPercent(penalties.rate)} por unidad, calculado sobre el salario semanal de cada colaborador.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10.5px] sm:grid-cols-4">
          {[1, 2, 3, 5].map(units => {
            const percent = penaltyPercent(units, penalties.rate);
            return (
              <span key={units} className={tone.muted}>
                {units} u → <strong className={tone.heading}>{formatPercent(percent)}</strong>
                {penalties.weeklySalary !== null ? ` · ${formatUsd(penaltyAmount(penalties.weeklySalary, percent))}` : ''}
              </span>
            );
          })}
        </div>
      </details>

      {penalties.details.length > 0 && (
        <details className="group mt-2 border-t border-[var(--border-subtle)] pt-3" open={penalties.appealed && penalties.appealed.count > 0}>
          <summary className={`flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] font-bold [&::-webkit-details-marker]:hidden ${tone.heading}`}>
            <span aria-hidden="true" className="material-symbols-outlined text-[15px] transition-transform group-open:rotate-180">expand_more</span>
            Cargos del período ({penalties.details.length})
          </summary>
          <div className="mt-2 divide-y divide-[var(--border-subtle)] space-y-0">
            {penalties.details.map((line, index) => {
              const isAppealed = line.status === 'appealed' || line.appeal?.status === 'pending';
              const isRejected = line.appeal?.status === 'rejected';
              return (
                <div key={`${line.orderId || 0}-${line.source}-${line.id || index}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`truncate font-semibold ${tone.heading}`}>
                        {PENALTY_SOURCE_LABELS[line.source].label} · {line.orderCode || 'Llamada PBX'}
                      </p>
                      {isAppealed && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-400/30">
                          <span aria-hidden="true" className="material-symbols-outlined text-[11px]">balance</span>
                          En revisión (pausada)
                        </span>
                      )}
                      {isRejected && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-400/30" title={line.appeal?.resolutionNote || 'Apelación rechazada'}>
                          <span aria-hidden="true" className="material-symbols-outlined text-[11px]">cancel</span>
                          Apelación rechazada
                        </span>
                      )}
                    </div>
                    <p className={`truncate text-[10.5px] ${tone.muted}`}>
                      {line.customerName || 'Cliente'} · {shortDate(line.date)} · {line.units} × {formatPercent(penalties.rate)}
                    </p>
                    {line.appeal && (
                      <p className="mt-0.5 text-[10px] text-sky-300/80 italic">
                        Motivo: {PENALTY_APPEAL_CATEGORIES[line.appeal.category]?.label || line.appeal.category} — &ldquo;{line.appeal.reason}&rdquo;
                        {line.appeal.resolutionNote ? ` (Nota administración: ${line.appeal.resolutionNote})` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className={`font-bold tabular-nums ${isAppealed ? 'text-sky-300 line-through opacity-75' : tone.warningText}`}>
                      {formatPercent(line.percent)} · {formatUsd(line.amount)}
                    </p>
                    {/* Botón Apelar si no está en pausa cautelar ni exonerada */}
                    {line.status === 'pending' && !isAppealed && onAppealPenalty && (
                      <button
                        type="button"
                        onClick={() => onAppealPenalty(line)}
                        className="px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-400/30 text-[10px] font-bold transition cursor-pointer"
                        title="Apelar este cargo si ocurrió por causas ajenas o fuerza mayor"
                      >
                        Apelar
                      </button>
                    )}
                    {/* Botón Resolver para administradores */}
                    {canManage && isAppealed && onResolvePenaltyAppeal && (
                      <button
                        type="button"
                        onClick={() => onResolvePenaltyAppeal(line)}
                        className="px-2 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-400/40 text-[10px] font-bold transition cursor-pointer"
                        title="Evaluar y resolver apelación"
                      >
                        Resolver
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {penalties.history.length > 0 && (
        <details className="group mt-2 border-t border-[var(--border-subtle)] pt-3">
          <summary className={`flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] font-bold [&::-webkit-details-marker]:hidden ${tone.heading}`}>
            <span aria-hidden="true" className="material-symbols-outlined text-[15px] transition-transform group-open:rotate-180">expand_more</span>
            Cortes de sábado ({penalties.history.length})
          </summary>
          <div className="mt-1 divide-y divide-[var(--border-subtle)]">
            {penalties.history.map(entry => (
              <div key={`${entry.periodEnd}-${entry.status}`} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className={`text-[11.5px] font-semibold ${tone.heading}`}>Corte del {shortDate(entry.periodEnd)}</p>
                  <p className={`text-[10.5px] ${tone.muted}`}>
                    {entry.units} unidades · {formatPercent(entry.percent)} · {entry.status === 'liquidated' ? 'descontado' : 'por descontar'}
                  </p>
                </div>
                <p className={`text-xs font-black tabular-nums ${tone.warningText}`}>{formatUsd(entry.amount)}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
};

interface TeamMember {
  id: number;
  name: string;
  role: string;
  active: number | boolean;
  weekly_salary: number | null;
}

interface TeamDraft {
  salary: string;
}

const toTeamDraft = (member: TeamMember): TeamDraft => ({
  salary: member.weekly_salary === null ? '' : String(member.weekly_salary),
});

const putJson = async (url: string, payload: unknown) => {
  const response = await apiFetch(url, { method: 'PUT', body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((body as { message?: string }).message || 'No se pudo guardar.');
    (error as Error & { code?: string }).code = (body as { code?: string }).code;
    throw error;
  }
  return body;
};

export const TeamCompensationPanel: React.FC<{
  tone: Tone;
  onOpenProfile?: (userId: number) => void;
  onVaultError: (retry: () => void) => void;
}> = ({ tone, onOpenProfile, onVaultError }) => {
  const { toast } = useFeedback();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [drafts, setDrafts] = useState<Record<number, TeamDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/users');
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error((payload as { message?: string }).message || 'No se pudo cargar el equipo.');
      const active = (Array.isArray(payload) ? payload as TeamMember[] : [])
        .filter((member) => Boolean(member.active))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setMembers(active);
      setDrafts(Object.fromEntries(active.map((member) => [member.id, toTeamDraft(member)])) as Record<number, TeamDraft>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el equipo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateDraft = (id: number, patch: Partial<TeamDraft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const saveMemberRef = useRef<(member: TeamMember) => Promise<void>>(async () => {});

  const saveMember = useCallback(async (member: TeamMember) => {
    const draft = drafts[member.id];
    if (!draft) return;
    const salary = draft.salary.trim() ? Number(draft.salary) : null;
    if (salary !== null && (!Number.isFinite(salary) || salary < 0)) {
      toast({ title: 'Salario inválido', message: 'Escribe un monto mayor o igual a cero.', tone: 'error' });
      return;
    }
    if ((member.weekly_salary ?? null) === salary) {
      toast({ title: 'Sin cambios', message: `${member.name} ya tiene ese salario.`, tone: 'info' });
      return;
    }
    const submit = async () => {
      await putJson(`/users/${member.id}/profile`, { weekly_salary: salary });
    };
    setBusyId(member.id);
    try {
      await submit();
      toast({
        title: `${member.name} actualizado`,
        message: 'Salario semanal guardado. Aplica desde el siguiente corte.',
        tone: 'success',
      });
      await load();
    } catch (err) {
      if (isVaultError(err)) {
        onVaultError(() => { void saveMemberRef.current(member); });
      } else {
        toast({
          title: 'No se pudo guardar',
          message: err instanceof Error ? err.message : undefined,
          tone: 'error',
        });
      }
    } finally {
      setBusyId(null);
    }
  }, [drafts, load, onVaultError, toast]);

  useEffect(() => { saveMemberRef.current = saveMember; }, [saveMember]);

  return (
    <div className="space-y-3">
      <div className={`rounded-3xl p-4 sm:p-5 ${tone.card}`}>
        <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${tone.muted}`}>Equipo · compensación individual</p>
        <p className={`mt-1 text-sm font-bold ${tone.heading}`}>Salario semanal por colaborador</p>
        <p className={`mt-0.5 text-[11px] ${tone.muted}`}>
          El descuento aplica un 0.8333% por unidad sobre el salario de cada quien. Edita el monto y guarda;
          los cambios quedan auditados y aplican desde el siguiente corte de sábado.
        </p>
      </div>

      {loading ? (
        <div className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-8 text-[11.5px] ${tone.card} ${tone.muted}`}>
          <span className={`material-symbols-outlined animate-spin text-[18px] ${tone.muted}`}>sync</span>
          Cargando colaboradores…
        </div>
      ) : error ? (
        <div className={`rounded-2xl px-4 py-6 text-center ${tone.card}`}>
          <p className={`text-[11.5px] ${tone.muted}`}>{error}</p>
          <button type="button" onClick={() => { void load(); }} className={`mt-3 rounded-xl px-4 py-2 text-xs font-bold ${tone.primary}`}>
            Reintentar
          </button>
        </div>
      ) : members.length === 0 ? (
        <div className={`rounded-2xl px-4 py-6 text-center text-[11.5px] ${tone.card} ${tone.muted}`}>
          No hay colaboradores activos.
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const draft = drafts[member.id] || toTeamDraft(member);
            return (
              <div key={member.id} className={`rounded-2xl p-3 ${tone.card}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`truncate text-[12.5px] font-bold ${tone.heading}`}>{member.name}</p>
                    <p className={`text-[10.5px] ${tone.muted}`}>
                      {ROLE_LABELS[member.role] || member.role}
                    </p>
                  </div>
                  {onOpenProfile && (
                    <button
                      type="button"
                      onClick={() => onOpenProfile(member.id)}
                      className={`rounded-xl px-3 py-1.5 text-[11px] font-bold ${tone.secondary}`}
                    >
                      Abrir perfil
                    </button>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="block text-[10.5px] font-bold">
                    <span className={tone.muted}>Salario semanal (USD)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={draft.salary}
                      onChange={(event) => updateDraft(member.id, { salary: event.target.value })}
                      placeholder="0.00"
                      className={`mt-1 w-full rounded-xl px-2.5 py-2 text-xs tabular-nums outline-none ${tone.input}`}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled={busyId === member.id}
                      onClick={() => { void saveMember(member); }}
                      className={`w-full rounded-xl px-3 py-2 text-[11.5px] font-bold disabled:opacity-50 sm:w-auto ${tone.primary}`}
                    >
                      {busyId === member.id ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface PerformanceMetrics {
  userId: number;
  name: string;
  role: string;
  salesCount: number;
  salesAmount: number;
  closures: number;
  resolutions: number;
}

interface PerformancePayload {
  period: { start: string; end: string; label: string };
  me: PerformanceMetrics & { rank: number; totalEmployees: number };
  team: { totalEmployees: number; averageSalesAmount: number; averageSalesCount: number; averageClosures: number; averageResolutions: number };
  series: Array<{ date: string; label: string; amount: number; count: number }>;
  ranking: Array<PerformanceMetrics & { isMe: boolean }>;
}

export const PerformancePanel: React.FC<{ targetUserId: number; tone: Tone }> = ({ targetUserId, tone }) => {
  const [data, setData] = useState<PerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/performance/weekly?userId=${targetUserId}`)
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'No se pudo cargar el rendimiento.');
        if (!cancelled) setData(payload as PerformancePayload);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el rendimiento.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [targetUserId]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-8 text-[11.5px] ${tone.card} ${tone.muted}`}>
        <span className={`material-symbols-outlined animate-spin text-[18px] ${tone.muted}`}>sync</span>
        Cargando rendimiento…
      </div>
    );
  }
  if (error || !data) {
    return <div className={`rounded-2xl px-4 py-6 text-[11.5px] ${tone.card} ${tone.muted}`}>{error || 'Sin datos de rendimiento.'}</div>;
  }
  const maximum = Math.max(...data.series.map(day => day.amount), 1);

  return (
    <div className="space-y-3">
      <div className={`rounded-3xl p-4 sm:p-5 ${tone.card}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${tone.muted}`}>Rendimiento semanal</p>
            <p className={`mt-1 text-sm font-bold ${tone.heading}`}>{data.period.label}</p>
          </div>
          <p className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.chip}`}>
            Puesto #{data.me.rank} de {data.me.totalEmployees}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className={`rounded-2xl px-3 py-2.5 ${tone.subtle}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Ventas</p>
            <p className={`mt-1 text-sm font-black tabular-nums ${tone.heading}`}>{formatUsd(data.me.salesAmount)}</p>
            <p className={`text-[10.5px] ${tone.muted}`}>{data.me.salesCount} {data.me.salesCount === 1 ? 'orden' : 'órdenes'}</p>
          </div>
          <div className={`rounded-2xl px-3 py-2.5 ${tone.subtle}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Cierres</p>
            <p className={`mt-1 text-sm font-black tabular-nums ${tone.heading}`}>{data.me.closures}</p>
            <p className={`text-[10.5px] ${tone.muted}`}>Promedio {data.team.averageClosures}</p>
          </div>
          <div className={`rounded-2xl px-3 py-2.5 ${tone.subtle}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Resoluciones</p>
            <p className={`mt-1 text-sm font-black tabular-nums ${tone.heading}`}>{data.me.resolutions}</p>
            <p className={`text-[10.5px] ${tone.muted}`}>Promedio {data.team.averageResolutions}</p>
          </div>
          <div className={`rounded-2xl px-3 py-2.5 ${tone.subtle}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Promedio equipo</p>
            <p className={`mt-1 text-sm font-black tabular-nums ${tone.heading}`}>{formatUsd(data.team.averageSalesAmount)}</p>
            <p className={`text-[10.5px] ${tone.muted}`}>{data.team.totalEmployees} colaboradores</p>
          </div>
        </div>
      </div>

      <div className={`rounded-3xl p-4 sm:p-5 ${tone.card}`}>
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className={`text-sm font-bold ${tone.heading}`}>Ventas por día</p>
            <p className={`text-[11px] ${tone.muted}`}>Sábado 6:00 p. m. a sábado 6:00 p. m.</p>
          </div>
          <p className={`text-[11px] font-bold tabular-nums ${tone.muted}`}>Máx. {formatUsd(maximum)}</p>
        </div>
        <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label={`Ventas diarias de ${data.me.name}: ${data.series.map(day => `${day.label} ${formatUsd(day.amount)}`).join(', ')}`}>
          {data.series.map(day => {
            const height = day.amount > 0 ? Math.max(4, Math.round(day.amount / maximum * 100)) : 0;
            return (
              <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className={`text-[9px] font-bold tabular-nums ${day.amount > 0 ? tone.heading : tone.muted}`}>
                  {day.amount > 0 ? Math.round(day.amount) : ''}
                </span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t-md ${day.amount > 0 ? 'bg-[var(--brand-solid)]' : 'bg-[var(--border-subtle)]'}`}
                    style={{ height: `${day.amount > 0 ? height : 2}%` }}
                  />
                </div>
                <span className={`text-[10px] font-bold ${tone.muted}`}>{day.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`overflow-hidden rounded-3xl ${tone.card}`}>
        <div className={`border-b px-4 py-3 ${tone.subtle}`}>
          <p className={`text-sm font-bold ${tone.heading}`}>Ranking de la semana</p>
          <p className={`text-[11px] ${tone.muted}`}>Ventas, cierres y resoluciones por colaborador. Solo agregados.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[430px] text-[11.5px]">
            <thead>
              <tr className={`text-left ${tone.muted}`}>
                <th className="px-3 py-2 font-bold">#</th>
                <th className="px-3 py-2 font-bold">Colaborador</th>
                <th className="px-3 py-2 text-right font-bold">Ventas</th>
                <th className="px-3 py-2 text-right font-bold">Cierres</th>
                <th className="px-3 py-2 text-right font-bold">Resol.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {data.ranking.map((entry, index) => (
                <tr key={entry.userId} className={entry.isMe ? 'bg-[var(--bg-surface)] font-bold' : ''}>
                  <td className={`px-3 py-2 tabular-nums ${tone.muted}`}>{index + 1}</td>
                  <td className={`px-3 py-2 ${tone.heading}`}>
                    {entry.name}{entry.isMe ? ' · Tú' : ''}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${tone.heading}`}>
                    {formatUsd(entry.salesAmount)}
                    <span className={`block text-[10px] font-normal ${tone.muted}`}>{entry.salesCount} órdenes</span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${tone.muted}`}>{entry.closures}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${tone.muted}`}>{entry.resolutions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

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
              {fault.amount > 0 ? `−${formatUsd(fault.amount)}` : 'Sin monto'}
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
        <p className={`text-sm font-bold ${tone.heading}`}>{summary.total} {summary.total === 1 ? 'pendiente' : 'pendientes'}</p>
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
  onUserUpdated,
  onConfigureEmployee,
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
  const [appealPenalty, setAppealPenalty] = useState<PenaltySourceLine | null>(null);
  const [resolvePenaltyAppeal, setResolvePenaltyAppeal] = useState<PenaltySourceLine | null>(null);
  const [batchAppealsOpen, setBatchAppealsOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const submitFaultRef = useRef<((input: { catalogId: number; faultDate: string; notes: string }) => Promise<boolean>) | null>(null);

  const [draft, setDraft] = useState({
    address: '', emergencyContactName: '', emergencyContactPhone: '', salary: '', hiredOn: '',
  });
  const [accountName, setAccountName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPhone, setAccountPhone] = useState('');
  const [accountAvatarUrl, setAccountAvatarUrl] = useState('');
  const [showCustomAvatarUrl, setShowCustomAvatarUrl] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);

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
      setAccountName(profile.name || '');
      setAccountEmail(profile.email || '');
      setAccountPhone(profile.phone || '');
      setAccountAvatarUrl(profile.avatarUrl || DEFAULT_AVATAR);
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

  useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

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

  const handleAvatarUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setAccountError('Usa una imagen PNG, JPEG, WebP o GIF.');
      return;
    }
    if (file.size > 350 * 1024) {
      setAccountError('La imagen de perfil no debe superar los 350KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAccountAvatarUrl(reader.result);
        setAccountError(null);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const saveAccountSettings = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    setAccountError(null);
    setAccountSuccess(null);

    if (!accountName.trim()) {
      setAccountError('El nombre completo es obligatorio.');
      return;
    }
    if (!accountEmail.trim() || !accountEmail.includes('@')) {
      setAccountError('Por favor ingresa un correo electrónico válido.');
      return;
    }

    const identityChanged = accountEmail.trim().toLowerCase() !== (profile.email || '').toLowerCase()
      || (viewerRole.toLowerCase() === 'admin' && accountPhone.trim() !== (profile.phone || ''));
    if (identityChanged && !currentPassword) {
      setAccountError('Confirma tu contraseña actual en Seguridad. Para cambiar el teléfono administrativo, desbloquea primero la bóveda.');
      return;
    }

    if (newPassword) {
      if (!currentPassword) {
        setAccountError('Debes ingresar tu contraseña actual para cambiarla.');
        return;
      }
      if (newPassword.length < 8) {
        setAccountError('La nueva contraseña debe tener al menos 8 caracteres.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setAccountError('La nueva contraseña y su confirmación no coinciden.');
        return;
      }
    }

    setSavingAccount(true);
    try {
      const payload: Record<string, unknown> = {
        name: accountName.trim(),
        email: accountEmail.trim().toLowerCase(),
        phone: accountPhone.trim() || null,
        avatar_url: accountAvatarUrl.trim() || null,
      };
      if (currentPassword) payload.currentPassword = currentPassword;
      if (newPassword) payload.newPassword = newPassword;

      const response = await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message || 'Error al actualizar el perfil.');
      }

      onUserUpdated?.({
        name: body.user.name,
        email: body.user.email,
        phone: body.user.phone,
        avatar_url: body.user.avatar_url,
      });
      setAccountSuccess('¡Cuenta y seguridad actualizadas con éxito!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Cuenta actualizada', message: 'Tu perfil y seguridad se guardaron correctamente.', tone: 'success' });
      await load(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error de conexión.';
      setAccountError(message);
      toast({ title: 'No se pudo actualizar la cuenta', message, tone: 'error' });
    } finally {
      setSavingAccount(false);
    }
  }, [accountAvatarUrl, accountEmail, accountName, accountPhone, confirmPassword, currentPassword, load, newPassword, onUserUpdated, profile, toast, viewerRole]);

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
      message: `Se devolverá ${formatUsd(fault.amount)} y ${fault.points} pts a la liquidación.`,
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

  const sendPenaltyAppeal = useCallback(async (penalty: PenaltySourceLine, category: string, reason: string, evidenceUrls?: string[]) => {
    if (!penalty.id) return;
    setSaving(true);
    try {
      const response = await apiFetch(`/penalties/${penalty.id}/appeal`, {
        method: 'POST',
        body: JSON.stringify({ category, reason, evidenceUrls }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo enviar la apelación del cargo.');
      setAppealPenalty(null);
      toast({
        title: 'Apelación enviada',
        message: 'El cargo entra en pausa cautelar y no se descontará mientras la administración lo evalúa.',
        tone: 'success',
      });
      await load(true);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }, [load, reportError, toast]);

  const resolvePenaltyAppealHandler = useCallback(async (penalty: PenaltySourceLine, decision: 'approved' | 'rejected', note?: string) => {
    if (!penalty.appeal?.id) return;
    setSaving(true);
    try {
      const response = await apiFetch(`/penalties/appeals/${penalty.appeal.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo resolver la apelación.');
      setResolvePenaltyAppeal(null);
      toast({
        title: decision === 'approved' ? 'Cargo exonerado' : 'Apelación rechazada',
        message: decision === 'approved' ? 'La amonestación fue cancelada ($0.00).' : 'El cargo continúa activo.',
        tone: 'success',
      });
      await load(true);
    } catch (err) {
      reportError(err);
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
    <div className="space-y-4">
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
                <span className={tone.muted}>Salario semanal (USD)</span>
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
        <div className={`grid gap-2 rounded-2xl px-3 py-2.5 text-[11.5px] sm:grid-cols-4 ${tone.subtle}`}>
          <span><span className={tone.muted}>Correo: </span>{profile.email || '—'}</span>
          <span><span className={tone.muted}>Teléfono: </span>{profile.phone || '—'}</span>
          <span><span className={tone.muted}>Extensión PBX: </span>{profile.pbxExtension || '—'}</span>
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

      {isSelf && (
        <form onSubmit={(event) => { void saveAccountSettings(event); }} className={`space-y-4 rounded-3xl p-4 sm:p-5 ${tone.card}`}>
          <div>
            <p className={`text-sm font-bold ${tone.heading}`}>Cuenta, avatar y seguridad</p>
            <p className={`text-[11.5px] ${tone.muted}`}>
              Edita tu foto de perfil, datos de acceso y contraseña directamente desde aquí.
            </p>
          </div>

          {accountError && (
            <div className={`rounded-xl px-3 py-2 text-xs flex items-center gap-2 ${tone.warningBox}`}>
              <span aria-hidden="true" className="material-symbols-outlined text-[17px] shrink-0">error</span>
              <span>{accountError}</span>
            </div>
          )}

          {accountSuccess && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[17px] shrink-0">check_circle</span>
              <span>{accountSuccess}</span>
            </div>
          )}

          <div className={`rounded-2xl p-3.5 space-y-3 ${tone.subtle}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-bold flex items-center gap-1.5 ${tone.heading}`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">face</span>
                Avatar de Perfil
              </span>
              <label className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer ${tone.secondary}`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">upload</span>
                <span>Subir Foto</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="relative shrink-0">
                <div className={`h-16 w-16 overflow-hidden rounded-2xl border-2 border-[var(--brand-solid)] ${tone.card}`}>
                  <img
                    src={accountAvatarUrl || DEFAULT_AVATAR}
                    alt="Avatar Actual"
                    className="h-full w-full object-cover"
                    onError={(event) => {
                      (event.target as HTMLImageElement).src = DEFAULT_AVATAR;
                    }}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <span className={`mb-1.5 block text-[10px] font-mono font-bold uppercase tracking-wider ${tone.muted}`}>
                  Elegir Avatar Rápido
                </span>
                <div className="flex flex-wrap gap-2">
                  {PRESET_AVATARS.map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => setAccountAvatarUrl(av.url)}
                      title={av.label}
                      className={`h-8 w-8 overflow-hidden rounded-xl border transition-all cursor-pointer ${
                        accountAvatarUrl === av.url
                          ? 'border-[var(--brand-solid)] scale-110 ring-2 ring-[var(--brand-solid)]/30'
                          : 'border-[var(--border-subtle)] opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img src={av.url} alt={av.label} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowCustomAvatarUrl((prev) => !prev)}
                className={`inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer ${tone.muted} hover:underline`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                  {showCustomAvatarUrl ? 'expand_less' : 'add_link'}
                </span>
                <span>{showCustomAvatarUrl ? 'Ocultar URL personalizada' : 'Usar URL de imagen externa'}</span>
              </button>
              {showCustomAvatarUrl && (
                <input
                  type="url"
                  value={accountAvatarUrl}
                  onChange={(event) => setAccountAvatarUrl(event.target.value)}
                  placeholder="https://ejemplo.com/mi-avatar.jpg"
                  className={`mt-2 w-full rounded-xl px-3 py-2 text-xs font-mono outline-none ${tone.input}`}
                />
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] font-bold">
              <span className={tone.muted}>Nombre Completo *</span>
              <input
                type="text"
                required
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="Ej. Juan Pérez"
                className={`mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
              />
            </label>
            <label className="block text-[11px] font-bold">
              <span className={tone.muted}>Correo Electrónico *</span>
              <input
                type="email"
                required
                value={accountEmail}
                onChange={(event) => setAccountEmail(event.target.value)}
                placeholder="usuario@radar.com"
                className={`mt-1 w-full rounded-xl px-3 py-2 text-xs font-mono outline-none ${tone.input}`}
              />
            </label>
            <label className="block text-[11px] font-bold sm:col-span-2">
              <span className={tone.muted}>Número de Teléfono / WhatsApp</span>
              <input
                type="tel"
                value={accountPhone}
                onChange={(event) => setAccountPhone(event.target.value)}
                placeholder="Ej. +1 (919) 555-0199"
                className={`mt-1 w-full rounded-xl px-3 py-2 text-xs font-mono outline-none ${tone.input}`}
              />
              <span className={`mt-1 block text-[10.5px] font-normal ${tone.muted}`}>
                Permite contacto rápido interno y seguimiento de operaciones.
              </span>
            </label>
          </div>

          <div className={`space-y-3 rounded-2xl p-3.5 ${tone.subtle}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-bold flex items-center gap-1.5 ${tone.heading}`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">lock_reset</span>
                Seguridad & Contraseña
              </span>
              <button
                type="button"
                onClick={() => setShowPasswords((prev) => !prev)}
                className={`inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer ${tone.muted} hover:underline`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                  {showPasswords ? 'visibility_off' : 'visibility'}
                </span>
                <span>{showPasswords ? 'Ocultar' : 'Mostrar'}</span>
              </button>
            </div>
            <p className={`text-[11px] ${tone.muted}`}>
              Solo completa la nueva contraseña si deseas cambiar tu clave de acceso (o tu contraseña actual si modificas tu correo).
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-[11px] font-bold">
                <span className={tone.muted}>Contraseña Actual</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="••••••••"
                  className={`mt-1 w-full rounded-xl px-3 py-2 text-xs font-mono outline-none ${tone.input}`}
                />
              </label>
              <label className="block text-[11px] font-bold">
                <span className={tone.muted}>Nueva Contraseña</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className={`mt-1 w-full rounded-xl px-3 py-2 text-xs font-mono outline-none ${tone.input}`}
                />
              </label>
              <label className="block text-[11px] font-bold">
                <span className={tone.muted}>Confirmar Nueva Contraseña</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repite la contraseña"
                  className={`mt-1 w-full rounded-xl px-3 py-2 text-xs font-mono outline-none ${tone.input}`}
                />
              </label>
            </div>
            <div className={`grid gap-1 text-[11px] sm:grid-cols-3 ${tone.muted}`}>
              <div className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`material-symbols-outlined text-[14px] ${newPassword.length >= 8 ? 'text-emerald-500' : ''}`}>check_circle</span>
                <span>Mínimo 8 caracteres</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`material-symbols-outlined text-[14px] ${/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) ? 'text-emerald-500' : ''}`}>check_circle</span>
                <span>Mayúsculas y minúsculas</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`material-symbols-outlined text-[14px] ${/[0-9]/.test(newPassword) && /[^a-zA-Z0-9]/.test(newPassword) ? 'text-emerald-500' : ''}`}>check_circle</span>
                <span>Números y símbolos especiales</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingAccount}
              className={`rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-50 ${tone.primary}`}
            >
              {savingAccount ? 'Guardando cuenta…' : 'Guardar cuenta y seguridad'}
            </button>
          </div>
        </form>
      )}
    </div>
  );

  return (
    <div className={variant === 'yard' ? 'fixed inset-0 z-[140] overflow-y-auto' : ''}>
      <div className={`${tone.page} ${variant === 'yard' ? 'min-h-full' : 'space-y-4'}`}>
        <div className={variant === 'yard' ? 'mx-auto w-full max-w-3xl px-3 pb-24 pt-4 sm:px-4' : 'space-y-4'}>
          <div className={variant === 'yard' ? `rounded-3xl p-4 sm:p-5 ${tone.card}` : 'pb-1'}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3.5">
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
                <div className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-mono text-xl font-black ${
                  variant === 'yard' ? 'bg-[var(--yard-accent-soft)] text-[var(--yard-accent-strong)]' : 'bg-[var(--bg-surface)] text-[var(--brand-solid)] border border-[var(--border-subtle)]'
                }`}>
                  {profile.avatarUrl
                    ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                    : initialsFor(profile.name)}
                </div>
                <div className="min-w-0">
                  <h1 className={`truncate text-xl font-black sm:text-2xl ${tone.heading}`}>{profile.name}</h1>
                  <p className={`mt-0.5 truncate text-xs ${tone.muted}`}>
                    {ROLE_LABELS[profile.role] || profile.role}
                    {profile.hiredOn ? ` · Ingreso ${formatFaultDate(profile.hiredOn)}` : ''}
                    {!profile.active ? ' · Cuenta inactiva' : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => setFaultModalOpen(true)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-bold ${tone.secondary}`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add_alert</span>
                      Registrar falta
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatalogOpen(true)}
                      aria-label="Catálogo de faltas"
                      title="Catálogo de faltas"
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone.secondary}`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">tune</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div ref={tabsRef} className="flex gap-5 overflow-x-auto border-b border-[var(--border-subtle)]" role="tablist" aria-label="Secciones del perfil">
            {([
              ['resumen', 'Resumen'],
              ['rendimiento', 'Rendimiento'],
              ['faltas', `Faltas${activeFaults ? ` · ${activeFaults}` : ''}`],
              ...(canManage ? [['equipo', 'Equipo'] as [Tab, string]] : []),
              ['datos', 'Datos'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px shrink-0 border-b-2 px-0.5 pb-2.5 pt-1 text-xs font-bold transition ${
                  tab === key
                    ? tone.tabUnderline
                    : `border-transparent ${tone.muted} hover:text-[var(--text-heading)]`
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
                  penaltyAmount={data.penalties?.open.amount ?? 0}
                  cutoffLabel={data.penalties ? `Corte sábado, 6:00 p. m. · hora de Honduras` : undefined}
                  settlement={data.penalties?.settlement}
                  commissions={data.penalties?.commissions}
                  carryoverDebt={data.penalties?.carryoverDebt}
                />
              )}
              {data.penalties?.commissions && (
                <CommissionsCard
                  commissions={data.penalties.commissions}
                  settlement={data.penalties.settlement}
                  tone={tone}
                />
              )}
              {data.penalties && (
                <PenaltyCard
                  penalties={data.penalties}
                  tone={tone}
                  canManage={canManage}
                  isSelf={targetUserId === (viewerId || 0)}
                  onAppealPenalty={(line) => setAppealPenalty(line)}
                  onResolvePenaltyAppeal={(line) => setResolvePenaltyAppeal(line)}
                  onOpenAppealsBatch={() => setBatchAppealsOpen(true)}
                />
              )}
            </div>
          )}

          {tab === 'rendimiento' && (
            <div className="space-y-4">
              {data.penalties?.commissions && (
                <CommissionsCard
                  commissions={data.penalties.commissions}
                  settlement={data.penalties.settlement}
                  tone={tone}
                />
              )}
              <PerformancePanel targetUserId={targetUserId} tone={tone} />
              <section className="space-y-3" aria-labelledby="profile-followups-heading">
                <h2 id="profile-followups-heading" className={`text-sm font-bold ${tone.heading}`}>Seguimientos</h2>
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
              </section>
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

          {tab === 'equipo' && canManage && (
            <TeamCompensationPanel
              tone={tone}
              onOpenProfile={onConfigureEmployee}
              onVaultError={handleVaultRetry}
            />
          )}
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

      {appealPenalty && (
        <AppealPenaltyDialog
          tone={tone}
          penalty={appealPenalty}
          saving={saving}
          onClose={() => setAppealPenalty(null)}
          onSubmit={(category, reason, evidenceUrls) => {
            void sendPenaltyAppeal(appealPenalty, category, reason, evidenceUrls);
          }}
        />
      )}

      {resolvePenaltyAppeal && (
        <ResolvePenaltyAppealDialog
          tone={tone}
          penalty={resolvePenaltyAppeal}
          saving={saving}
          onClose={() => setResolvePenaltyAppeal(null)}
          onResolve={(decision, note) => {
            void resolvePenaltyAppealHandler(resolvePenaltyAppeal, decision, note);
          }}
        />
      )}

      {batchAppealsOpen && (
        <PenaltyAppealsBatchModal
          tone={tone}
          onClose={() => setBatchAppealsOpen(false)}
          onSuccess={() => {
            void load(true);
          }}
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
                {item.name} · {item.points} pts · {formatUsd(item.amount)}
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
            Descuento: <strong>{selected.amount > 0 ? formatUsd(selected.amount) : 'sin monto definido'}</strong> · <strong>{selected.points} pts</strong>
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

export const AppealPenaltyDialog: React.FC<{
  tone: Tone;
  penalty: PenaltySourceLine;
  saving: boolean;
  onClose: () => void;
  onSubmit: (category: string, reason: string, evidenceUrls?: string[]) => void;
}> = ({ tone, penalty, saving, onClose, onSubmit }) => {
  const [category, setCategory] = useState<string>('technical_issue');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const penaltyLabel = PENALTY_SOURCE_LABELS[penalty.source]?.label || 'Amonestación';

  return (
    <Dialog
      title="Apelar amonestación"
      subtitle={`${penaltyLabel} · ${penalty.orderCode || 'Llamada PBX'} · ${formatUsd(penalty.amount)}`}
      onClose={onClose}
      tone={tone}
    >
      <div className="space-y-3.5">
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5 text-xs text-sky-200">
          <p className="font-bold flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">balance</span>
            Pausa cautelar automática
          </p>
          <p className="mt-1 text-[11px] text-sky-200/90 leading-relaxed">
            Al enviar tu apelación, este cargo entra inmediatamente en <strong>pausa cautelar</strong> y no se descontará en tu corte de nómina mientras es evaluado por la administración.
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-bold">
            <span className={tone.muted}>Causa o motivo de la apelación</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`mt-1.5 w-full rounded-xl px-3 py-2 text-xs outline-none cursor-pointer ${tone.input}`}
            >
              {Object.entries(PENALTY_APPEAL_CATEGORIES).map(([key, val]) => (
                <option key={key} value={key}>
                  {val.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <label className="block text-[11px] font-bold">
            <span className={tone.muted}>Explicación detallada de lo sucedido</span>
            <textarea
              value={reason}
              rows={4}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica detalladamente qué ocurrió (ej: falla eléctrica, corte de internet, el cliente cortó en seco, etc.)."
              aria-label="Motivo de la apelación"
              className={`mt-1.5 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
            />
          </label>
        </div>

        {error && <p className={`text-[11.5px] ${tone.warningText}`}>{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={`rounded-xl px-3.5 py-2 text-xs font-bold ${tone.secondary}`}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (reason.trim().length < 5) {
                setError('Por favor explica lo sucedido con al menos 5 caracteres.');
                return;
              }
              setError(null);
              onSubmit(category, reason.trim());
            }}
            className={`rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 ${tone.primary}`}
          >
            {saving ? 'Enviando…' : 'Enviar apelación'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export const ResolvePenaltyAppealDialog: React.FC<{
  tone: Tone;
  penalty: PenaltySourceLine;
  saving: boolean;
  onClose: () => void;
  onResolve: (decision: 'approved' | 'rejected', note?: string) => void;
}> = ({ tone, penalty, saving, onClose, onResolve }) => {
  const [note, setNote] = useState('');
  const appeal = penalty.appeal;
  const penaltyLabel = PENALTY_SOURCE_LABELS[penalty.source]?.label || 'Amonestación';

  return (
    <Dialog
      title="Evaluar apelación de amonestación"
      subtitle={`${penaltyLabel} · ${penalty.orderCode || 'Llamada PBX'} · ${formatUsd(penalty.amount)}`}
      onClose={onClose}
      tone={tone}
    >
      <div className="space-y-3.5">
        <div className={`rounded-xl px-3.5 py-3 text-[11.5px] ${tone.subtle} space-y-2`}>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Categoría invocada</p>
            <p className="mt-0.5 font-bold text-sky-300">
              {PENALTY_APPEAL_CATEGORIES[appeal?.category || 'other']?.label || appeal?.category}
            </p>
          </div>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${tone.muted}`}>Motivo del asesor</p>
            <p className="mt-0.5 whitespace-pre-line text-white/90">&ldquo;{appeal?.reason}&rdquo;</p>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-slate-400 pt-1">
            <span>Fecha apelación: {shortDate(appeal?.createdAt)}</span>
            <span>Monto retenido: <strong>{formatUsd(penalty.amount)}</strong></span>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold">
            <span className={tone.muted}>Nota o respuesta administrativa (opcional)</span>
            <textarea
              value={note}
              rows={3}
              maxLength={255}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej. Se constata corte general de energía / Se revisa audio de PBX y se valida justificación."
              className={`mt-1.5 w-full rounded-xl px-3 py-2 text-xs outline-none ${tone.input}`}
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={`rounded-xl px-3.5 py-2 text-xs font-bold ${tone.secondary}`}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onResolve('rejected', note)}
            className="rounded-xl px-3.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 border border-rose-500/30 disabled:opacity-50"
          >
            Rechazar (Reactivar cargo)
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onResolve('approved', note)}
            className={`rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 ${tone.primary}`}
          >
            Aprobar y exonerar cargo ($0.00)
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export const PenaltyAppealsBatchModal: React.FC<{
  tone: Tone;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ tone, onClose, onSuccess }) => {
  const [appeals, setAppeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const { toast } = useFeedback();

  const loadAppeals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/penalties/appeals?status=pending');
      const data = await res.json().catch(() => ({ appeals: [] }));
      setAppeals(data.appeals || []);
    } catch {
      setAppeals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAppeals();
  }, [loadAppeals]);

  const handleResolve = async (appealId: number, decision: 'approved' | 'rejected') => {
    setProcessingId(appealId);
    try {
      const res = await apiFetch(`/penalties/appeals/${appealId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error('Error al resolver');
      toast({
        title: decision === 'approved' ? 'Cargo exonerado' : 'Apelación rechazada',
        message: decision === 'approved' ? 'El cargo fue cancelado ($0.00).' : 'El cargo continúa activo.',
        tone: 'success',
      });
      await loadAppeals();
      onSuccess();
    } catch {
      toast({ title: 'Error', message: 'No se pudo resolver la apelación', tone: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleResolveAll = async (decision: 'approved' | 'rejected') => {
    if (appeals.length === 0) return;
    setBatchBusy(true);
    try {
      const res = await apiFetch('/penalties/appeals/resolve-all', {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error('Error al resolver');
      toast({
        title: 'Apelaciones resueltas',
        message: `Se ${decision === 'approved' ? 'aprobaron y exoneraron' : 'rechazaron'} todas las apelaciones pendientes.`,
        tone: 'success',
      });
      await loadAppeals();
      onSuccess();
    } catch {
      toast({ title: 'Error', message: 'No se pudieron procesar las apelaciones', tone: 'error' });
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <Dialog
      title="Bandeja de apelaciones de amonestaciones"
      subtitle={`${appeals.length} apelación(es) pendientes de revisión`}
      onClose={onClose}
      tone={tone}
    >
      <div className="space-y-4 max-h-[70vh] flex flex-col">
        {appeals.length > 1 && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-xs">
            <span className="text-sky-200">
              ¿Deseas exonerar todos los <strong>{appeals.length}</strong> cargos apelados pendientes en un solo clic?
            </span>
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => { void handleResolveAll('approved'); }}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold disabled:opacity-50 cursor-pointer ${tone.primary}`}
            >
              {batchBusy ? 'Procesando…' : 'Aprobar todas ($0.00)'}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
              Cargando apelaciones…
            </div>
          ) : appeals.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              <span className="material-symbols-outlined text-[32px] text-emerald-400 block mb-1">task_alt</span>
              No hay apelaciones pendientes de revisión.
            </div>
          ) : (
            appeals.map((a) => (
              <div key={a.id} className="p-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold text-white text-sm">{a.userName}</span>
                    <span className="ml-2 text-[10px] text-slate-400 uppercase font-mono">{a.userRole}</span>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      {PENALTY_SOURCE_LABELS[a.penalty?.source as keyof typeof PENALTY_SOURCE_LABELS]?.label || a.penalty?.source} · {a.penalty?.orderCode || 'Llamada PBX'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-amber-400">{formatUsd(a.penalty?.amount || 0)}</span>
                    <span className="block text-[10px] text-slate-400">{shortDate(a.createdAt)}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-sky-300">
                    <span className="material-symbols-outlined text-[14px]">
                      {PENALTY_APPEAL_CATEGORIES[a.category]?.icon || 'help_outline'}
                    </span>
                    <span>{PENALTY_APPEAL_CATEGORIES[a.category]?.label || a.category}</span>
                  </div>
                  <p className="text-slate-200 whitespace-pre-line">&ldquo;{a.reason}&rdquo;</p>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={processingId === a.id || batchBusy}
                    onClick={() => { void handleResolve(a.id, 'rejected'); }}
                    className="px-2.5 py-1 rounded-xl text-[11px] font-bold text-rose-300 hover:bg-rose-500/20 border border-rose-500/30 transition disabled:opacity-50 cursor-pointer"
                  >
                    Rechazar
                  </button>
                  <button
                    type="button"
                    disabled={processingId === a.id || batchBusy}
                    onClick={() => { void handleResolve(a.id, 'approved'); }}
                    className={`px-3 py-1 rounded-xl text-[11px] font-bold transition disabled:opacity-50 cursor-pointer ${tone.primary}`}
                  >
                    Aprobar ($0.00)
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-[var(--border-subtle)]">
          <button type="button" onClick={onClose} className={`rounded-xl px-4 py-2 text-xs font-bold ${tone.secondary}`}>
            Cerrar
          </button>
        </div>
      </div>
    </Dialog>
  );
};
