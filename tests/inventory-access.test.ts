import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { canReadInventory, inventoryForRole, INVENTORY_READ_ROLES } from '../src/server/inventory';

const partRow = {
  id: 12,
  year: '2020',
  brand: 'Toyota',
  model: 'Camry',
  part_type: 'Motor',
  vin: '1HGCM82633A004352',
  engine_specs: '2.4L',
  status: 'disponible',
  price: '100.00',
  cost: '45.00',
} as RowDataPacket;

describe('inventory read access', () => {
  it('allows the three known roles and denies unknown or missing sessions', () => {
    for (const role of INVENTORY_READ_ROLES) expect(canReadInventory(role)).toBe(true);
    expect(canReadInventory('ADMIN')).toBe(true);
    expect(canReadInventory('invitado')).toBe(false);
    expect(canReadInventory(undefined)).toBe(false);
    expect(canReadInventory(null)).toBe(false);
  });

  it('hides internal cost from everyone except admin', () => {
    expect(inventoryForRole(partRow, 'admin').cost).toBe(45);
    expect(inventoryForRole(partRow, 'operator')).not.toHaveProperty('cost');
    expect(inventoryForRole(partRow, 'vendedor_yarda')).not.toHaveProperty('cost');
    expect(inventoryForRole(partRow, 'vendedor_yarda').vin).toBe('1HGCM82633A004352');
  });
});
