import React, { useState, useEffect, useMemo } from 'react';
import { InventoryPart, PrefillOrderData } from '../types';
import { inventoryApi } from '../services/inventoryApi';
import { MAKE_MODEL_MAP } from '../data/vehicleData';
import { InventoryPrintModal } from './InventoryPrintModal';
import { filterInventory } from '../utils/inventoryExport';
import { useFeedback } from './FeedbackProvider';

interface InventoryViewProps {
  onOpenNewOrderWithPart?: (prefill: PrefillOrderData) => void;
  userRole?: string;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  onOpenNewOrderWithPart,
  userRole = 'operador',
}) => {
  const [items, setItems] = useState<InventoryPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { toast } = useFeedback();
  const [isExporting, setIsExporting] = useState(false);
  const exportInventory = async (filtered: boolean) => {
    setIsExporting(true);
    setErrorMessage(null);
    try {
      await inventoryApi.download(filtered ? { query: searchQuery, type: typeFilter, status: statusFilter } : {});
      showToast('Inventario CSV descargado. Puedes importarlo en Google Sheets.');
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : 'No se pudo descargar el inventario.');
    } finally { setIsExporting(false); }
  };

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Motor' | 'Transmisión' | 'Transfer Case' | 'Diferencial'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'disponible' | 'reservado' | 'vendido'>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [displacementFilter, setDisplacementFilter] = useState<string>('all');

  // Modal / Editor State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<Partial<InventoryPart>>({});
  const [manualVehicleInput, setManualVehicleInput] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // VIN Decode Status
  const [vinDecodeStatus, setVinDecodeStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [vinDecodeMessage, setVinDecodeMessage] = useState('');

  // Delete Confirmation State
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<InventoryPart | null>(null);

  // Sold Confirmation State
  const [soldConfirmItem, setSoldConfirmItem] = useState<InventoryPart | null>(null);
  const [isMarkingSold, setIsMarkingSold] = useState(false);

  // Detail Card Modal State
  const [selectedDetailItem, setSelectedDetailItem] = useState<InventoryPart | null>(null);
  const [copiedDetailField, setCopiedDetailField] = useState<string | null>(null);

  // Quick suggestion constants
  const COMMON_TRACTIONS = ['4x4', '4x2', 'FWD', 'AWD', 'RWD'] as const;
  const ENGINE_DISPLACEMENT_FAMILIES = [
    {
      family: '4 Cil / Compactos',
      liters: ['1.0L', '1.2L', '1.3L', '1.4L', '1.5L', '1.6L', '1.8L', '2.0L', '2.4L', '2.5L'],
    },
    {
      family: 'V6 / Medianos',
      liters: ['2.7L', '3.0L', '3.2L', '3.3L', '3.5L', '3.6L', '3.7L', '3.8L', '4.0L', '4.3L'],
    },
    {
      family: 'V8 / Grandes',
      liters: ['4.6L', '4.7L', '4.8L', '5.0L', '5.3L', '5.4L', '5.6L', '5.7L', '6.0L', '6.2L', '6.4L'],
    },
    {
      family: 'Heavy Duty / Diesel / V10',
      liters: ['6.6L', '6.7L', '6.8L', '7.3L'],
    },
  ] as const;

  const TOP_FILTER_DISPLACEMENTS = ['1.5L', '2.0L', '2.4L', '2.5L', '3.5L', '3.6L', '4.0L', '4.3L', '5.0L', '5.3L', '5.7L', '6.0L', '6.2L', '6.6L', '6.7L'] as const;

  const COMMON_STATUSES = [
    { value: 'disponible', label: 'Disponible', color: 'emerald', bg: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40' },
    { value: 'vendido', label: 'Vendido', color: 'blue', bg: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40' },
    { value: 'reservado', label: 'HOLD', color: 'amber', bg: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40' },
    { value: 'en_revision', label: 'En Revisión', color: 'purple', bg: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/40' },
  ] as const;

  // Cascading vehicle options
  const yearOptions = useMemo(
    () => Array.from({ length: 37 }, (_, index) => 2026 - index),
    []
  );
  const makeOptions = useMemo(() => Object.keys(MAKE_MODEL_MAP).sort(), []);
  const modelOptions = useMemo(
    () =>
      editingItem.brand
        ? MAKE_MODEL_MAP[editingItem.brand] || []
        : [],
    [editingItem.brand]
  );

  const resolveCatalogMake = (make: string) =>
    makeOptions.find((option) => option.toLowerCase() === make.toLowerCase()) || make;

  const handleYearChange = (yearVal: string) => {
    setEditingItem((prev) => ({
      ...prev,
      year: yearVal,
      yearFrom: prev.isExactYearOnly ? yearVal : prev.yearFrom,
      yearTo: prev.isExactYearOnly ? yearVal : prev.yearTo,
      ...(editorMode === 'create' ? { brand: '', model: '' } : {}),
    }));
  };

  const handleExactYearToggle = (checked: boolean) => {
    setEditingItem((prev) => ({
      ...prev,
      isExactYearOnly: checked,
      yearFrom: checked ? prev.year || '' : prev.yearFrom,
      yearTo: checked ? prev.year || '' : prev.yearTo,
    }));
  };

  const handleBrandChange = (brandVal: string) => {
    setEditingItem((prev) => {
      const isCurrentModelValid = prev.model && MAKE_MODEL_MAP[brandVal]?.includes(prev.model);
      return {
        ...prev,
        brand: brandVal,
        model: isCurrentModelValid ? prev.model : '',
      };
    });
  };

  const handleModelChange = (modelVal: string) => {
    setEditingItem((prev) => ({
      ...prev,
      model: modelVal,
    }));
  };

  const decodeVin = async (vin: string) => {
    const normalizedVin = vin.trim().toUpperCase();
    if (normalizedVin.length !== 17) {
      setVinDecodeStatus('idle');
      setVinDecodeMessage('');
      return;
    }

    setVinDecodeStatus('loading');
    setVinDecodeMessage('Consultando NHTSA...');
    try {
      const response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(normalizedVin)}?format=json`
      );
      if (!response.ok) throw new Error('NHTSA no respondió');
      const payload = await response.json();
      const result = payload.Results?.[0];
      if (!result || result.ErrorCode === '1' || (!result.Make && !result.Model)) {
        throw new Error('VIN no encontrado');
      }

      const resolvedMake = result.Make ? resolveCatalogMake(result.Make) : '';
      const resolvedYear = result.ModelYear && /^\d{4}$/.test(result.ModelYear) ? result.ModelYear : '';
      const resolvedModel = result.Model || '';
      const displacement = result.DisplacementL ? `${parseFloat(result.DisplacementL).toFixed(1)}L` : '';

      setEditingItem((prev) => ({
        ...prev,
        year: resolvedYear || prev.year,
        brand: resolvedMake || prev.brand,
        model: resolvedModel || prev.model,
        engineSpecs: prev.partType === 'Motor' && displacement ? displacement : prev.engineSpecs,
      }));
      setVinDecodeStatus('success');
      setVinDecodeMessage('Datos del vehículo autocompletados desde NHTSA');
    } catch {
      setVinDecodeStatus('error');
      setVinDecodeMessage('No se pudo decodificar este VIN');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleCopyDetail = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedDetailField(fieldName);
    showToast(`Copiado: ${fieldName}`);
    setTimeout(() => setCopiedDetailField(null), 2500);
  };

  const handleCopyFullItemSummary = (item: InventoryPart) => {
    const compat = item.isExactYearOnly
      ? `Solo ${item.year}`
      : item.yearFrom && item.yearTo
      ? `${item.yearFrom} - ${item.yearTo}`
      : item.yearFrom
      ? `Desde ${item.yearFrom}`
      : item.yearTo
      ? `Hasta ${item.yearTo}`
      : 'No especificado';
    const summary = [
      `📦 PIEZA DE INVENTARIO #${item.id}`,
      `🚗 Vehículo: ${item.year} ${item.brand} ${item.model || ''}`.trim(),
      `⚙️ Tipo: ${item.partType} ${item.engineSpecs ? `(${item.engineSpecs})` : ''}`,
      `📅 Compatibilidad: ${compat}`,
      `🏷️ Paleta: ${item.palletNumber || 'S/P'}`,
      `🔍 VIN: ${item.vin || 'N/A'}`,
      `📊 Estado: ${(item.status || 'disponible').toUpperCase()}`,
      item.status === 'vendido' && item.soldAt
        ? `📅 Fecha de Venta: ${new Date(item.soldAt).toLocaleString('es-ES')}`
        : null,
      item.notes ? `📝 Notas: ${item.notes}` : null,
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(summary);
    showToast('Ficha de la pieza copiada al portapapeles.');
  };

  const fetchInventory = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const data = await inventoryApi.list();
      setItems(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al cargar el inventario.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchInventory();
    const refresh = () => { void fetchInventory(); };
    window.addEventListener('radar:inventory-updated', refresh);
    window.addEventListener('radar:data-changed', refresh);
    return () => {
      window.removeEventListener('radar:inventory-updated', refresh);
      window.removeEventListener('radar:data-changed', refresh);
    };
  }, []);

  // Quick stats
  const stats = useMemo(() => {
    const total = items.length;
    const motors = items.filter((i) => (i.partType || '').toLowerCase().includes('motor')).length;
    const transmissions = items.filter((i) => (i.partType || '').toLowerCase().includes('transmi')).length;
    const available = items.filter((i) => (i.status || 'disponible').toLowerCase() === 'disponible').length;
    const sold = items.filter((i) => (i.status || '').toLowerCase() === 'vendido').length;
    const held = items.filter((i) => (i.status || '').toLowerCase() === 'reservado').length;
    const uniquePallets = new Set(items.map((i) => i.palletNumber).filter(Boolean)).size;
    return { total, motors, transmissions, available, sold, held, uniquePallets };
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    const base = filterInventory(items, {
      query: searchQuery, type: typeFilter, status: statusFilter,
    });
    if (displacementFilter === 'all') return base;
    return base.filter(item => {
      const specs = (item.engineSpecs || '').toLowerCase();
      return specs.includes(displacementFilter.toLowerCase());
    });
  }, [items, typeFilter, statusFilter, searchQuery, displacementFilter]);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    displacementFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setTypeFilter('all');
    setStatusFilter('all');
    setDisplacementFilter('all');
  };

  const availableRatio = stats.total > 0 ? (stats.available / stats.total) * 100 : 0;
  const heldRatio = stats.total > 0 ? (stats.held / stats.total) * 100 : 0;
  const soldRatio = stats.total > 0 ? (stats.sold / stats.total) * 100 : 0;

  // Open Create Form
  const handleOpenCreate = () => {
    setEditorMode('create');
    setManualVehicleInput(false);
    setEditingItem({
      year: '',
      yearFrom: '',
      yearTo: '',
      isExactYearOnly: false,
      brand: '',
      model: '',
      partType: 'Motor',
      engineSpecs: '',
      vin: '',
      palletNumber: '',
      status: 'disponible',
      notes: '',
    });
    setVinDecodeStatus('idle');
    setVinDecodeMessage('');
    setIsEditorOpen(true);
  };

  // Open Edit Form
  const handleOpenEdit = (item: InventoryPart) => {
    setEditorMode('edit');
    const isCustom = Boolean(
      (item.brand && !MAKE_MODEL_MAP[item.brand]) ||
      (item.brand && item.model && !MAKE_MODEL_MAP[item.brand]?.includes(item.model))
    );
    setManualVehicleInput(isCustom);
    setEditingItem({
      ...item,
      yearFrom: item.yearFrom || '',
      yearTo: item.yearTo || '',
      isExactYearOnly: Boolean(item.isExactYearOnly),
      status: (item.status || 'disponible').toLowerCase(),
    });
    setVinDecodeStatus('idle');
    setVinDecodeMessage('');
    setIsEditorOpen(true);
  };

  // Save Item (Create or Update)
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem.year?.trim() || !editingItem.brand?.trim()) {
      toast({ title: 'Datos incompletos', message: 'Selecciona primero el Año y luego la Marca.', tone: 'error' });
      return;
    }

    try {
      setIsSaving(true);
      if (editorMode === 'create') {
        const created = await inventoryApi.create(editingItem);
        setItems((prev) => [created, ...prev]);
        showToast('Pieza registrada con éxito.');
      } else if (editingItem.id) {
        const updated = await inventoryApi.update(editingItem.id, editingItem);
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        showToast(`Pieza #${editingItem.id} actualizada con éxito.`);
      }
      setIsEditorOpen(false);
    } catch (err: any) {
      toast({ title: 'No se pudo guardar la pieza', message: err.message || undefined, tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Item
  const handleDeleteItem = async () => {
    if (!deleteConfirmItem) return;
    try {
      await inventoryApi.delete(deleteConfirmItem.id);
      setItems((prev) => prev.filter((i) => i.id !== deleteConfirmItem.id));
      showToast('Pieza eliminada.');
      setDeleteConfirmItem(null);
    } catch (err: any) {
      toast({ title: 'No se pudo eliminar la pieza', message: err.message || undefined, tone: 'error' });
    }
  };

  // Mark as Sold Handler
  const handleConfirmMarkAsSold = async () => {
    if (!soldConfirmItem) return;
    try {
      setIsMarkingSold(true);
      const nowIso = new Date().toISOString();
      const updated = await inventoryApi.update(soldConfirmItem.id, {
        status: 'vendido',
        soldAt: nowIso,
      });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (selectedDetailItem && selectedDetailItem.id === updated.id) {
        setSelectedDetailItem(updated);
      }
      showToast(`Pieza #${soldConfirmItem.id} (${soldConfirmItem.brand} ${soldConfirmItem.model || ''}) marcada como VENDIDA.`);
      setSoldConfirmItem(null);
    } catch (err: any) {
      toast({ title: 'No se pudo marcar la pieza como vendida', message: err.message || undefined, tone: 'error' });
    } finally {
      setIsMarkingSold(false);
    }
  };

  // Reactivate to Available Handler
  const handleReactivateToAvailable = async (item: InventoryPart) => {
    try {
      const updated = await inventoryApi.update(item.id, {
        status: 'disponible',
        soldAt: null,
      });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (selectedDetailItem && selectedDetailItem.id === updated.id) {
        setSelectedDetailItem(updated);
      }
      showToast(`Pieza #${item.id} reactivada a DISPONIBLE.`);
    } catch (err: any) {
      toast({ title: 'No se pudo reactivar la pieza', message: err.message || undefined, tone: 'error' });
    }
  };

  // Convert to Order (Prefill new order modal)
  const handleConvertToOrder = (item: InventoryPart) => {
    if (!onOpenNewOrderWithPart) {
      toast({ title: 'Función no disponible', message: 'La apertura de orden con esta pieza no está habilitada.', tone: 'error' });
      return;
    }
    const prefill: PrefillOrderData = {
      make: item.brand,
      model: item.model,
      year: parseInt(item.year, 10) || undefined,
      mainPart: item.partType || 'Motor',
      productSpecs: item.engineSpecs || '',
      notes: item.notes || '',
      partPrice: item.price ?? 0,
      inventoryPartId: Number(item.id),
      warrantyDays: 60,
    };
    onOpenNewOrderWithPart(prefill);
  };

  const getStatusBadge = (status?: string) => {
    const s = (status || 'disponible').toLowerCase();
    const config = COMMON_STATUSES.find((st) => st.value === s) || COMMON_STATUSES[0];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono uppercase border ${config.bg}`}>
        {s === 'reservado' && (
          <span aria-hidden="true" className="material-symbols-outlined text-[12px]">lock</span>
        )}
        {config.label}
      </span>
    );
  };

  return (
    <div className="radar-view horizon-view horizon-inventory space-y-5 animate-fade-in text-slate-800 dark:text-slate-100 pb-10">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-white dark:bg-[#0c1a30] border border-emerald-500/60 text-emerald-800 dark:text-emerald-300 px-4 py-3 rounded-2xl shadow-lg dark:shadow-[0_0_25px_rgba(16,185,129,0.35)] flex items-center gap-2.5 animate-bounce-subtle">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-emerald-500 dark:text-emerald-400">check_circle</span>
          <span className="text-xs font-mono font-bold">{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="horizon-view-header horizon-inventory-header">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-gradient-to-br dark:from-cyan-500/20 dark:via-blue-500/20 dark:to-emerald-500/20 border border-cyan-200 dark:border-cyan-500/40 flex items-center justify-center text-cyan-600 dark:text-cyan-400 shadow-sm dark:shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[28px]">
                warehouse
              </span>
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-wide uppercase">
                Inventario de Piezas
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                Control y edición de Motores y Transmisiones por Año, Marca, Modelo, VIN, Paleta y Estado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-start xl:justify-end">
            <button
              type="button"
              onClick={fetchInventory}
              disabled={loading}
              aria-label="Actualizar inventario"
              title="Actualizar inventario"
              className="p-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] hover:text-cyan-500 hover:border-cyan-500/40 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span aria-hidden="true" className={`material-symbols-outlined text-[18px] block ${loading ? 'animate-spin' : ''}`}>sync</span>
            </button>
            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              disabled={loading || items.length === 0}
              aria-label="Imprimir reporte por marcas"
              title="Imprimir reporte de inventario clasificado por marcas"
              className="p-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] hover:text-cyan-500 hover:border-cyan-500/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] block">print</span>
            </button>
            <button
              type="button"
              onClick={() => void exportInventory(hasActiveFilters)}
              disabled={loading || isExporting}
              title={hasActiveFilters
                ? 'Descargar solo las piezas que coinciden con la búsqueda y filtros actuales'
                : 'Descargar el inventario completo en CSV'}
              className="px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-xs font-semibold text-[var(--text-secondary)] hover:text-cyan-500 hover:border-cyan-500/40 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">download</span>
              {isExporting ? 'Exportando…' : hasActiveFilters ? `Exportar filtrados (${filteredItems.length})` : 'Exportar CSV'}
            </button>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="horizon-primary px-3.5 py-2.5 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>Agregar pieza</span>
            </button>
          </div>
        </div>

        {/* KPIs 4+1: inventario, disponibilidad, HOLD, ventas + paletas */}
        <div className="horizon-view-metrics grid grid-cols-2 gap-3 mt-5 lg:grid-cols-5">
          <button
            type="button"
            onClick={clearFilters}
            aria-pressed={statusFilter === 'all' && typeFilter === 'all' && displacementFilter === 'all' && !searchQuery.trim()}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
              statusFilter === 'all' && typeFilter === 'all' && displacementFilter === 'all' && !searchQuery.trim()
                ? 'border-cyan-500/60 bg-[var(--bg-card)] ring-1 ring-cyan-500/25'
                : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-cyan-500/40'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-500">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">inventory_2</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Total piezas</span>
              <span className="block font-mono text-lg font-black tabular-nums text-[var(--text-heading)]">{stats.total}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'disponible' ? 'all' : 'disponible')}
            aria-pressed={statusFilter === 'disponible'}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
              statusFilter === 'disponible'
                ? 'border-emerald-500/60 bg-[var(--bg-card)] ring-1 ring-emerald-500/25'
                : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-emerald-500/40'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">check_circle</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Disponibles</span>
              <span className="block font-mono text-lg font-black tabular-nums text-[var(--text-heading)]">{stats.available}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'reservado' ? 'all' : 'reservado')}
            aria-pressed={statusFilter === 'reservado'}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
              statusFilter === 'reservado'
                ? 'border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] ring-1 ring-[var(--state-urgency-border)]'
                : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--state-urgency-border)]'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">lock</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">En HOLD</span>
              <span className="block font-mono text-lg font-black tabular-nums text-[var(--text-heading)]">{stats.held}</span>
              <span className="block text-[10px] text-[var(--text-secondary)]">{stats.held > 0 ? 'Requieren decisión' : 'Nada en espera'}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'vendido' ? 'all' : 'vendido')}
            aria-pressed={statusFilter === 'vendido'}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
              statusFilter === 'vendido'
                ? 'border-blue-500/60 bg-[var(--bg-card)] ring-1 ring-blue-500/25'
                : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-blue-500/40'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-500">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">sell</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Vendidas</span>
              <span className="block font-mono text-lg font-black tabular-nums text-[var(--text-heading)]">{stats.sold}</span>
            </span>
          </button>

          <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3 lg:col-span-1">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--brand-soft)] text-[var(--brand)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">pallet</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Paletas únicas</span>
              <span className="block font-mono text-lg font-black tabular-nums text-[var(--text-heading)]">{stats.uniquePallets}</span>
              <span className="block font-mono text-[10px] text-[var(--text-secondary)]">{stats.motors} motores · {stats.transmissions} transmisiones</span>
            </span>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="rounded-2xl bg-white dark:bg-[#060b17] border border-slate-200 dark:border-cyan-500/20 p-3 sm:p-4 flex flex-col gap-3 shadow-sm dark:shadow-lg">
        {/* Search */}
        <div className="relative w-full">
          <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-cyan-600 dark:text-cyan-400 pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por Año, Marca, Modelo, VIN, Paleta o Notas..."
            className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-[#03060f] border border-slate-200 dark:border-cyan-500/30 rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type Filter */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#03060f] p-1 rounded-xl border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'Motor', label: 'Motores' },
                { id: 'Transmisión', label: 'Transmisiones' },
                { id: 'Transfer Case', label: 'Transfer Case' },
                { id: 'Diferencial', label: 'Diferenciales' },
              ] as const
            ).map((filter) => {
              const isActive = typeFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setTypeFilter(filter.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white dark:bg-cyan-500/30 border border-cyan-500 dark:border-cyan-400 text-cyan-800 dark:text-cyan-300 shadow-sm dark:shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#03060f] p-1 rounded-xl border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'all', label: `Todos (${stats.total})` },
                { id: 'disponible', label: `Disponibles (${stats.available})` },
                { id: 'reservado', label: `HOLD (${stats.held})` },
                { id: 'vendido', label: `Vendidas (${stats.sold})` },
              ] as const
            ).map((filter) => {
              const isActive = statusFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  aria-pressed={isActive}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white dark:bg-cyan-500/30 border border-cyan-500 dark:border-cyan-400 text-cyan-800 dark:text-cyan-300 shadow-sm dark:shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : 'border border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {filter.id === 'reservado' && (
                    <span aria-hidden="true" className="material-symbols-outlined align-middle text-[13px] mr-1">lock</span>
                  )}
                  {filter.label}
                </button>
              );
            })}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:text-cyan-500 transition-colors cursor-pointer flex items-center gap-1"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">filter_alt_off</span>
              Limpiar
            </button>
          )}

          {/* View Mode Toggle: Cards vs Table */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#03060f] p-1 rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
              className={`p-1.5 rounded-lg transition-all flex items-center gap-1 text-xs font-mono font-bold ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-cyan-500/30 text-cyan-800 dark:text-cyan-300 border border-cyan-500 dark:border-cyan-400 shadow-sm'
                  : 'border border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Vista de Tarjetas"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">grid_view</span>
              <span className="hidden lg:inline text-[11px]">Tarjetas</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              className={`p-1.5 rounded-lg transition-all flex items-center gap-1 text-xs font-mono font-bold ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-cyan-500/30 text-cyan-800 dark:text-cyan-300 border border-cyan-500 dark:border-cyan-400 shadow-sm'
                  : 'border border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Vista de Tabla"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">table_rows</span>
              <span className="hidden lg:inline text-[11px]">Tabla</span>
            </button>
          </div>
        </div>
      </div>

      {/* Litraje / Cilindrada Quick Filter Bar (When viewing Motors or All) */}
      {(typeFilter === 'all' || typeFilter === 'Motor') && (
        <div className="rounded-2xl bg-slate-50/70 dark:bg-[#060b17]/60 border border-slate-200 dark:border-slate-800/80 p-3 flex items-center gap-2 overflow-x-auto custom-scrollbar h-scroll-fade">
          <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono text-slate-500 dark:text-slate-400 font-bold uppercase mr-1">
            <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-emerald-500">speed</span>
            <span>Litraje:</span>
          </div>
          <button
            type="button"
            onClick={() => setDisplacementFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold shrink-0 transition-all ${
              displacementFilter === 'all'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-sm'
                : 'bg-white dark:bg-[#080f20] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-emerald-500 hover:border-emerald-500/40'
            }`}
          >
            Todos
          </button>
          {TOP_FILTER_DISPLACEMENTS.map((lit) => {
            const isSelected = displacementFilter === lit;
            return (
              <button
                key={lit}
                type="button"
                onClick={() => setDisplacementFilter(isSelected ? 'all' : lit)}
                className={`px-2 py-1 rounded-lg text-xs font-mono font-bold shrink-0 transition-all border ${
                  isSelected
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-black shadow-sm dark:shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                    : 'bg-white dark:bg-[#080f20] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400'
                }`}
              >
                {lit}
              </button>
            );
          })}
        </div>
      )}

      {/* Error / Loading */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-[var(--state-urgency-tint)] border border-[var(--state-urgency-border)] text-[var(--state-urgency-text)] text-xs font-mono flex items-center gap-2" role="alert">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-[var(--state-urgency)]">error</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {loading && (
        <div className="p-12 flex flex-col items-center justify-center text-center">
          <div className="w-10 h-10 rounded-2xl border-2 border-[var(--brand)] border-t-transparent animate-spin mb-3" />
          <span className="text-xs font-mono text-[var(--text-secondary)]">Cargando inventario...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredItems.length === 0 && (
        <div className="p-12 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] flex flex-col items-center justify-center text-center shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)] mb-3">
            <span aria-hidden="true" className="material-symbols-outlined text-[28px]">
              {hasActiveFilters ? 'search_off' : 'inventory_2'}
            </span>
          </div>
          <h3 className="text-sm font-bold text-[var(--text-heading)]">
            {hasActiveFilters ? 'Sin resultados' : 'No hay piezas registradas'}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] font-mono max-w-sm mt-1">
            {hasActiveFilters
              ? 'Ninguna pieza coincide con la búsqueda y los filtros actuales.'
              : 'Agrega tu primera pieza con Año, Marca, Modelo, Tipo de Pieza, VIN y Número de Paleta.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-4 py-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-xs font-bold text-[var(--text-primary)] hover:border-cyan-500/40 cursor-pointer flex items-center gap-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">filter_alt_off</span>
                Limpiar filtros
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenCreate}
              className="horizon-primary px-4 py-2 text-xs font-bold cursor-pointer flex items-center gap-1.5"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add_circle</span>
              Agregar pieza
            </button>
          </div>
        </div>
      )}

      {/* Inventory Items View (Cards Grid vs Table) */}
      {!loading && filteredItems.length > 0 && viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const isMotor = (item.partType || '').toLowerCase().includes('motor');
            const isTrans = (item.partType || '').toLowerCase().includes('transmi');
            const isAvailable = (item.status || 'disponible').toLowerCase() === 'disponible';
            const isSold = (item.status || '').toLowerCase() === 'vendido';

            return (
              <div
                key={item.id}
                onClick={() => setSelectedDetailItem(item)}
                className="group relative rounded-2xl bg-white dark:bg-[#070d1c] border border-slate-200/90 dark:border-slate-800 hover:border-cyan-500/60 dark:hover:border-cyan-500/50 p-4 sm:p-5 transition-all duration-200 hover:shadow-lg dark:hover:shadow-[0_8px_30px_rgba(6,182,212,0.15)] flex flex-col justify-between gap-4 cursor-pointer"
              >
                {/* Header: Pallet #, ID & Status Badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-xl text-xs font-black font-mono bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30 flex items-center gap-1 shadow-xs">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">pallet</span>
                      <span>{item.palletNumber || 'S/P'}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 font-bold">
                      #{item.id}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {getStatusBadge(item.status)}
                  </div>
                </div>

                {/* Main Vehicle Info */}
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2.5">
                    <div className={`p-2 rounded-xl shrink-0 ${
                      isMotor
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : isTrans
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30'
                    }`}>
                      <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                        {isMotor ? 'settings' : isTrans ? 'swap_driving_apps' : 'handyman'}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-wide truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors">
                        {item.year} {item.brand} {item.model || ''}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                        <span>{item.partType}</span>
                        {item.price ? (
                          <>
                            <span>•</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                              ${item.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Compatibility & Specs Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {/* Litraje / Tracción Badge */}
                    {item.engineSpecs && (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-mono font-black border ${
                        isMotor
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 shadow-xs'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 shadow-xs'
                      }`}>
                        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
                          {isMotor ? 'speed' : 'alt_route'}
                        </span>
                        <span>{item.engineSpecs}</span>
                      </span>
                    )}

                    {/* Compatibility Badge */}
                    {item.isExactYearOnly ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                        <span aria-hidden="true" className="material-symbols-outlined text-[12px]">lock</span>
                        <span>Solo {item.year}</span>
                      </span>
                    ) : (item.yearFrom || item.yearTo) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                        <span aria-hidden="true" className="material-symbols-outlined text-[12px]">event_repeat</span>
                        <span>
                          {item.yearFrom && item.yearTo ? `${item.yearFrom} - ${item.yearTo}` : item.yearFrom ? `Desde ${item.yearFrom}` : `Hasta ${item.yearTo}`}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {/* VIN chip with fast copy */}
                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60 p-2 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="flex items-center gap-1 truncate text-cyan-700 dark:text-cyan-300 font-semibold tracking-wider">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">fingerprint</span>
                      <span>{item.vin || 'Sin VIN registrado'}</span>
                    </span>
                    {item.vin && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleCopyDetail(item.vin!, 'VIN'); }}
                        className="px-2 py-0.5 rounded-md text-[10px] bg-slate-200 dark:bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-700 dark:text-slate-300 font-bold transition-all shrink-0"
                        title="Copiar VIN"
                      >
                        Copiar
                      </button>
                    )}
                  </div>

                  {/* Notes snippet */}
                  {item.notes && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 italic line-clamp-1 pt-0.5 flex items-center gap-1">
                      <span aria-hidden="true" className="material-symbols-outlined text-[13px] text-slate-400 shrink-0">notes</span>
                      <span className="truncate">{item.notes}</span>
                    </p>
                  )}
                </div>

                {/* Footer Action Buttons */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(item)}
                      className="p-1.5 rounded-xl text-slate-500 hover:text-amber-500 dark:text-slate-400 dark:hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                      title="Editar pieza"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmItem(item)}
                      className="p-1.5 rounded-xl text-[var(--text-secondary)] hover:text-[var(--state-urgency-text)] hover:bg-[var(--state-urgency-tint)] transition-colors"
                      title="Eliminar pieza"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isAvailable ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setSoldConfirmItem(item)}
                          className="px-2.5 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-500/30 text-xs font-bold font-mono transition-all flex items-center gap-1"
                          title="Marcar como vendida"
                        >
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">sell</span>
                          <span>Vendida</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConvertToOrder(item)}
                          className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 text-xs font-black font-mono transition-all flex items-center gap-1 shadow-sm"
                          title="Crear orden con esta pieza"
                        >
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">shopping_cart</span>
                          <span>Crear Orden</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReactivateToAvailable(item)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 text-xs font-bold font-mono transition-all flex items-center gap-1"
                        title="Reactivar pieza a Disponible"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">restart_alt</span>
                        <span>Reactivar</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View of Inventory Items */}
      {!loading && filteredItems.length > 0 && viewMode === 'table' && (
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] overflow-hidden shadow-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-[var(--text-secondary)]">inventory_2</span>
              <span className="text-xs font-bold text-[var(--text-primary)]">Disponibilidad</span>
              <span className="font-mono text-xs font-black tabular-nums text-emerald-500">{Math.round(availableRatio)}%</span>
            </div>
            <div
              className="flex h-2 min-w-[150px] flex-1 overflow-hidden rounded-full bg-[var(--bg-input)]"
              role="img"
              aria-label={`Disponibles ${stats.available}, en HOLD ${stats.held}, vendidas ${stats.sold} de ${stats.total} piezas`}
            >
              <span className="bg-emerald-500" style={{ width: `${availableRatio}%` }} />
              <span className="bg-[var(--state-urgency)]" style={{ width: `${heldRatio}%` }} />
              <span className="bg-slate-400/80" style={{ width: `${soldRatio}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {stats.available} disponibles
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--state-urgency)]" />
                {stats.held} en HOLD
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                {stats.sold} vendidas
              </span>
            </div>
            <span className="ml-auto font-mono text-[11px] font-semibold text-[var(--text-secondary)] tabular-nums">
              {filteredItems.length} de {stats.total}
            </span>
          </div>
          <div className="table-responsive-wrapper custom-scrollbar">
            <table className="w-full text-left text-xs font-mono border-collapse min-w-[720px] table-fixed">
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[24%]" />
                <col className="w-[23%]" />
                <col className="w-[16%]" />
                <col className="w-[11%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead>
                <tr className="bg-[var(--bg-card-subtle)] border-b border-[var(--border-color)] text-[var(--text-secondary)] uppercase text-[10px]">
                  <th className="py-3 px-3">Paleta #</th>
                  <th className="py-3 px-3">Vehículo</th>
                  <th className="py-3 px-3">Pieza</th>
                  <th className="py-3 px-3">VIN</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-primary)]">
                {filteredItems.map((item) => {
                  const isMotor = (item.partType || '').toLowerCase().includes('motor');
                  const isHeld = (item.status || '').toLowerCase() === 'reservado';
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedDetailItem(item)}
                      onDoubleClick={() => handleOpenEdit(item)}
                      className={`hover:bg-[var(--bg-card-subtle)] transition-colors cursor-pointer group border-l-2 ${isHeld ? 'border-l-[var(--state-urgency)]' : 'border-l-transparent'}`}
                      title="Clic para ver ficha completa | Doble clic para editar"
                    >
                      {/* Pallet # */}
                      <td className="py-3 px-3">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40 shadow-xs dark:shadow-[0_0_10px_rgba(59,130,246,0.2)]">
                          {item.palletNumber || 'S/P'}
                        </span>
                      </td>

                      {/* Vehículo: año + compatibilidad + marca/modelo */}
                      <td className="min-w-0 py-3 px-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-amber-800 dark:text-amber-300 text-xs">{item.year}</span>
                            {item.isExactYearOnly ? (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30 text-[9px] font-mono font-semibold"
                                title="Compatible únicamente con el año de fabricación"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-[10px]">lock</span>
                                <span>Solo {item.year}</span>
                              </span>
                            ) : (item.yearFrom || item.yearTo) ? (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 border border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30 text-[9px] font-mono font-semibold"
                                title="Rango de compatibilidad de años"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-[10px]">event_repeat</span>
                                <span>
                                  {item.yearFrom && item.yearTo
                                    ? `${item.yearFrom} - ${item.yearTo}`
                                    : item.yearFrom
                                    ? `Desde ${item.yearFrom}`
                                    : `Hasta ${item.yearTo}`}
                                </span>
                              </span>
                            ) : null}
                          </div>
                          <span className="truncate font-black text-[var(--text-heading)]" title={`${item.brand} ${item.model || ''}`}>
                            {item.brand}{' '}
                            {item.model || <span className="font-normal italic text-[var(--text-secondary)]">Sin modelo</span>}
                          </span>
                        </div>
                      </td>

                      {/* Part Type & Specs (Motor with Liters / Transmission with Traction) */}
                      <td className="min-w-0 py-3 px-3">
                        <div className="flex flex-col gap-1 items-start">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold uppercase ${
                                isMotor
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40'
                                  : 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40'
                              }`}
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                                {isMotor ? 'settings' : 'swap_driving_apps'}
                              </span>
                              <span>{item.partType}</span>
                            </span>

                            {item.engineSpecs && (
                              <span
                                className={`px-2 py-0.5 rounded-md text-[11px] font-black font-mono border ${
                                  isMotor
                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-200 dark:border-emerald-500/50 shadow-xs dark:shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                                    : 'bg-amber-50 text-amber-950 border-amber-300 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-500/50 shadow-xs dark:shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                                }`}
                              >
                                {item.engineSpecs}
                              </span>
                            )}
                          </div>

                          {item.notes && (
                            <span className="flex w-full min-w-0 items-center gap-1 line-clamp-1 text-[10px] italic text-slate-500 dark:text-slate-400 font-sans">
                              <span aria-hidden="true" className="material-symbols-outlined text-[12px] text-cyan-600 dark:text-cyan-400 shrink-0">notes</span>
                              <span className="truncate" title={item.notes}>{item.notes}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* VIN */}
                      <td className="min-w-0 py-3 px-3 font-mono font-medium tracking-wider text-cyan-800 dark:text-cyan-300">
                        <span className="block truncate" title={item.vin || undefined}>
                          {item.vin || '—'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3">
                        <div className="flex flex-col items-start gap-1">
                          {getStatusBadge(item.status)}
                          {item.status === 'vendido' && item.soldAt && (
                            <span
                              className="text-[9px] font-mono text-blue-700 dark:text-blue-300/90 flex items-center gap-0.5"
                              title={`Fecha de salida: ${new Date(item.soldAt).toLocaleString('es-ES')}`}
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[11px] text-blue-600 dark:text-blue-400">schedule</span>
                              <span>
                                {new Date(item.soldAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })}
                              </span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {item.status !== 'vendido' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleConvertToOrder(item)}
                                aria-label="Crear orden con esta pieza"
                                className="p-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 transition-colors cursor-pointer"
                                title="Crear orden con esta pieza"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-[16px] block">shopping_cart</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setSoldConfirmItem(item)}
                                aria-label="Marcar como vendida"
                                className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30 transition-colors cursor-pointer"
                                title="Marcar como vendida y registrar fecha de salida"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-[16px] block">sell</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleReactivateToAvailable(item)}
                              aria-label="Reactivar pieza a disponible"
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 transition-colors cursor-pointer"
                              title="Reactivar pieza a Disponible"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[16px] block">restart_alt</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenEdit(item)}
                            aria-label="Editar pieza"
                            className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                            title="Editar pieza"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px] block">edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteConfirmItem(item)}
                            aria-label="Eliminar pieza"
                            className="p-1.5 rounded-lg bg-[var(--state-urgency-tint)] hover:brightness-95 text-[var(--state-urgency-text)] border border-[var(--state-urgency-border)] transition-colors cursor-pointer"
                            title="Eliminar pieza"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px] block">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Editor Modal (Create or Edit) */}
      {/* Editor Modal */}
      {isEditorOpen && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 dark:bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-[#070c18] border border-slate-200 dark:border-cyan-500/40 shadow-2xl dark:shadow-[0_20px_60px_rgba(0,0,0,0.9)] text-slate-800 dark:text-slate-100 max-h-[min(94vh,700px)] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-cyan-500/20 bg-slate-50 dark:bg-[#0a1022]/90 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-slate-950 font-black shadow-sm dark:shadow-[0_0_15px_rgba(6,182,212,0.4)] shrink-0 ${
                  editorMode === 'create'
                    ? 'bg-gradient-to-br from-cyan-500 to-emerald-500'
                    : 'bg-gradient-to-br from-amber-400 to-amber-600'
                }`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                    {editorMode === 'create' ? 'add_circle' : 'edit'}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-wide">
                      {editorMode === 'create' ? 'Registrar Pieza' : 'Editar Pieza'}
                    </h2>
                    {editorMode === 'edit' && editingItem.id && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40 text-[10px] font-mono font-bold">
                        #{editingItem.id}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {editorMode === 'create'
                      ? 'Datos requeridos y especificaciones de inventario'
                      : 'Modifica cualquier dato, especificación o estado de la pieza'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveItem} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-4 sm:p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 font-mono text-xs">
              {/* Toggle manual vs catalog */}
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setManualVehicleInput(!manualVehicleInput)}
                  className="text-[11px] text-cyan-700 hover:text-cyan-800 dark:text-cyan-400 dark:hover:text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                    {manualVehicleInput ? 'list' : 'edit_note'}
                  </span>
                  <span>{manualVehicleInput ? 'Usar catálogo de marcas' : 'Escribir marca/modelo manual'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 1. Año */}
                <div>
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1">
                    Año de Fabricación <span className="text-[var(--state-urgency-text)]">*</span>
                  </label>
                  <select
                    required
                    value={editingItem.year || ''}
                    onChange={(e) => handleYearChange(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/40 rounded-xl p-2.5 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 cursor-pointer text-xs"
                  >
                    <option value="">Selecciona año</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>

                {/* 2. Marca */}
                <div>
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1">
                    Marca <span className="text-[var(--state-urgency-text)]">*</span>
                  </label>
                  {manualVehicleInput ? (
                    <input
                      type="text"
                      required
                      value={editingItem.brand || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, brand: e.target.value })}
                      placeholder="Ej: Chevrolet, Ford, Toyota..."
                      className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 text-xs"
                    />
                  ) : (
                    <select
                      required
                      disabled={!editingItem.year}
                      value={editingItem.brand || ''}
                      onChange={(e) => handleBrandChange(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
                    >
                      <option value="">
                        {editingItem.year ? 'Selecciona marca' : 'Primero selecciona año'}
                      </option>
                      {editingItem.brand && !makeOptions.includes(editingItem.brand) && (
                        <option value={editingItem.brand}>{editingItem.brand}</option>
                      )}
                      {makeOptions.map((make) => (
                        <option key={make} value={make}>{make}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 3. Modelo (Opcional) */}
                <div>
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1 flex items-center justify-between">
                    <span>Modelo</span>
                    <span className="text-slate-400 dark:text-slate-500 font-normal text-[10px]">(Opcional)</span>
                  </label>
                  {manualVehicleInput ? (
                    <input
                      type="text"
                      value={editingItem.model || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, model: e.target.value })}
                      placeholder="Ej: Silverado 1500, F-150, Camry... (Opcional)"
                      className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 text-xs"
                    />
                  ) : (
                    <select
                      disabled={!editingItem.brand}
                      value={editingItem.model || ''}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
                    >
                      <option value="">
                        {editingItem.brand ? 'Sin modelo específico (Opcional)' : 'Primero selecciona marca'}
                      </option>
                      {editingItem.model && !modelOptions.includes(editingItem.model) && (
                        <option value={editingItem.model}>{editingItem.model}</option>
                      )}
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 4. Tipo de Pieza (Motor / Transmisión) */}
                <div>
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1">
                    Tipo de Pieza <span className="text-[var(--state-urgency-text)]">*</span>
                  </label>
                  <select
                    value={editingItem.partType || 'Motor'}
                    onChange={(e) => {
                      const nextType = e.target.value;
                      setEditingItem({
                        ...editingItem,
                        partType: nextType,
                        engineSpecs: nextType === 'Transmisión' && !COMMON_TRACTIONS.includes(editingItem.engineSpecs as any) ? '4x4' : editingItem.engineSpecs,
                      });
                    }}
                    className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2.5 text-emerald-800 dark:text-emerald-300 font-bold focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 cursor-pointer text-xs"
                  >
                    <option value="Motor">⚙️ Motor</option>
                    <option value="Transmisión">🔄 Transmisión</option>
                    <option value="Transfer Case">⛓️ Transfer Case</option>
                    <option value="Diferencial">🛞 Diferencial</option>
                  </select>
                </div>

                {/* Compatibilidad de Años (Desde / Hasta & Checkbox Solo año de fabricación) */}
                <div className="sm:col-span-2 rounded-2xl bg-slate-50 dark:bg-[#040814]/90 border border-slate-200 dark:border-cyan-500/30 p-3.5 space-y-3 shadow-inner">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-cyan-600 dark:text-cyan-400">calendar_month</span>
                      <span className="text-xs font-bold text-slate-900 dark:text-white tracking-wide uppercase">Años Compatibles</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal font-mono">(Opcional)</span>
                    </div>

                    {/* Checkbox: Solo compatible con el año de fabricación */}
                    <label className="flex items-center gap-2 cursor-pointer select-none group bg-white dark:bg-[#070e1c] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700/80 hover:border-amber-500/50 transition-colors shadow-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(editingItem.isExactYearOnly)}
                        onChange={(e) => handleExactYearToggle(e.target.checked)}
                        className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 cursor-pointer accent-amber-500"
                      />
                      <span className="text-[11px] font-bold text-amber-900 dark:text-amber-300 group-hover:text-amber-950 dark:group-hover:text-amber-200 flex items-center gap-1">
                        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
                          {editingItem.isExactYearOnly ? 'lock' : 'lock_open'}
                        </span>
                        <span>Solo compatible con año de fabricación ({editingItem.year || '—'})</span>
                      </span>
                    </label>
                  </div>

                  {/* Inputs Desde / Hasta */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Año Desde */}
                    <div>
                      <label className="text-[10px] text-slate-700 dark:text-slate-300 font-bold block mb-1 flex items-center justify-between">
                        <span>Compatible Desde (Año Inicial)</span>
                        {editingItem.isExactYearOnly && (
                          <span className="text-[9px] text-amber-700 dark:text-amber-400 font-mono flex items-center gap-0.5 font-bold">
                            <span aria-hidden="true" className="material-symbols-outlined text-[10px]">lock</span> Bloqueado al año {editingItem.year || ''}
                          </span>
                        )}
                      </label>
                      <select
                        disabled={Boolean(editingItem.isExactYearOnly)}
                        value={editingItem.yearFrom || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, yearFrom: e.target.value })}
                        className="w-full bg-white dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50 disabled:bg-slate-100 dark:disabled:bg-slate-900/80 cursor-pointer"
                      >
                        <option value="">(Opcional) Selecciona año desde</option>
                        {yearOptions.map((y) => (
                          <option key={`from-${y}`} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>

                    {/* Año Hasta */}
                    <div>
                      <label className="text-[10px] text-slate-700 dark:text-slate-300 font-bold block mb-1 flex items-center justify-between">
                        <span>Compatible Hasta (Año Final)</span>
                        {editingItem.isExactYearOnly && (
                          <span className="text-[9px] text-amber-700 dark:text-amber-400 font-mono flex items-center gap-0.5 font-bold">
                            <span aria-hidden="true" className="material-symbols-outlined text-[10px]">lock</span> Bloqueado al año {editingItem.year || ''}
                          </span>
                        )}
                      </label>
                      <select
                        disabled={Boolean(editingItem.isExactYearOnly)}
                        value={editingItem.yearTo || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, yearTo: e.target.value })}
                        className="w-full bg-white dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50 disabled:bg-slate-100 dark:disabled:bg-slate-900/80 cursor-pointer"
                      >
                        <option value="">(Opcional) Selecciona año hasta</option>
                        {yearOptions.map((y) => (
                          <option key={`to-${y}`} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Shortcuts & Helpers when not exact year locked */}
                  {!editingItem.isExactYearOnly && editingItem.year && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">Atajos de rango:</span>
                      <button
                        type="button"
                        onClick={() => {
                          const yr = editingItem.year || '';
                          setEditingItem({ ...editingItem, yearFrom: yr, yearTo: yr });
                        }}
                        className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-cyan-800 dark:text-cyan-300 text-[10px] font-mono cursor-pointer transition-colors border border-slate-200 dark:border-slate-700 shadow-xs"
                      >
                        Mismo año ({editingItem.year})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base = parseInt(editingItem.year || '2020', 10);
                          setEditingItem({ ...editingItem, yearFrom: String(base - 1), yearTo: String(base + 1) });
                        }}
                        className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-cyan-800 dark:text-cyan-300 text-[10px] font-mono cursor-pointer transition-colors border border-slate-200 dark:border-slate-700 shadow-xs"
                      >
                        ±1 Año ({parseInt(editingItem.year || '2020', 10) - 1} - {parseInt(editingItem.year || '2020', 10) + 1})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base = parseInt(editingItem.year || '2020', 10);
                          setEditingItem({ ...editingItem, yearFrom: String(base - 2), yearTo: String(base + 2) });
                        }}
                        className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-cyan-800 dark:text-cyan-300 text-[10px] font-mono cursor-pointer transition-colors border border-slate-200 dark:border-slate-700 shadow-xs"
                      >
                        ±2 Años ({parseInt(editingItem.year || '2020', 10) - 2} - {parseInt(editingItem.year || '2020', 10) + 2})
                      </button>
                      {(editingItem.yearFrom || editingItem.yearTo) && (
                        <button
                          type="button"
                          onClick={() => setEditingItem({ ...editingItem, yearFrom: '', yearTo: '' })}
                          className="px-2 py-0.5 rounded bg-[var(--bg-card-subtle)] hover:brightness-95 text-[var(--text-secondary)] text-[10px] font-mono cursor-pointer transition-colors border border-[var(--border-subtle)] shadow-xs"
                        >
                          Limpiar rango
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 5. Dynamic Litraje (para Motor) o Tracción (para Transmisión) */}
                <div className="sm:col-span-2">
                  {editingItem.partType === 'Transmisión' ? (
                    <div>
                      <label className="text-[11px] text-amber-900 dark:text-amber-300 font-bold block mb-1.5 flex items-center justify-between">
                        <span>Tracción de la Transmisión</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">Selecciona opción:</span>
                      </label>
                      <div className="grid grid-cols-5 gap-1.5">
                        {COMMON_TRACTIONS.map((trac) => {
                          const isSelected = editingItem.engineSpecs === trac;
                          return (
                            <button
                              key={trac}
                              type="button"
                              onClick={() => setEditingItem({ ...editingItem, engineSpecs: trac })}
                              className={`py-2 rounded-xl text-xs font-black font-mono transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 shadow-sm dark:shadow-[0_0_15px_rgba(245,158,11,0.5)] scale-[1.02]'
                                  : 'bg-white dark:bg-[#03060f] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-amber-500/50'
                              }`}
                            >
                              {trac}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-[11px] text-emerald-800 dark:text-emerald-300 font-bold block mb-1 flex items-center justify-between">
                        <span>Litraje / Cilindrada del Motor</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">Escribe o selecciona por familia:</span>
                      </label>
                      <input
                        type="text"
                        value={editingItem.engineSpecs || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, engineSpecs: e.target.value })}
                        placeholder="Ej: 1.5L, 2.0L Turbo, 5.3L V8 Vortec, 6.7L Powerstroke..."
                        className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-emerald-500/40 rounded-xl p-2.5 text-emerald-800 dark:text-emerald-200 font-mono font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-xs"
                      />

                      {/* Organized Displacements by Engine Families */}
                      <div className="space-y-2 pt-1">
                        {ENGINE_DISPLACEMENT_FAMILIES.map((group) => (
                          <div key={group.family} className="rounded-xl bg-slate-100/70 dark:bg-[#050914] p-2 border border-slate-200/80 dark:border-slate-800/80">
                            <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
                              {group.family}
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {group.liters.map((lit) => {
                                const isSelected = editingItem.engineSpecs === lit;
                                return (
                                  <button
                                    key={lit}
                                    type="button"
                                    onClick={() => setEditingItem({ ...editingItem, engineSpecs: lit })}
                                    className={`px-2 py-0.5 rounded-lg text-[10px] font-mono cursor-pointer transition-all border ${
                                      isSelected
                                        ? 'bg-emerald-500 text-slate-950 font-black border-emerald-400 shadow-sm dark:shadow-[0_0_8px_rgba(16,185,129,0.4)] scale-105'
                                        : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/40'
                                    }`}
                                  >
                                    {lit}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 6. VIN (Número de Chasis) */}
                <div>
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1">
                    VIN (Número de Chasis)
                  </label>
                  <input
                    type="text"
                    maxLength={17}
                    value={editingItem.vin || ''}
                    onChange={(e) => {
                      const nextVin = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                      setEditingItem({ ...editingItem, vin: nextVin });
                      if (nextVin.length === 17) void decodeVin(nextVin);
                      else {
                        setVinDecodeStatus('idle');
                        setVinDecodeMessage('');
                      }
                    }}
                    onBlur={() => {
                      if (editingItem.vin && editingItem.vin.length === 17) {
                        void decodeVin(editingItem.vin);
                      }
                    }}
                    placeholder="EJ: 1G1BE5SM8H7123456"
                    className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2.5 text-cyan-800 dark:text-cyan-300 uppercase tracking-wider font-mono focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 text-xs"
                  />
                  {vinDecodeMessage && (
                    <span
                      className={`mt-1 block text-[10px] font-medium ${
                        vinDecodeStatus === 'error'
                          ? 'text-[var(--state-urgency-text)]'
                          : vinDecodeStatus === 'success'
                          ? 'text-[var(--state-success)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {vinDecodeMessage}
                    </span>
                  )}
                </div>

                {/* 7. Número de Paleta */}
                <div>
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1">
                    Número de Paleta
                  </label>
                  <input
                    type="text"
                    value={editingItem.palletNumber || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, palletNumber: e.target.value.toUpperCase() })}
                    placeholder="Ej: PAL-104"
                    className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-cyan-500/30 rounded-xl p-2.5 text-blue-800 dark:text-blue-300 font-bold font-mono focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 text-xs"
                  />
                </div>

                {/* 8. Estado de la Pieza */}
                <div className="sm:col-span-2">
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1.5 flex items-center justify-between">
                    <span>Estado del Inventario</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">Disponibilidad de la pieza:</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {COMMON_STATUSES.map((statusOption) => {
                      const isSelected = (editingItem.status || 'disponible').toLowerCase() === statusOption.value;
                      return (
                        <button
                          key={statusOption.value}
                          type="button"
                          onClick={() => setEditingItem({ ...editingItem, status: statusOption.value })}
                          className={`py-2 px-2.5 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer flex items-center justify-center gap-1.5 border ${
                            isSelected
                              ? `${statusOption.bg} shadow-sm dark:shadow-[0_0_12px_rgba(6,182,212,0.3)] scale-[1.02]`
                              : 'bg-white dark:bg-[#03060f] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${
                            statusOption.value === 'disponible' ? 'bg-emerald-500' :
                            statusOption.value === 'reservado' ? 'bg-amber-500' :
                            statusOption.value === 'vendido' ? 'bg-blue-500' : 'bg-purple-500'
                          }`} />
                          <span>{statusOption.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold block mb-1">Precio de venta ($)</label>
                  <input type="number" min="0" step="0.01" value={editingItem.price ?? ''}
                    onChange={event => setEditingItem({ ...editingItem, price: Number(event.target.value) })}
                    className="w-full rounded-xl border p-2.5 bg-transparent" />
                </div>
                {userRole.toLowerCase() === 'admin' && <div>
                  <label className="text-xs font-bold block mb-1">Costo de adquisición ($)</label>
                  <input type="number" min="0" step="0.01" value={editingItem.cost ?? ''}
                    onChange={event => setEditingItem({ ...editingItem, cost: Number(event.target.value) })}
                    className="w-full rounded-xl border p-2.5 bg-transparent" />
                </div>}
                {/* 9. Nota Extra / Observaciones */}
                <div className="sm:col-span-2">
                  <label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold block mb-1 flex items-center gap-1.5">
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-cyan-600 dark:text-cyan-400">notes</span>
                    <span>Nota Extra / Observaciones</span>
                  </label>
                  <input
                    type="text"
                    value={editingItem.notes || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })}
                    placeholder="Ej: Con accesorios, alternador y compresor, probado en yarda, sin fugas..."
                    className="w-full bg-slate-50 dark:bg-[#070e1c] border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500 text-xs"
                  />
                </div>
              </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-200 dark:border-cyan-500/20 bg-slate-50 dark:bg-[#060b17] shrink-0">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold transition-colors cursor-pointer text-xs"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black uppercase tracking-wider transition-all shadow-md dark:shadow-[0_0_20px_rgba(6,182,212,0.4)] cursor-pointer flex items-center gap-2 text-xs hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isSaving ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                      <span>GUARDANDO...</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">save</span>
                      <span>{editorMode === 'create' ? 'GUARDAR PIEZA' : 'GUARDAR CAMBIOS'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Card Modal */}
      {selectedDetailItem && (
        <div 
          className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 dark:bg-black/85 backdrop-blur-md animate-fade-in"
          onClick={() => setSelectedDetailItem(null)}
        >
          <div 
            className="relative w-full max-w-xl rounded-3xl bg-white dark:bg-[#080d1a] border border-slate-200 dark:border-cyan-500/40 shadow-2xl dark:shadow-[0_20px_70px_rgba(0,0,0,0.95)] overflow-hidden text-slate-800 dark:text-slate-100 max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Glowing Gradient Accent */}
            <div className="h-1.5 w-full bg-gradient-to-r from-cyan-500 via-emerald-500 to-blue-500" />

            {/* Modal Header */}
            <div className="p-5 sm:p-6 pb-4 border-b border-slate-200 dark:border-cyan-500/20 bg-slate-50 dark:bg-gradient-to-b dark:from-[#0b1426] dark:to-[#080d1a]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm border shrink-0 ${
                    (selectedDetailItem.partType || '').toLowerCase().includes('motor')
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-400 dark:shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                      : 'bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-400 dark:shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                  }`}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[28px]">
                      {(selectedDetailItem.partType || '').toLowerCase().includes('motor') ? 'settings' : 'swap_driving_apps'}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40 text-xs font-mono font-black">
                        #{selectedDetailItem.id}
                      </span>
                      {selectedDetailItem.palletNumber && (
                        <span className="px-2 py-0.5 rounded-md bg-cyan-100 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/40 text-xs font-mono font-bold">
                          PALETA {selectedDetailItem.palletNumber}
                        </span>
                      )}
                      {getStatusBadge(selectedDetailItem.status)}
                    </div>
                    
                    <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase tracking-wide mt-1">
                      {selectedDetailItem.year} {selectedDetailItem.brand} {selectedDetailItem.model || ''}
                    </h2>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedDetailItem(null)}
                  className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                  title="Cerrar tarjeta"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            {/* Modal Body / Scrollable Info Cards */}
            <div className="p-4 sm:p-6 space-y-3.5 flex-1 min-h-0 overflow-y-auto custom-scrollbar font-mono text-xs">
              {/* Sold Status Banner */}
              {selectedDetailItem.status === 'vendido' && (
                <div className="rounded-2xl bg-blue-50 dark:bg-gradient-to-r dark:from-blue-950/90 dark:via-[#0a1835] dark:to-indigo-950/90 border border-blue-200 dark:border-blue-500/50 p-4 shadow-sm dark:shadow-[0_0_20px_rgba(59,130,246,0.25)] flex items-center justify-between gap-3 flex-wrap animate-fade-in">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 border border-blue-200 dark:bg-blue-500/20 dark:border-blue-500/40 flex items-center justify-center text-blue-700 dark:text-blue-400 shrink-0 shadow-xs dark:shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                      <span aria-hidden="true" className="material-symbols-outlined text-[24px]">sell</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-blue-800 dark:text-blue-300 font-bold uppercase tracking-wider block">
                        Pieza Vendida / Fuera de Disponibles
                      </span>
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        {selectedDetailItem.soldAt ? (
                          `Salida registrada el ${new Date(selectedDetailItem.soldAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                        ) : (
                          'Registrada como Vendida'
                        )}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReactivateToAvailable(selectedDetailItem)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 dark:text-emerald-300 dark:border-emerald-500/40 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105"
                    title="Reactivar pieza a Disponible"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">restart_alt</span>
                    <span>Reactivar a Disponible</span>
                  </button>
                </div>
              )}

              {/* Card 1: Vehículo & Compatibilidad */}
              <div className="rounded-2xl bg-slate-50 dark:bg-[#050914] border border-slate-200 dark:border-cyan-500/25 p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                  <div className="flex items-center gap-2 text-cyan-800 dark:text-cyan-400 font-bold text-xs uppercase tracking-wider">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">directions_car</span>
                    <span>Información del Vehículo</span>
                  </div>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">Datos automotrices</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="rounded-xl bg-white dark:bg-[#080f20] p-2.5 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5 uppercase">Año Fabricación</span>
                    <span className="text-sm font-black text-amber-800 dark:text-amber-300">{selectedDetailItem.year}</span>
                  </div>

                  <div className="rounded-xl bg-white dark:bg-[#080f20] p-2.5 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5 uppercase">Marca</span>
                    <span className="text-sm font-black text-slate-900 dark:text-white">{selectedDetailItem.brand}</span>
                  </div>

                  <div className="rounded-xl bg-white dark:bg-[#080f20] p-2.5 border border-slate-200 dark:border-slate-800 col-span-2 sm:col-span-1 shadow-xs">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5 uppercase">Modelo</span>
                    <span className="text-sm font-black text-slate-800 dark:text-slate-200">
                      {selectedDetailItem.model || <span className="text-slate-400 italic font-normal">Sin modelo</span>}
                    </span>
                  </div>
                </div>

                {/* Compatibilidad de Años */}
                <div className="rounded-xl bg-white dark:bg-[#080f20] p-3 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3 flex-wrap shadow-xs">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-amber-600 dark:text-amber-400">event_repeat</span>
                    <div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block uppercase">Compatibilidad de Años</span>
                      <div className="text-xs font-bold mt-0.5">
                        {selectedDetailItem.isExactYearOnly ? (
                          <span className="text-amber-900 dark:text-amber-300 font-bold flex items-center gap-1">
                            <span aria-hidden="true" className="material-symbols-outlined text-[13px]">lock</span>
                            Solo compatible con año {selectedDetailItem.year} (Fabricación exacta)
                          </span>
                        ) : selectedDetailItem.yearFrom || selectedDetailItem.yearTo ? (
                          <span className="text-cyan-800 dark:text-cyan-300 font-bold">
                            {selectedDetailItem.yearFrom && selectedDetailItem.yearTo
                              ? `Compatible desde ${selectedDetailItem.yearFrom} hasta ${selectedDetailItem.yearTo}`
                              : selectedDetailItem.yearFrom
                              ? `Compatible desde ${selectedDetailItem.yearFrom} en adelante`
                              : `Compatible hasta el año ${selectedDetailItem.yearTo}`}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No especificada (General)</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedDetailItem.yearFrom && selectedDetailItem.yearTo && !selectedDetailItem.isExactYearOnly && (
                    <span className="px-2.5 py-1 rounded-lg bg-cyan-100 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/40 text-[11px] font-black">
                      {selectedDetailItem.yearFrom} – {selectedDetailItem.yearTo}
                    </span>
                  )}
                </div>
              </div>

              {/* Card 2: Especificaciones Técnicas & Mecánicas */}
              <div className="rounded-2xl bg-slate-50 dark:bg-[#050914] border border-slate-200 dark:border-cyan-500/25 p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400 font-bold text-xs uppercase tracking-wider">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">build</span>
                    <span>Especificaciones Técnicas</span>
                  </div>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">Componente mecánico</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="rounded-xl bg-white dark:bg-[#080f20] p-2.5 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5 uppercase">Tipo de Pieza</span>
                      <span className="text-xs font-black text-slate-900 dark:text-white">{selectedDetailItem.partType}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                      (selectedDetailItem.partType || '').toLowerCase().includes('motor')
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40'
                        : 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40'
                    }`}>
                      {selectedDetailItem.partType}
                    </span>
                  </div>

                  <div className="rounded-xl bg-white dark:bg-[#080f20] p-2.5 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5 uppercase">
                        {(selectedDetailItem.partType || '').toLowerCase().includes('transmi') ? 'Tracción' : 'Litraje / Motor'}
                      </span>
                      <span className="text-xs font-black text-cyan-800 dark:text-cyan-300">
                        {selectedDetailItem.engineSpecs || <span className="text-slate-400 italic font-normal">No especificado</span>}
                      </span>
                    </div>
                    {selectedDetailItem.engineSpecs && (
                      <span className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/40 text-xs font-black">
                        {selectedDetailItem.engineSpecs}
                      </span>
                    )}
                  </div>
                </div>

                {/* VIN Card with Copy Button */}
                <div className="rounded-xl bg-white dark:bg-[#080f20] p-2.5 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shadow-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5 uppercase">VIN (Chasis)</span>
                    <span className="text-xs font-mono font-black text-cyan-800 dark:text-cyan-300 tracking-wider">
                      {selectedDetailItem.vin || <span className="text-slate-400 italic font-normal">Sin VIN</span>}
                    </span>
                  </div>

                  {selectedDetailItem.vin && (
                    <button
                      type="button"
                      onClick={() => handleCopyDetail(selectedDetailItem.vin!, 'VIN')}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-cyan-800 dark:text-cyan-300 border border-slate-200 dark:border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                      title="Copiar VIN"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                        {copiedDetailField === 'VIN' ? 'check' : 'content_copy'}
                      </span>
                      <span>{copiedDetailField === 'VIN' ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  )}
                </div>

                {/* Pallet Card */}
                <div className="rounded-xl bg-white dark:bg-[#080f20] p-2.5 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5 uppercase">Ubicación / Paleta</span>
                    <span className="text-xs font-bold text-blue-800 dark:text-blue-300">
                      {selectedDetailItem.palletNumber ? `Paleta: ${selectedDetailItem.palletNumber}` : 'Sin paleta asignada'}
                    </span>
                  </div>
                  {selectedDetailItem.palletNumber && (
                    <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40 text-xs font-black shadow-xs dark:shadow-[0_0_10px_rgba(59,130,246,0.2)]">
                      {selectedDetailItem.palletNumber}
                    </span>
                  )}
                </div>
              </div>

              {/* Card 3: Observaciones & Notas */}
              {selectedDetailItem.notes && (
                <div className="rounded-2xl bg-slate-50 dark:bg-[#050914] border border-slate-200 dark:border-cyan-500/25 p-4 space-y-2 shadow-xs">
                  <div className="flex items-center gap-2 text-slate-800 dark:text-slate-300 font-bold text-xs uppercase tracking-wider">
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-cyan-600 dark:text-cyan-400">notes</span>
                    <span>Notas & Observaciones</span>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-[#080f20] border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 text-xs leading-relaxed shadow-xs">
                    {selectedDetailItem.notes}
                  </div>
                </div>
              )}

              {/* Audit Info (Dates) */}
              {(selectedDetailItem.createdAt || selectedDetailItem.updatedAt) && (
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 px-1">
                  <span>
                    Registrado: {selectedDetailItem.createdAt ? new Date(selectedDetailItem.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                  {selectedDetailItem.updatedAt && (
                    <span>
                      Modificado: {new Date(selectedDetailItem.updatedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-cyan-500/20 bg-slate-50 dark:bg-[#070c18] flex items-center justify-between gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => handleCopyFullItemSummary(selectedDetailItem)}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white border border-slate-300 dark:border-slate-700 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                title="Copiar resumen para mensaje o correo"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">content_copy</span>
                <span>Copiar Ficha</span>
              </button>

              <div className="flex items-center gap-2">
                {selectedDetailItem.status !== 'vendido' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const itemToMark = selectedDetailItem;
                      setSoldConfirmItem(itemToMark);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-blue-100 hover:bg-blue-200 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:hover:bg-blue-500/25 dark:text-blue-300 dark:hover:text-blue-200 dark:border-blue-500/40 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105 shadow-xs"
                    title="Marcar como vendida y registrar fecha de salida"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">sell</span>
                    <span>Marcar Vendida</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleReactivateToAvailable(selectedDetailItem)}
                    className="px-3.5 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:text-emerald-300 dark:hover:text-emerald-200 dark:border-emerald-500/40 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105 shadow-xs"
                    title="Reactivar pieza a Disponible"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">restart_alt</span>
                    <span>Reactivar</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const itemToEdit = selectedDetailItem;
                    setSelectedDetailItem(null);
                    handleOpenEdit(itemToEdit);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 dark:text-amber-300 dark:hover:text-amber-200 dark:border-amber-500/40 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105 shadow-xs"
                  title="Editar datos de esta pieza"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">edit</span>
                  <span>Editar</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const itemToOrder = selectedDetailItem;
                    setSelectedDetailItem(null);
                    handleConvertToOrder(itemToOrder);
                  }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-xs font-mono uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-md dark:shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:scale-105 transition-transform"
                  title="Crear orden de venta o taller con esta pieza"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">shopping_cart</span>
                  <span>Crear Orden</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sold Confirmation Modal */}
      {soldConfirmItem && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-[#080d1a] border border-slate-200 dark:border-blue-500/50 p-6 text-center space-y-4 shadow-2xl dark:shadow-[0_20px_60px_rgba(0,0,0,0.9)] font-mono">
            <div className="w-14 h-14 rounded-2xl bg-blue-100 border border-blue-200 dark:bg-blue-500/20 dark:border-blue-500/40 mx-auto flex items-center justify-center text-blue-700 dark:text-blue-400 shadow-sm dark:shadow-[0_0_20px_rgba(59,130,246,0.3)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[32px]">sell</span>
            </div>
            
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-wide">¿Confirmar Venta de Pieza?</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                La pieza saldrá del inventario de disponibles y quedará archivada en el registro de vendidos con su fecha exacta de salida.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#040814] border border-slate-200 dark:border-slate-800 text-left space-y-2 text-xs shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1.5">
                <span className="text-slate-500 dark:text-slate-400">Pieza:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {soldConfirmItem.year} {soldConfirmItem.brand} {soldConfirmItem.model || ''}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1.5">
                <span className="text-slate-500 dark:text-slate-400">Tipo:</span>
                <span className="font-bold text-emerald-800 dark:text-emerald-300">
                  {soldConfirmItem.partType} {soldConfirmItem.engineSpecs ? `(${soldConfirmItem.engineSpecs})` : ''}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 pb-1.5">
                <span className="text-slate-500 dark:text-slate-400">Paleta / VIN:</span>
                <span className="font-mono text-cyan-800 dark:text-cyan-300 font-semibold">
                  {soldConfirmItem.palletNumber ? `Paleta: ${soldConfirmItem.palletNumber}` : 'S/P'} | {soldConfirmItem.vin || 'Sin VIN'}
                </span>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-blue-700 dark:text-blue-400 font-bold flex items-center gap-1">
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">event_available</span>
                  <span>Fecha de Salida:</span>
                </span>
                <span className="font-black text-blue-800 dark:text-blue-300">
                  {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSoldConfirmItem(null)}
                disabled={isMarkingSold}
                className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer transition-colors shadow-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmMarkAsSold}
                disabled={isMarkingSold}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white text-xs font-black uppercase tracking-wider cursor-pointer shadow-md dark:shadow-[0_0_20px_rgba(59,130,246,0.4)] flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
              >
                {isMarkingSold ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">check_circle</span>
                    <span>Confirmar Venta</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmItem && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-sm rounded-3xl bg-[var(--bg-card)] border border-[var(--border-color)] p-6 text-center space-y-4 shadow-[var(--card-shadow)] font-mono">
            <div className="w-12 h-12 rounded-2xl bg-[var(--state-urgency-tint)] border border-[var(--state-urgency-border)] mx-auto flex items-center justify-center text-[var(--state-urgency)] shadow-sm">
              <span aria-hidden="true" className="material-symbols-outlined text-[28px]">delete</span>
            </div>
            <h3 className="text-base font-bold text-[var(--text-heading)]">¿Eliminar pieza?</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Se eliminará:{' '}
              <strong className="text-[var(--text-heading)] block mt-1">
                {deleteConfirmItem.year} {deleteConfirmItem.brand} {deleteConfirmItem.model} ({deleteConfirmItem.partType})
              </strong>
              {deleteConfirmItem.palletNumber && (
                <span className="text-[var(--brand)] block text-[11px] mt-0.5 font-bold">Paleta: {deleteConfirmItem.palletNumber}</span>
              )}
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmItem(null)}
                className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] hover:brightness-95 text-[var(--text-secondary)] text-xs font-bold cursor-pointer shadow-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteItem}
                className="px-4 py-2 rounded-xl bg-[var(--state-urgency)] hover:brightness-105 text-[var(--state-urgency-ink)] text-xs font-bold cursor-pointer shadow-sm"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inventory Print & Report Modal (Grouped by Brands) */}
      <InventoryPrintModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        items={items}
      />
    </div>
  );
};
