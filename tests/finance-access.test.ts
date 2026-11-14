import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyRelationView } from '../src/components/WeeklyRelationView';
import { useFinanceState, useFinanceMovements } from '../src/hooks/useFinanceState';

vi.mock('../src/hooks/useFinanceState', () => ({
  useFinanceState: vi.fn(),
  useFinanceMovements: vi.fn(),
}));
vi.mock('../src/components/FinanceVault', () => ({
  FinanceVault: ({ children }: { children: React.ReactNode }) => children,
}));

const stateMock = vi.mocked(useFinanceState);
const movementsMock = vi.mocked(useFinanceMovements);
const stateResult = () => ({
  state: { version: 0, employees: [], recurringExpenses: [], otherExpenses: [] },
  error: null, saving: false, reload: vi.fn(), save: vi.fn(), importLegacy: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  stateMock.mockReturnValue(stateResult());
  movementsMock.mockReturnValue({ movements: [], error: null, loaded: true, refresh: vi.fn() });
});

describe('finance content after the vault grants access', () => {
  it('immediately loads state and movements and renders the administrative finance view', () => {
    const html = renderToStaticMarkup(React.createElement(WeeklyRelationView));
    expect(stateMock).toHaveBeenCalledWith(true);
    expect(movementsMock).toHaveBeenCalledWith(true);
    expect(html).not.toContain('Acceso administrativo validado por servidor');
    expect(html).not.toMatch(/Zona contable|America\/New_York|Nueva York|saldos legacy|no un cierre histórico/);
    expect(html).toContain('Semana anterior');
    expect(html).toContain('Recargar datos de la semana');
    expect(html).toContain('Nómina');
    expect(html).toContain('Gastos Operativos y Deducciones de la Semana');
    expect(html).not.toMatch(/OTP|2FA|Authenticator|Bóveda|Bloquear/);
    expect(stateMock.mock.results[0].value.save).not.toHaveBeenCalled();
  });

  it('shows loading without claiming verified access or asking for OTP', () => {
    stateMock.mockReturnValue({ ...stateResult(), state: null });
    const html = renderToStaticMarkup(React.createElement(WeeklyRelationView));
    expect(html).toContain('Cargando estado financiero');
    expect(html).toContain('Validando acceso administrativo y datos del servidor');
    expect(html).not.toContain('Acceso administrativo validado por servidor');
    expect(html).not.toMatch(/OTP|2FA|Bloquear/);
  });

  it('shows server authorization failures without rendering data or bypassing them', () => {
    stateMock.mockReturnValue({ ...stateResult(), state: null, error: 'Acceso denegado: requiere administrador' });
    const html = renderToStaticMarkup(React.createElement(WeeklyRelationView));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Acceso denegado: requiere administrador');
    expect(html).not.toContain('Acceso administrativo validado por servidor');
    expect(html).not.toContain('Nómina Empleados');
    expect(stateMock.mock.results[0].value.save).not.toHaveBeenCalled();
  });
});
