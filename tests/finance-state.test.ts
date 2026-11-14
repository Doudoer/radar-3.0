import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../src/services/apiFetch';
import {
  FinanceConflictError,
  LEGACY_FINANCE_KEYS,
  LEGACY_FINANCE_MIGRATED_KEY,
  clearLegacyFinanceState,
  loadFinanceState,
  persistFinanceState,
  readLegacyFinanceState,
} from '../src/hooks/useFinanceState';

vi.mock('../src/services/apiFetch', () => ({ apiFetch: vi.fn() }));
const fetchMock = vi.mocked(apiFetch);
const empty = { version: 3, employees: [], recurringExpenses: [], otherExpenses: [] };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => vi.clearAllMocks());

describe('finance server persistence', () => {
  it('loads empty arrays without injecting defaults or writing them back', async () => {
    fetchMock.mockResolvedValue(reply(empty));
    expect(await loadFinanceState()).toEqual(empty);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/finance/state');
  });

  it('rejects failed or malformed loads without creating state', async () => {
    fetchMock.mockResolvedValueOnce(reply({ message: 'Forbidden' }, 403));
    await expect(loadFinanceState()).rejects.toThrow('Forbidden');
    fetchMock.mockResolvedValueOnce(reply({ employees: [] }));
    await expect(loadFinanceState()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits for the PUT response, sends the version and preserves all other lists', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const employees = [{ id: 'e1', name: 'Employee', weeklySalary: 150 }];
    let completed = false;
    const saving = persistFinanceState(empty, { employees }).then((result) => { completed = true; return result; });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(empty.employees).toEqual([]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ ...empty, employees });
    resolve(reply({ version: 4 }));
    expect(await saving).toEqual({ ...empty, employees, version: 4 });
  });

  it('does not falsely report success or retry on conflict, network error or invalid response version', async () => {
    fetchMock.mockResolvedValueOnce(reply({ message: 'Changed' }, 409));
    await expect(persistFinanceState(empty, { employees: [] })).rejects.toBeInstanceOf(FinanceConflictError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error('Offline'));
    await expect(persistFinanceState(empty, {})).rejects.toThrow('Offline');
    fetchMock.mockResolvedValueOnce(reply({ version: 3 }));
    await expect(persistFinanceState(empty, {})).rejects.toBeInstanceOf(FinanceConflictError);
    expect(empty.version).toBe(3);
  });

  it('reads legacy data without writing/deleting the originals or synthesizing defaults', () => {
    const originals = { radar_office_employees_v1: '[{"id":"e","name":"Real","weeklySalary":50}]', radar_recurring_expenses_v1: '[]' };
    const getItem = vi.fn((key: string) => originals[key as keyof typeof originals] ?? null);
    expect(readLegacyFinanceState({ getItem })).toEqual({
      employees: [{ id: 'e', name: 'Real', weeklySalary: 50 }], recurringExpenses: [], otherExpenses: [],
    });
    expect(originals.radar_office_employees_v1).toBe('[{"id":"e","name":"Real","weeklySalary":50}]');
    expect(readLegacyFinanceState({ getItem: () => null })).toEqual({ employees: [], recurringExpenses: [], otherExpenses: [] });
    expect(() => readLegacyFinanceState({ getItem: () => '{}' })).toThrow('Datos locales inválidos');
  });

  it('deletes legacy keys and records the completed migration', () => {
    const storage = { removeItem: vi.fn(), setItem: vi.fn() };
    clearLegacyFinanceState(storage);
    expect(storage.removeItem.mock.calls.map((call) => call[0])).toEqual([...LEGACY_FINANCE_KEYS]);
    expect(storage.setItem).toHaveBeenCalledWith(LEGACY_FINANCE_MIGRATED_KEY, expect.any(String));
  });
});
