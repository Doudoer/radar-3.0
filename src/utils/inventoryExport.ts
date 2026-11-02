import type { InventoryPart } from '../types';
import { escapeCsvCell } from './csv';

export interface InventoryFilters { query?: string; type?: string; status?: string }
export function filterInventory(items: InventoryPart[], filters: InventoryFilters) {
  const query = filters.query?.trim().toLowerCase() || '';
  return items.filter(item =>
    (!filters.type || filters.type === 'all' || item.partType === filters.type) &&
    (!filters.status || filters.status === 'all' || item.status === filters.status) &&
    (!query || [item.year, item.yearFrom, item.yearTo, item.brand, item.model, item.partType,
      item.vin, item.palletNumber, item.engineSpecs, item.notes, item.status]
      .some(value => String(value || '').toLowerCase().includes(query))));
}

function csvCell(value: string | number | undefined | null) {
  let text = String(value ?? '');
  // Spreadsheet import must not execute user-controlled formulas.
  if (typeof value !== 'number' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return escapeCsvCell(text, true);
}
export function inventoryCsv(items: InventoryPart[], includeCost = false): string {
  const header = ['ID', 'Tipo', 'Marca', 'Modelo', 'Año', 'Compatible desde', 'Compatible hasta',
    'Solo año exacto', 'Especificaciones', 'VIN', 'Paleta', 'Estado', 'Precio USD',
    ...(includeCost ? ['Costo interno USD'] : []), 'Notas', 'Creado', 'Actualizado', 'Vendido'];
  return '\uFEFF' + [header, ...items.map(part => [
    part.id, part.partType, part.brand, part.model, part.year, part.yearFrom, part.yearTo,
    part.isExactYearOnly ? 'Sí' : 'No', part.engineSpecs, part.vin, part.palletNumber, part.status,
    part.price ?? 0, ...(includeCost ? [part.cost ?? 0] : []), part.notes,
    part.createdAt, part.updatedAt, part.soldAt,
  ])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
