import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExpenseItem, OfficeEmployee, RecurringExpense } from '../components/WeeklyRelationView';
import { apiFetch } from '../services/apiFetch';
import type { FinanceMovement } from '../utils/finance';
import { useFeedback } from '../components/FeedbackProvider';

export interface FinanceState {
  version: number;
  employees: OfficeEmployee[];
  recurringExpenses: RecurringExpense[];
  otherExpenses: ExpenseItem[];
}

const isFinanceState = (value: unknown): value is FinanceState => {
  const state = value as FinanceState;
  return !!state && Number.isInteger(state.version) && state.version >= 0 &&
    Array.isArray(state.employees) && Array.isArray(state.recurringExpenses) && Array.isArray(state.otherExpenses);
};

export class FinanceConflictError extends Error {}

export const loadFinanceState = async (): Promise<FinanceState> => {
  const response = await apiFetch('/finance/state');
  const data = await response.json();
  if (!response.ok || !isFinanceState(data)) throw new Error(data.message || 'No se pudo cargar el estado financiero.');
  return data;
};

export const persistFinanceState = async (previous: FinanceState, patch: Partial<Omit<FinanceState, 'version'>>): Promise<FinanceState> => {
  const next = { ...previous, ...patch };
  const response = await apiFetch('/finance/state', { method: 'PUT', body: JSON.stringify(next) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 409) throw new FinanceConflictError('Conflicto financiero.');
  if (!response.ok) throw new Error(data.message || 'No se guardaron los cambios financieros.');
  if (!Number.isInteger(data.version) || data.version !== next.version + 1) {
    throw new FinanceConflictError('Respuesta de versión inesperada.');
  }
  return { ...next, version: data.version };
};

export const LEGACY_FINANCE_KEYS = [
  'radar_office_employees_v1',
  'radar_recurring_expenses_v1',
  'radar_other_expenses_v1',
] as const;

export const LEGACY_FINANCE_MIGRATED_KEY = 'radar_finance_legacy_migrated_v1';

export const readLegacyFinanceState = (storage: Pick<Storage, 'getItem'>): Omit<FinanceState, 'version'> => {
  const read = (key: string) => {
    const value = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(value)) throw new Error(`Datos locales inválidos: ${key}`);
    return value;
  };
  return {
    employees: read('radar_office_employees_v1'),
    recurringExpenses: read('radar_recurring_expenses_v1'),
    otherExpenses: read('radar_other_expenses_v1'),
  };
};

export const clearLegacyFinanceState = (storage: Pick<Storage, 'removeItem' | 'setItem'>) => {
  LEGACY_FINANCE_KEYS.forEach((key) => storage.removeItem(key));
  storage.setItem(LEGACY_FINANCE_MIGRATED_KEY, new Date().toISOString());
};

export const useFinanceState = (enabled: boolean) => {
  const { confirm } = useFeedback();
  const [state, setState] = useState<FinanceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = useRef<FinanceState | null>(null);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    try {
      const data = await loadFinanceState();
      current.current = data;
      setState(data);
      return true;
    } catch (reason) {
      current.current = null;
      setState(null);
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar finanzas.');
      return false;
    }
  }, []);

  useEffect(() => {
    if (enabled) { setError(null); void reload(); }
  }, [enabled, reload]);

  const save = useCallback(async (patch: Partial<Omit<FinanceState, 'version'>>) => {
    if (!current.current || busy.current) {
      setError('Espere a que finalice la carga o el guardado anterior.');
      return false;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      current.current = await persistFinanceState(current.current, patch);
      setState(current.current);
      window.dispatchEvent(new Event('radar:finance-updated'));
      return true;
    } catch (reason) {
      if (reason instanceof FinanceConflictError) {
        const refreshed = await reload();
        setError(refreshed
          ? 'Conflicto: se recargaron los datos del servidor. Revise y vuelva a guardar; no se reintentó su cambio.'
          : 'Conflicto: no fue posible recargar. Vuelva a cargar antes de guardar.');
        return false;
      }
      setError(reason instanceof Error ? reason.message : 'No se guardaron los cambios.');
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [reload]);

  const importLegacy = useCallback(async () => {
    if (!current.current || current.current.employees.length || current.current.recurringExpenses.length || current.current.otherExpenses.length) {
      setError('Solo se permite importar cuando el servidor no tiene datos financieros.');
      return false;
    }
    try {
      const legacy = readLegacyFinanceState(localStorage);
      if (!Object.values(legacy).some((items) => items.length)) throw new Error('No hay datos locales anteriores para importar.');
      const confirmed = await confirm({
        title: '¿Importar los datos financieros locales?',
        message: 'Se enviarán al servidor los datos guardados en este navegador. Después podrás borrar la copia local.',
        confirmLabel: 'Importar',
      });
      if (!confirmed) return false;
      const imported = await save(legacy);
      if (!imported) return false;
      const removeLocal = await confirm({
        title: 'Datos importados',
        message: 'El servidor ya tiene estos datos financieros. ¿Borrar la copia local de este navegador?',
        confirmLabel: 'Borrar copia local',
      });
      if (removeLocal) clearLegacyFinanceState(localStorage);
      else localStorage.setItem(LEGACY_FINANCE_MIGRATED_KEY, new Date().toISOString());
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron importar los datos locales.');
      return false;
    }
  }, [save, confirm]);

  return { state, error, saving, reload, save, importLegacy };
};

export const useFinanceMovements = (enabled = true, source: 'vault' | 'dashboard' = 'vault') => {
  const [movements, setMovements] = useState<FinanceMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await apiFetch(source === 'dashboard' ? '/analytics/income' : '/finance/movements');
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error(data.message || 'Ingresos no disponibles.');
      setMovements(data);
      setLoaded(true);
      return true;
    } catch (reason) {
      setLoaded(false);
      setMovements([]);
      setError(reason instanceof Error ? reason.message : 'Ingresos no disponibles.');
      return false;
    }
  }, [source]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const refreshOnChange = () => { void refresh(); };
    window.addEventListener('radar:finance-updated', refreshOnChange);
    window.addEventListener('radar:data-changed', refreshOnChange);
    return () => {
      window.removeEventListener('radar:finance-updated', refreshOnChange);
      window.removeEventListener('radar:data-changed', refreshOnChange);
    };
  }, [enabled, refresh]);
  return { movements, error, loaded, refresh };
};
