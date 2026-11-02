import type { InventoryAvailability, InventoryCandidate, InventoryPart } from '../types';

const normalize = (value: string = '') => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const partType = (value: string) => {
  const text = normalize(value);
  if (/\b(motor|engine)\b/.test(text)) return 'motor';
  if (/\b(transmision|transmission)\b/.test(text)) return 'transmision';
  return '';
};
const yearNumber = (value: string | number | undefined) => {
  const text = String(value ?? '');
  return /^\d{4}$/.test(text) && Number(text) >= 1900 && Number(text) <= 2200 ? Number(text) : null;
};
const publicPart = ({ cost: _cost, ...part }: InventoryPart) => part;
const attributes = (text: string) => ({
  displacement: text.match(/\b(\d[.,]\d)\s*l\b/i)?.[1].replace(',', '.'),
  traction: text.match(/\b(4x4|4x2|fwd|awd|rwd)\b/i)?.[1].toLowerCase(),
  transmission: /\b(manual|mt)\b/i.test(text) ? 'mt' : /\b(automatic[ao]?|at)\b/i.test(text) ? 'at' : undefined,
});

export interface InventoryMatchOrder {
  inventoryPartId?: string | number;
  mainPart: string;
  productSpecs?: string;
  vehicle: { year: string | number; make: string; model: string; transmission?: string };
}
export function matchOrderInventory(order: InventoryMatchOrder, parts: InventoryPart[]): InventoryAvailability {
  if (order.inventoryPartId) {
    const linked = parts.find(part => String(part.id) === String(order.inventoryPartId));
    return { state: 'linked', availableCount: 0, candidates: [], linkedPart: linked ? publicPart(linked) : undefined };
  }
  const type = partType(order.mainPart);
  const year = yearNumber(order.vehicle.year);
  if (!type || !year || !normalize(order.vehicle.make) || !normalize(order.vehicle.model)) {
    return { state: 'incomplete', availableCount: 0, candidates: [] };
  }
  const candidates: InventoryCandidate[] = [];
  for (const part of parts) {
    if (!['disponible', 'reservado'].includes(part.status || '') || partType(part.partType) !== type ||
        normalize(part.brand) !== normalize(order.vehicle.make)) continue;
    const pendingChecks: string[] = [];
    if (normalize(part.model) && normalize(part.model) !== normalize(order.vehicle.model)) continue;
    if (!normalize(part.model)) pendingChecks.push('Modelo de inventario sin registrar');
    const hasRange = Boolean(part.yearFrom || part.yearTo);
    let from = yearNumber(part.isExactYearOnly ? part.year : hasRange ? part.yearFrom : part.year);
    let to = yearNumber(part.isExactYearOnly ? part.year : hasRange ? part.yearTo : part.year);
    if (from && to && from > to) { from = null; to = null; }
    if ((from && year < from) || (to && year > to)) continue;
    if (!from || !to) pendingChecks.push('Rango de años incompleto');
    const orderSpecs = `${order.productSpecs || ''} ${order.vehicle.transmission || ''}`;
    const requested = attributes(orderSpecs);
    const stocked = attributes(part.engineSpecs || '');
    if ((Object.keys(requested) as Array<keyof typeof requested>).some(key =>
      requested[key] && stocked[key] && requested[key] !== stocked[key])) continue;
    if (!normalize(order.productSpecs) || !normalize(part.engineSpecs) ||
        normalize(order.productSpecs) !== normalize(part.engineSpecs)) {
      pendingChecks.push('Confirmar especificaciones e intercambiabilidad mecánica');
    }
    candidates.push({
      part: publicPart(part),
      level: pendingChecks.length ? 'possible' : 'matching',
      reasons: ['Tipo de pieza y marca coinciden', ...(part.model ? ['Modelo coincide'] : []),
        ...(from && to ? [`Año dentro de ${from === to ? from : `${from}–${to}`}`] : [])],
      pendingChecks,
    });
  }
  candidates.sort((a, b) => Number(b.part.status === 'disponible') - Number(a.part.status === 'disponible') ||
    Number(a.level === 'possible') - Number(b.level === 'possible') || Number(a.part.id) - Number(b.part.id));
  const available = candidates.filter(candidate => candidate.part.status === 'disponible');
  return {
    state: available.some(candidate => candidate.level === 'matching') ? 'available'
      : available.length ? 'possible' : candidates.length ? 'reserved' : 'none',
    availableCount: available.length,
    candidates,
  };
}

export const inventoryAvailabilityLabel = (availability: InventoryAvailability) => {
  switch (availability.state) {
    case 'linked': return 'Pieza de inventario vinculada';
    case 'available': return `${availability.availableCount} pieza(s) disponibles para revisar`;
    case 'possible': return `${availability.availableCount} posible(s) coincidencia(s): requiere revisión`;
    case 'reserved': return 'Coincidencias reservadas, no disponibles';
    case 'incomplete': return 'Completa vehículo y tipo de pieza para verificar';
    case 'none': return 'Sin coincidencias en inventario';
  }
};
