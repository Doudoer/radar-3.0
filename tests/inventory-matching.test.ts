import { describe, expect, it } from 'vitest';
import type { InventoryPart } from '../src/types';
import { matchOrderInventory, type InventoryMatchOrder } from '../src/utils/inventoryMatching';

const order: InventoryMatchOrder = {
  mainPart: 'Engine', productSpecs: '2.4L AWD', vehicle: { make: 'Toyota', model: 'Camry', year: 2020 },
};
const part: InventoryPart = {
  id: '1', year: '2019', yearFrom: '2018', yearTo: '2021', brand: 'TOYOTA',
  model: 'Camry', partType: 'Motor', engineSpecs: '2.4L AWD', status: 'disponible', cost: 800, price: 1100,
};
describe('conservative order inventory matching', () => {
  it('finds available parts by normalized type, make, model, range and specs without exposing cost', () => {
    const match = matchOrderInventory(order, [part]);
    expect(match.state).toBe('available');
    expect(match.availableCount).toBe(1);
    expect(match.candidates[0].level).toBe('matching');
    expect(match.candidates[0].part).not.toHaveProperty('cost');
  });
  it('rejects explicit make, model, type, year, displacement, traction and transmission mismatches', () => {
    for (const change of [
      { brand: 'Ford' }, { model: 'Corolla' }, { partType: 'Transmisión' },
      { yearFrom: '2021' }, { engineSpecs: '3.5L AWD' }, { engineSpecs: '2.4L FWD' },
    ]) expect(matchOrderInventory(order, [{ ...part, ...change }]).state).toBe('none');
    expect(matchOrderInventory({ ...order, productSpecs: 'AT' }, [{ ...part, engineSpecs: 'MT' }]).state).toBe('none');
  });
  it('does not imply mechanical compatibility from incomplete inventory fields or vague specs', () => {
    for (const change of [{ model: '' }, { engineSpecs: '' }, { yearFrom: '', yearTo: '', year: '' }, { yearTo: '' }]) {
      const result = matchOrderInventory(order, [{ ...part, ...change }]);
      expect(result.state).toBe('possible');
      expect(result.candidates[0].pendingChecks.length).toBeGreaterThan(0);
    }
    expect(matchOrderInventory({ ...order, productSpecs: '' }, [part]).state).toBe('possible');
  });
  it('honors exact years, one-sided ranges, and flags invalid ranges rather than claiming a match', () => {
    expect(matchOrderInventory(order, [{ ...part, isExactYearOnly: true }]).state).toBe('none');
    expect(matchOrderInventory(order, [{ ...part, yearFrom: '2022', yearTo: '' }]).state).toBe('none');
    expect(matchOrderInventory(order, [{ ...part, yearFrom: '', yearTo: '2018' }]).state).toBe('none');
    expect(matchOrderInventory(order, [{ ...part, yearFrom: '2022', yearTo: '2018' }]).state).toBe('possible');
  });
  it('excludes sold and review-only stock, distinguishes reserved matches, and counts only available candidates', () => {
    expect(matchOrderInventory(order, [{ ...part, status: 'vendido' }]).state).toBe('none');
    expect(matchOrderInventory(order, [{ ...part, status: 'en_revision' }]).state).toBe('none');
    expect(matchOrderInventory(order, [{ ...part, status: 'reservado' }]).state).toBe('reserved');
    expect(matchOrderInventory(order, [part, { ...part, id: '2', status: 'reservado' }]).availableCount).toBe(1);
  });
  it('reports incomplete order data and keeps explicit assignment separate from suggestions', () => {
    expect(matchOrderInventory({ ...order, vehicle: { ...order.vehicle, model: '' } }, [part]).state).toBe('incomplete');
    expect(matchOrderInventory({ ...order, mainPart: 'Refacción' }, [part]).state).toBe('incomplete');
    const linked = matchOrderInventory({ ...order, inventoryPartId: 1 }, [part]);
    expect(linked.state).toBe('linked');
    expect(linked.linkedPart?.id).toBe('1');
    expect(linked.linkedPart).not.toHaveProperty('cost');
    expect(linked.candidates).toEqual([]);
  });
});
