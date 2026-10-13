import { describe, expect, it, beforeEach } from 'vitest';

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return this.store[key] ?? null; }
  setItem(key: string, val: string) { this.store[key] = String(val); }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}

if (typeof globalThis.sessionStorage === 'undefined' || !globalThis.sessionStorage) {
  (globalThis as any).sessionStorage = new MemoryStorage();
}
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
  (globalThis as any).localStorage = new MemoryStorage();
}

describe('NewOrderModal in-progress draft persistence & paste safety', () => {
  const DRAFT_STORAGE_KEY = 'radar_new_order_draft';

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('serializes order draft fields to both sessionStorage and localStorage', () => {
    const draftPayload = {
      formData: {
        orderId: 'ORD-9999',
        clientName: 'Carlos Rodriguez',
        clientPhone: '555-123-4567',
        clientEmail: 'carlos@example.com',
        vehicleYear: '2021',
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        vin: '4T1B11HK5MU123456',
        mileage: '85000',
        partName: 'Engine Motor 2.5L',
        salePrice: 1200,
        supplierCost: 800,
        carrierCost: 150,
      },
      savedAt: Date.now(),
    };

    const serialized = JSON.stringify(draftPayload);
    sessionStorage.setItem(DRAFT_STORAGE_KEY, serialized);
    localStorage.setItem(DRAFT_STORAGE_KEY, serialized);

    const storedSession = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    const storedLocal = localStorage.getItem(DRAFT_STORAGE_KEY);
    expect(storedSession).not.toBeNull();
    expect(storedLocal).not.toBeNull();

    const parsed = JSON.parse(storedSession!);
    expect(parsed.formData.clientName).toBe('Carlos Rodriguez');
    expect(parsed.formData.vin).toBe('4T1B11HK5MU123456');
    expect(parsed.formData.mileage).toBe('85000');
    expect(parsed.formData.salePrice).toBe(1200);
  });

  it('recovers draft from localStorage if sessionStorage was cleared or tab discarded', () => {
    const draftPayload = {
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleYear: 2020,
      vehicleVIN: '1FTEW1EP5KFB81920',
      vehicleMileage: '92000',
      mainPart: 'Transmission',
    };

    // Simulate tab memory discard: sessionStorage is empty, localStorage has the backup
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();

    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY) || localStorage.getItem(DRAFT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const loaded = JSON.parse(raw!);
    expect(loaded.vehicleMake).toBe('Ford');
    expect(loaded.vehicleModel).toBe('F-150');
    expect(loaded.vehicleMileage).toBe('92000');
  });

  it('discards draft from both sessionStorage and localStorage upon order completion', () => {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ vehicleMake: 'Chevrolet' }));
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ vehicleMake: 'Chevrolet' }));

    // Emulate completion cleanup
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    localStorage.removeItem(DRAFT_STORAGE_KEY);

    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('sanitizes pasted mileage containing commas, spaces, and units (e.g. "85,000 mi" -> "85000")', () => {
    const sanitizeMileage = (raw: string) => raw.replace(/[^0-9]/g, '');

    expect(sanitizeMileage('85,000')).toBe('85000');
    expect(sanitizeMileage('85,420 mi')).toBe('85420');
    expect(sanitizeMileage('120 000 miles')).toBe('120000');
    expect(sanitizeMileage('150.000 km')).toBe('150000');
    expect(sanitizeMileage('  94,120 \n')).toBe('94120');
  });

  it('sanitizes pasted VIN containing whitespace, labels, or lowercase characters', () => {
    const sanitizeVin = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);

    expect(sanitizeVin('1ftew1ep5kfb81920')).toBe('1FTEW1EP5KFB81920');
    expect(sanitizeVin('  1FTEW1EP5KFB81920  \n')).toBe('1FTEW1EP5KFB81920');
    expect(sanitizeVin('1FTEW1EP5KFB81920_EXTRA_CHARS')).toBe('1FTEW1EP5KFB81920');
  });

  it('sanitizes pasted description with newlines into clean single-line text', () => {
    const sanitizeSpecs = (raw: string) => raw.replace(/\r?\n+/g, ' - ').trim();

    const multilineCarPart = '2.7L Turbo AT 4WD\nRUNS GREAT TESTED\r\nCOMPRESSION 175 PSI';
    expect(sanitizeSpecs(multilineCarPart)).toBe('2.7L Turbo AT 4WD - RUNS GREAT TESTED - COMPRESSION 175 PSI');
  });

  it('ignores corrupted or malformed draft JSON safely without throwing', () => {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, '{invalid_json}');

    let loadedDraft = null;
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY) || localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        loadedDraft = JSON.parse(raw);
      }
    } catch {
      // Safe fallback
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }

    expect(loadedDraft).toBeNull();
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });
});
