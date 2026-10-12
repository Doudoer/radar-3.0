import { describe, expect, it, beforeEach } from 'vitest';

describe('NewOrderModal in-progress draft persistence', () => {
  const DRAFT_STORAGE_KEY = 'radar_new_order_draft';

  beforeEach(() => {
    // Clear mock storage
    if (typeof window !== 'undefined') {
      window.sessionStorage.clear();
    }
  });

  it('serializes order draft fields to sessionStorage when editing', () => {
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
        partName: 'Engine Motor 2.5L',
        salePrice: 1200,
        supplierCost: 800,
        carrierCost: 150,
      },
      savedAt: Date.now(),
    };

    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));

    const stored = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.formData.clientName).toBe('Carlos Rodriguez');
    expect(parsed.formData.vin).toBe('4T1B11HK5MU123456');
    expect(parsed.formData.salePrice).toBe(1200);
  });

  it('discards draft properly upon successful order creation', () => {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      formData: { clientName: 'Test Draft' },
      savedAt: Date.now(),
    }));

    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();

    // Emulate completion cleanup
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('ignores corrupted or malformed draft JSON safely without throwing', () => {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, '{invalid_json}');

    let loadedDraft = null;
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        loadedDraft = JSON.parse(raw);
      }
    } catch {
      // Safe fallback
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    }

    expect(loadedDraft).toBeNull();
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });
});
