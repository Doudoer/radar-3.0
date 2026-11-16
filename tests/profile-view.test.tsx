import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AppealDialog,
  CatalogDialog,
  FaultFormDialog,
  FaultHistoryList,
  FollowupBoard,
  PenaltyCard,
  ResolveAppealDialog,
  TONES,
  UserProfileView,
  WeekLiquidation,
  type FaultItem,
  type PenaltySnapshot,
} from '../src/components/UserProfileView';
import type { WeekPayroll } from '../src/utils/payroll';
import type { WorkflowTask } from '../src/utils/orderWorkflow';

const week = (overrides: Partial<WeekPayroll> = {}): WeekPayroll => ({
  start: '2026-11-09',
  end: '2026-11-15',
  label: '9 – 15 nov 2026',
  gross: 3500,
  deductions: 225,
  points: 15,
  faultCount: 2,
  net: 3275,
  ...overrides,
});

const fault = (overrides: Partial<FaultItem> = {}): FaultItem => ({
  id: 1,
  faultType: 'Retardo',
  points: 5,
  amount: 150,
  faultDate: '2026-11-14',
  notes: 'Llegó 25 minutos tarde.',
  status: 'activa',
  createdByName: 'System Admin',
  appeal: null,
  ...overrides,
});

const list = (faults: FaultItem[], opts: { isSelf?: boolean; canManage?: boolean } = {}) =>
  renderToStaticMarkup(
    <FaultHistoryList
      faults={faults}
      tone={TONES.office}
      isSelf={opts.isSelf ?? false}
      canManage={opts.canManage ?? false}
      onAppeal={vi.fn()}
      onAnnul={vi.fn()}
      onResolveAppeal={vi.fn()}
    />
  );

describe('weekly liquidation', () => {
  it('shows the estimated payout, deductions and points for the current week', () => {
    const html = renderToStaticMarkup(
      <WeekLiquidation
        week={week()}
        history={[week(), week({ start: '2026-11-02', label: '2 – 8 nov 2026', deductions: 400, points: 20, faultCount: 1, net: 3100 })]}
        tone={TONES.office}
        hasSalary
        canManage
      />
    );
    expect(html).toContain('Esta semana');
    expect(html).toContain('9 – 15 nov 2026');
    expect(html).toContain('$ 3,275.00');
    expect(html).toContain('−$ 225.00');
    expect(html).toContain('15 pts');
    expect(html).not.toContain('Semanas anteriores');
    expect(html).not.toContain('En curso');
  });

  it('shows a single projected net after subtracting penalties, not two competing totals', () => {
    const html = renderToStaticMarkup(
      <WeekLiquidation
        week={week()}
        history={[]}
        tone={TONES.office}
        hasSalary
        canManage={false}
        penaltyAmount={225}
        cutoffLabel="Corte sábado 21, 6:00 p. m. · hora de Honduras"
      />
    );
    expect(html).toContain('$ 3,050.00');
    expect(html).toContain('Amonestaciones');
    expect(html).toContain('−$ 225.00');
    expect(html).toContain('Corte sábado 21, 6:00 p. m. · hora de Honduras');
    expect(html).not.toContain('Neto proyectado');
  });

  it('marks an overdrawn week as negative instead of hiding the debt', () => {
    const html = renderToStaticMarkup(
      <WeekLiquidation
        week={week({ deductions: 4000, net: -500 })}
        history={[week({ deductions: 4000, net: -500 })]}
        tone={TONES.office}
        hasSalary
        canManage={false}
      />
    );
    expect(html).toContain('-$ 500.00');
  });

  it('explains the missing salary differently for the employee and an administrator', () => {
    const asAdmin = renderToStaticMarkup(
      <WeekLiquidation week={week()} history={[]} tone={TONES.office} hasSalary={false} canManage />
    );
    expect(asAdmin).toContain('aún no tiene salario semanal configurado');
    const asSelf = renderToStaticMarkup(
      <WeekLiquidation week={week()} history={[]} tone={TONES.office} hasSalary={false} canManage={false} />
    );
    expect(asSelf).toContain('La administración aún no ha configurado tu salario semanal.');
  });
});

describe('fault history', () => {
  it('shows an empty state when there is no record', () => {
    const html = list([]);
    expect(html).toContain('Sin faltas registradas');
    expect(html).not.toContain('Apelar falta');
  });

  it('lets the employee appeal an active fault that has no appeal yet', () => {
    const html = list([fault()], { isSelf: true });
    expect(html).toContain('Activa');
    expect(html).toContain('−$ 150.00');
    expect(html).toContain('Registrada por System Admin');
    expect(html).toContain('Llegó 25 minutos tarde.');
    expect(html).toContain('Apelar falta');
    expect(html).not.toContain('Anular falta');
  });

  it('keeps annulled faults visible but marks them as not charged', () => {
    const html = list([fault({ status: 'anulada', appeal: null })], { isSelf: true });
    expect(html).toContain('Anulada');
    expect(html).toContain('Sin descuento');
    expect(html).toContain('line-through');
    expect(html).not.toContain('Apelar falta');
  });

  it('renders pending appeals and lets an administrator resolve or annul them', () => {
    const html = list(
      [fault({ appeal: { id: 4, message: 'Avisé por WhatsApp.', status: 'pendiente', resolutionNote: '' } })],
      { canManage: true }
    );
    expect(html).toContain('Apelación pendiente');
    expect(html).toContain('Avisé por WhatsApp.');
    expect(html).toContain('Resolver apelación');
    expect(html).toContain('Anular falta');
    expect(html).not.toContain('Apelar falta');
  });

  it('shows the decision and its note for resolved appeals', () => {
    const accepted = list([
      fault({ status: 'anulada', appeal: { id: 5, message: 'Era mi día libre.', status: 'aceptada', resolutionNote: 'Se anuló el descuento.' } }),
    ]);
    expect(accepted).toContain('Apelación aceptada');
    expect(accepted).toContain('Respuesta: Se anuló el descuento.');

    const rejected = list([fault({ status: 'anulada', appeal: { id: 6, message: 'Sin evidencia.', status: 'rechazada', resolutionNote: 'Se mantiene.' } })]);
    expect(rejected).toContain('Apelación rechazada');
    expect(rejected).toContain('Respuesta: Se mantiene.');
  });

  it('avoids inventing a charge when the catalog entry has no amount', () => {
    const html = list([fault({ amount: 0, points: 0 })], { canManage: true });
    expect(html).toContain('Sin monto');
    expect(html).not.toContain('−$');
  });
});

describe('penalty card', () => {
  const snapshot = (salary: number | null, units = 1): PenaltySnapshot => ({
    userId: 7,
    weeklySalary: salary,
    rate: 0.8333,
    enabled: true,
    period: { start: '2026-11-16T00:00:00Z', end: '2026-11-22T00:00:00Z', label: 'Sábado 21', cutoffLabel: 'Se descuenta el sábado 21 a las 6:00 p. m.' },
    open: {
      units,
      percent: 0.83,
      amount: salary === null ? 0 : 0.62,
      lines: [{ source: 'post_delivery', units, percent: 0.83, amount: salary === null ? 0 : 0.62 }],
    },
    details: [],
    history: [],
  });

  it('shows the single team rate and converts it to the employee salary', () => {
    const html = renderToStaticMarkup(<PenaltyCard penalties={snapshot(75)} tone={TONES.office} />);
    expect(html).toContain('tarifa fija 0.83% por unidad');
    expect(html).toContain('1 u = $ 0.62');
    expect(html).toContain('Cómo se calcula');
    expect(html).toContain('salario semanal de cada colaborador');
    expect(html).not.toContain('Tramo');
    expect(html).not.toContain('Guardar tarifa');
    expect(html).not.toContain('Neto proyectado');
  });

  it('does not invent a dollar charge when the salary is missing', () => {
    const html = renderToStaticMarkup(<PenaltyCard penalties={snapshot(null)} tone={TONES.office} />);
    expect(html).toContain('Salario base sin configurar');
    expect(html).not.toContain('1 u =');
  });
});

describe('profile view shell', () => {
  it('renders the loading state before the profile request resolves', () => {
    const html = renderToStaticMarkup(<UserProfileView targetUserId={5} viewerId={5} viewerRole="admin" />);
    expect(html).toContain('animate-spin');
    expect(html).toContain('sync');
  });
});

describe('fault and appeal dialogs', () => {
  it('renders the registration form without pre-selecting a catalog entry', () => {
    const html = renderToStaticMarkup(
      <FaultFormDialog tone={TONES.office} userName="Perfil QA" saving={false} onClose={vi.fn()} onSubmit={async () => true} />
    );
    expect(html).toContain('Selecciona un tipo…');
    expect(html).toContain('Nota para el expediente');
    expect(html).toContain('type="date"');
    expect(html).toContain('Perfil QA');
  });

  it('renders the appeal form with the fault context and its minimum-length rule', () => {
    const html = renderToStaticMarkup(
      <AppealDialog tone={TONES.office} fault={fault()} saving={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(html).toContain('Apelar falta');
    expect(html).toContain('Retardo');
    expect(html).toContain('Explica por qué esta falta no corresponde');
    expect(html).toContain('Enviar apelación');
    expect(html).toContain('maxLength="500"');
  });

  it('renders the catalog editor with the points and lempira amount fields', () => {
    const html = renderToStaticMarkup(
      <CatalogDialog
        tone={TONES.office}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onVaultError={vi.fn()}
        reportError={vi.fn()}
      />
    );
    expect(html).toContain('Catálogo de faltas');
    expect(html).toContain('Puntos y monto de descuento por tipo de incumplimiento');
    expect(html).toContain('Nombre de la falta');
    expect(html).toContain('Monto en lempiras');
    expect(html).toContain('Agregar');
    expect(html).toContain('Nombre · puntos · monto (L)');
  });

  it('renders the administrator decision with both resolve paths', () => {
    const html = renderToStaticMarkup(
      <ResolveAppealDialog
        tone={TONES.office}
        appeal={{ id: 3, message: 'Avisé con anticipación.', status: 'pendiente', resolutionNote: '' }}
        saving={false}
        onClose={vi.fn()}
        onResolve={vi.fn()}
      />
    );
    expect(html).toContain('Resolver apelación');
    expect(html).toContain('Avisé con anticipación.');
    expect(html).toContain('Respuesta (opcional)');
    expect(html).toContain('Rechazar apelación');
    expect(html).toContain('Aceptar y anular falta');
  });
});

const followupTask = (overrides: Partial<WorkflowTask> = {}): WorkflowTask => ({
  order: {
    id: 'ord-1',
    code: 'RAD-0001',
    userId: 115,
    advisor: 'Perfil QA',
    version: 1,
    createdAt: '2026-11-10',
    status: 'entregado',
    deliveredAt: '2026-11-10',
    scheduledPickupAt: null,
    total: 3500,
    paid: 3500,
    customerName: 'Cliente QA',
  },
  task: 'post_3',
  title: 'Post-entrega · Día 3',
  requirement: 'Confirmar recepción y programación de instalación.',
  dueDate: '2026-11-13',
  objectiveDueDate: '2026-11-13',
  nextAction: 'Llamar al cliente',
  blockedBy: null,
  bucket: 'overdue',
  overdue: true,
  escalated: false,
  regularization: false,
  needsIncident: false,
  daysOverdue: 1,
  penaltyPoints: -1,
  ...overrides,
});

const board = (tasks: WorkflowTask[]) =>
  renderToStaticMarkup(<FollowupBoard tasks={tasks} tone={TONES.office} />);

describe('follow-up board', () => {
  it('renders an honest empty state naming the three follow-up lines', () => {
    const html = board([]);
    expect(html).toContain('Sin pendientes de seguimiento');
    expect(html).toContain('seguimientos post-entrega, reclamos y piezas listas para entregar');
  });

  it('groups tasks into post-entrega, reclamos and piezas listas para entregar', () => {
    const html = board([
      followupTask(),
      followupTask({
        task: 'incident',
        title: 'Dar seguimiento a la incidencia',
        bucket: 'today',
        overdue: false,
        daysOverdue: 0,
        penaltyPoints: 0,
        order: { ...followupTask().order, id: 'ord-2', code: 'RAD-0002', status: 'reclamo' },
      }),
      followupTask({
        task: 'prepare',
        title: 'Preparación y cita',
        bucket: 'upcoming',
        overdue: false,
        daysOverdue: 0,
        penaltyPoints: 0,
        order: { ...followupTask().order, id: 'ord-3', code: 'RAD-0003', yardPieceReady: true },
      }),
    ]);
    expect(html).toContain('3 pendientes');
    expect(html).toContain('Seguimientos post-entrega · 1');
    expect(html).toContain('Reclamos · 1');
    expect(html).toContain('Piezas listas para entregar · 1');
    expect(html).toContain('Pieza lista en patio');
  });

  it('uses singular copy for a single pending task', () => {
    const html = board([followupTask({ task: 'incident', title: 'Dar seguimiento a la incidencia' })]);
    expect(html).toContain('1 pendiente');
    expect(html).toContain('1 atrasado');
  });

  it('summarises pending, overdue and ready pieces with the overdue penalty', () => {
    const html = board([
      followupTask(),
      followupTask({
        task: 'prepare',
        bucket: 'upcoming',
        overdue: false,
        daysOverdue: 0,
        penaltyPoints: 0,
        order: { ...followupTask().order, id: 'ord-3', yardPieceReady: true },
      }),
    ]);
    expect(html).toContain('2 pendientes');
    expect(html).toContain('1 atrasado · 1 pieza lista en patio');
    expect(html).toContain('Atrasada');
    expect(html).toContain('1 día de atraso');
    expect(html).toContain('−1 pts de puntuación');
    expect(html).toContain('RAD-0001 · Cliente QA');
  });
});
