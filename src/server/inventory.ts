import type { RowDataPacket } from 'mysql2/promise';
import type { InventoryPart } from '../types';

export const mapInventoryPartRow = (row: RowDataPacket): InventoryPart => ({
  id: String(row.id),
  year: String(row.year || ''),
  yearFrom: row.year_from ? String(row.year_from) : '',
  yearTo: row.year_to ? String(row.year_to) : '',
  isExactYearOnly: Boolean(row.is_exact_year_only),
  brand: row.brand || '',
  model: row.model || '',
  partType: row.part_type || 'Motor',
  vin: row.vin || '',
  palletNumber: row.pallet_number || '',
  engineSpecs: row.engine_specs || '',
  status: (row.status || 'disponible').toLowerCase(),
  notes: row.notes || '',
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  soldAt: row.sold_at instanceof Date ? row.sold_at.toISOString() : row.sold_at || null,
  price: Number(row.price || 0),
  cost: Number(row.cost || 0),
});

export function inventoryForRole(row: RowDataPacket, role?: string): InventoryPart {
  const part = mapInventoryPartRow(row);
  if (role !== 'admin') delete part.cost;
  return part;
}
