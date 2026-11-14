import { describe, expect, it } from 'vitest';
import type { Order } from '../src/types';
import { mergeOrderSearchResults } from '../src/utils/orderSearch';

const order = (overrides: Partial<Order> = {}): Order => ({
  id: '1',
  code: 'ORD-1',
  createdAt: '',
  advisor: '',
  status: 'pagado',
  mainPart: 'Motor',
  customer: { id: 'c1', name: 'Ana Ruiz', type: 'Particular', email: '', phone: '', location: '', initials: 'AR' },
  vehicle: { vin: '', plate: '', make: 'Toyota', model: 'Camry', year: 2020, mileage: '', color: '' },
  workflowStep: 1,
  financials: { subtotal: 0, total: 0 },
  ...overrides,
} as Order);

describe('mergeOrderSearchResults', () => {
  it('returns the first four loaded orders when the query is empty', () => {
    const local = Array.from({ length: 6 }, (_, index) => order({ id: String(index + 1) }));
    expect(mergeOrderSearchResults(local, [], '   ')).toHaveLength(4);
  });

  it('matches local orders by code, customer, VIN, part, stock and year, case-insensitively', () => {
    const local = [
      order({ id: 'code', code: 'ORD-8924A' }),
      order({ id: 'customer', customer: { id: 'c2', name: 'María López', type: 'Particular', email: '', phone: '', location: '', initials: 'ML' } }),
      order({ id: 'vin', vehicle: { vin: '1HGCM82633A004352', plate: '', make: 'Honda', model: 'Accord', year: 2019, mileage: '', color: '' } }),
      order({ id: 'part', mainPart: 'Transmisión' }),
      order({ id: 'stock', stockNumber: 'STK-7788' }),
      order({ id: 'year', vehicle: { vin: '', plate: '', make: 'Ford', model: 'F150', year: 2015, mileage: '', color: '' } }),
    ];
    expect(mergeOrderSearchResults(local, [], 'ord-8924').map((item) => item.id)).toEqual(['code']);
    expect(mergeOrderSearchResults(local, [], 'maría').map((item) => item.id)).toEqual(['customer']);
    expect(mergeOrderSearchResults(local, [], '1hgcm').map((item) => item.id)).toEqual(['vin']);
    expect(mergeOrderSearchResults(local, [], 'transmi').map((item) => item.id)).toEqual(['part']);
    expect(mergeOrderSearchResults(local, [], 'stk-77').map((item) => item.id)).toEqual(['stock']);
    expect(mergeOrderSearchResults(local, [], '2015').map((item) => item.id)).toEqual(['year']);
  });

  it('appends server results and removes duplicates already loaded locally', () => {
    const local = [order({ id: 'a', code: 'ORD-A' })];
    const remote = [order({ id: 'a', code: 'ORD-A' }), order({ id: 'b', code: 'ORD-B' })];
    expect(mergeOrderSearchResults(local, remote, 'ord-').map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('caps the merged result set at the requested limit', () => {
    const local = [order({ id: 'a' }), order({ id: 'b' })];
    const remote = Array.from({ length: 10 }, (_, index) => order({ id: `r${index}` }));
    expect(mergeOrderSearchResults(local, remote, 'ord-', 5)).toHaveLength(5);
  });

  it('does not include local orders that do not match the query', () => {
    const local = [order({ id: 'match', code: 'ORD-TEST' }), order({ id: 'other', code: 'ORD-OTHER', mainPart: 'Diferencial' })];
    expect(mergeOrderSearchResults(local, [], 'test').map((item) => item.id)).toEqual(['match']);
  });
});
