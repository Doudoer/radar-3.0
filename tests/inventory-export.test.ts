import { describe, expect, it } from 'vitest';
import type { InventoryPart } from '../src/types';
import { filterInventory, inventoryCsv } from '../src/utils/inventoryExport';
const parts: InventoryPart[] = [
  { id: '1', year: '2020', brand: 'Toyota', model: 'Camry', partType: 'Motor', status: 'disponible',
    vin: '00123456789012345', notes: 'Probado, "sin fugas"\nEn almacén', cost: 700, price: 950.35 },
  { id: '2', year: '2018', brand: 'Ford', model: 'F150', partType: 'Transmisión', status: 'reservado', price: 0 },
];
describe('Google Sheets inventory CSV', () => {
  it('exports UTF8 BOM, escaped multiline fields and decimal values with all rows', () => {
    const csv = inventoryCsv(parts);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Probado, ""sin fugas""\nEn almacén"');
    expect(csv).toContain('"950.35"');
    expect(csv).toContain('"00123456789012345"');
    expect(csv).toContain('Transmisión');
    expect(csv).toContain('"2","Transmisión","Ford"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
  it('omits internal cost unless explicitly authorized by the server', () => {
    expect(inventoryCsv(parts)).not.toContain('Costo interno');
    expect(inventoryCsv(parts)).not.toContain('"700"');
    expect(inventoryCsv(parts, true)).toContain('"Costo interno USD"');
    expect(inventoryCsv(parts, true)).toContain('"700"');
  });
  it('neutralizes formulas including whitespace and control-character prefixes', () => {
    for (const value of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\t=1+1', ' \r=1+1']) {
      expect(inventoryCsv([{ ...parts[0], notes: value }])).toContain(`"'${value}"`);
    }
  });
  it('uses the same search, type and status filters as the inventory screen', () => {
    expect(filterInventory(parts, { query: 'camry', status: 'disponible', type: 'Motor' })).toEqual([parts[0]]);
    expect(filterInventory(parts, { query: 'sin fugas' })).toEqual([parts[0]]);
    expect(filterInventory(parts, { status: 'reservado' })).toEqual([parts[1]]);
    expect(filterInventory(parts, { type: 'Transmisión', status: 'disponible' })).toEqual([]);
    expect(filterInventory(parts, {})).toHaveLength(2);
    expect(inventoryCsv([]).split('\r\n')).toHaveLength(2);
  });
});
