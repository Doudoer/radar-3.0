import React, { useState, useEffect, useMemo } from 'react';
import { InventoryPart, PrefillOrderData } from '../types';
import { inventoryApi } from '../services/inventoryApi';
import { MAKE_MODEL_MAP } from '../data/vehicleData';

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

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Motor' | 'Transmisión'>('all');

  // Modal / Editor State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<Partial<InventoryPart>>({});
  const [isSaving, setIsSaving] = useState(false);

  // VIN Decode Status
  const [vinDecodeStatus, setVinDecodeStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [vinDecodeMessage, setVinDecodeMessage] = useState('');

  // Delete Confirmation State
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<InventoryPart | null>(null);

  // Cascading vehicle options
  const yearOptions = useMemo(
    () => Array.from({ length: 37 }, (_, index) => 2026 - index),
    []
  );
  const makeOptions = useMemo(() => Object.keys(MAKE_MODEL_MAP).sort(), []);
  const modelOptions = useMemo(
    () =>
      editingItem.year && editingItem.brand
        ? MAKE_MODEL_MAP[editingItem.brand] || []
        : [],
    [editingItem.year, editingItem.brand]
  );

  const resolveCatalogMake = (make: string) =>
    makeOptions.find((option) => option.toLowerCase() === make.toLowerCase()) || make;

  const handleYearChange = (yearVal: string) => {
    setEditingItem((prev) => ({
      ...prev,
      year: yearVal,
      brand: '',
      model: '',
    }));
  };

  const handleBrandChange = (brandVal: string) => {
    setEditingItem((prev) => ({
      ...prev,
      brand: brandVal,
      model: '',
    }));
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

      setEditingItem((prev) => ({
        ...prev,
        year: resolvedYear || prev.year,
        brand: resolvedMake || prev.brand,
        model: resolvedModel || prev.model,
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
    fetchInventory();
  }, []);

  // Quick stats
  const stats = useMemo(() => {
    const total = items.length;
    const motors = items.filter((i) => (i.partType || '').toLowerCase().includes('motor')).length;
    const transmissions = items.filter((i) => (i.partType || '').toLowerCase().includes('transmi')).length;
    const uniquePallets = new Set(items.map((i) => i.palletNumber).filter(Boolean)).size;
    return { total, motors, transmissions, uniquePallets };
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.partType !== typeFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchBrand = item.brand?.toLowerCase().includes(query);
        const matchModel = item.model?.toLowerCase().includes(query);
        const matchYear = String(item.year || '').toLowerCase().includes(query);
        const matchType = item.partType?.toLowerCase().includes(query);
        const matchVin = item.vin?.toLowerCase().includes(query);
        const matchPallet = item.palletNumber?.toLowerCase().includes(query);
        if (!matchBrand && !matchModel && !matchYear && !matchType && !matchVin && !matchPallet) {
          return false;
        }
      }
      return true;
    });
  }, [items, typeFilter, searchQuery]);

  // Open Create Form
  const handleOpenCreate = () => {
    setEditorMode('create');
    setEditingItem({
      year: '',
      brand: '',
      model: '',
      partType: 'Motor',
      vin: '',
      palletNumber: '',
    });
    setVinDecodeStatus('idle');
    setVinDecodeMessage('');
    setIsEditorOpen(true);
  };

  // Open Edit Form
  const handleOpenEdit = (item: InventoryPart) => {
    setEditorMode('edit');
    setEditingItem({ ...item });
    setVinDecodeStatus('idle');
    setVinDecodeMessage('');
    setIsEditorOpen(true);
  };

  // Save Item (Create or Update)
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem.year?.trim() || !editingItem.brand?.trim() || !editingItem.model?.trim()) {
      alert('Por favor selecciona primero el Año, luego la Marca y de último el Modelo.');
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
        showToast('Pieza actualizada.');
      }
      setIsEditorOpen(false);
    } catch (err: any) {
      alert(err.message || 'No se pudo guardar la pieza.');
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
      alert(err.message || 'No se pudo eliminar la pieza.');
    }
  };

  // Convert to Order (Prefill new order modal)
  const handleConvertToOrder = (item: InventoryPart) => {
    if (!onOpenNewOrderWithPart) {
      alert('Función de apertura de orden no disponible.');
      return;
    }
    const prefill: PrefillOrderData = {
      make: item.brand,
      model: item.model,
      year: parseInt(item.year, 10) || 2020,
      mainPart: item.partType || 'Motor',
      partPrice: 1000,
      warrantyDays: 60,
    };
    onOpenNewOrderWithPart(prefill);
  };

  return (
    <div className="space-y-5 animate-fade-in text-slate-100 font-sans pb-10">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0c1a30] border border-emerald-500/60 text-emerald-300 px-4 py-3 rounded-2xl shadow-[0_0_25px_rgba(16,185,129,0.35)] flex items-center gap-2.5 animate-bounce-subtle">
          <span className="material-symbols-outlined text-[20px] text-emerald-400">check_circle</span>
          <span className="text-xs font-mono font-bold">{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#070c18] via-[#0b1424] to-[#080d1a] border border-cyan-500/30 p-5 sm:p-6 shadow-[0_10px_35px_rgba(0,0,0,0.6)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-blue-500/20 to-emerald-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <span className="material-symbols-outlined text-[28px]">
                warehouse
              </span>
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-white tracking-wide uppercase">
                Inventario de Piezas
              </h1>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Registro simple de Motores y Transmisiones por Año, Marca, Modelo, VIN y Paleta
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={fetchInventory}
              disabled={loading}
              className="px-3 py-2.5 rounded-xl bg-[#0a1224] hover:bg-[#121f3a] text-slate-300 border border-slate-700/60 text-xs font-mono font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
              title="Refrescar datos"
            >
              <span className={`material-symbols-outlined text-[16px] text-cyan-400 ${loading ? 'animate-spin' : ''}`}>
                sync
              </span>
              <span className="hidden sm:inline">Actualizar</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-xs font-mono uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center gap-2 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>+ Agregar Pieza</span>
            </button>
          </div>
        </div>

        {/* 4 Metric Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="rounded-2xl bg-[#040814]/80 border border-slate-800 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            </div>
            <div>
              <div className="text-[10px] font-mono text-slate-400 uppercase">Total Piezas</div>
              <div className="text-lg font-black text-white font-mono">{stats.total}</div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#040814]/80 border border-emerald-500/30 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <span className="material-symbols-outlined text-[18px]">settings</span>
            </div>
            <div>
              <div className="text-[10px] font-mono text-emerald-400 uppercase font-bold">Motores</div>
              <div className="text-lg font-black text-emerald-300 font-mono">{stats.motors}</div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#040814]/80 border border-amber-500/30 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <span className="material-symbols-outlined text-[18px]">swap_driving_apps</span>
            </div>
            <div>
              <div className="text-[10px] font-mono text-amber-400 uppercase font-bold">Transmisiones</div>
              <div className="text-lg font-black text-amber-300 font-mono">{stats.transmissions}</div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#040814]/80 border border-blue-500/30 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <span className="material-symbols-outlined text-[18px]">pallet</span>
            </div>
            <div>
              <div className="text-[10px] font-mono text-blue-400 uppercase font-bold">Paletas Únicas</div>
              <div className="text-lg font-black text-blue-300 font-mono">{stats.uniquePallets}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="rounded-2xl bg-[#060b17] border border-cyan-500/20 p-3 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-lg">
        {/* Search */}
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-cyan-400 pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por Año, Marca, Modelo, VIN o Paleta..."
            className="w-full pl-10 pr-9 py-2.5 bg-[#03060f] border border-cyan-500/30 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(6,182,212,0.25)] transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 shrink-0">
          {(
            [
              { id: 'all', label: 'Todas las Piezas' },
              { id: 'Motor', label: 'Motores' },
              { id: 'Transmisión', label: 'Transmisiones' },
            ] as const
          ).map((filter) => {
            const isActive = typeFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setTypeFilter(filter.id)}
                className={`px-3 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-cyan-500/30 border border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                    : 'bg-[#03060f] border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error / Loading */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs font-mono flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-red-400">error</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {loading && (
        <div className="p-12 flex flex-col items-center justify-center text-center">
          <div className="w-10 h-10 rounded-2xl border-2 border-cyan-400 border-t-transparent animate-spin mb-3" />
          <span className="text-xs font-mono text-cyan-300">Cargando inventario...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredItems.length === 0 && (
        <div className="p-12 rounded-3xl bg-[#060b17]/60 border border-slate-800 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center text-slate-500 mb-3">
            <span className="material-symbols-outlined text-[28px]">inventory_2</span>
          </div>
          <h3 className="text-sm font-bold text-white">No hay piezas registradas</h3>
          <p className="text-xs text-slate-400 font-mono max-w-sm mt-1">
            {searchQuery
              ? 'No hay piezas que coincidan con la búsqueda.'
              : 'Agrega tu primera pieza con Año, Marca, Modelo, Tipo de Pieza, VIN y Número de Paleta.'}
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="mt-4 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-mono font-bold text-xs cursor-pointer hover:scale-105 transition-transform"
          >
            + Agregar Pieza
          </button>
        </div>
      )}

      {/* Table of Inventory Items */}
      {!loading && filteredItems.length > 0 && (
        <div className="rounded-2xl bg-[#060b17] border border-cyan-500/25 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="bg-[#03060f] border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                  <th className="py-3 px-4">Paleta #</th>
                  <th className="py-3 px-4">Año</th>
                  <th className="py-3 px-4">Marca</th>
                  <th className="py-3 px-4">Modelo</th>
                  <th className="py-3 px-4">Tipo de Pieza</th>
                  <th className="py-3 px-4">VIN</th>
                  <th className="py-3 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {filteredItems.map((item) => {
                  const isMotor = (item.partType || '').toLowerCase().includes('motor');
                  return (
                    <tr key={item.id} className="hover:bg-cyan-500/5 transition-colors">
                      {/* Pallet # */}
                      <td className="py-3 px-4">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.2)]">
                          {item.palletNumber || 'S/P'}
                        </span>
                      </td>

                      {/* Year */}
                      <td className="py-3 px-4 font-bold text-amber-300">{item.year}</td>

                      {/* Brand */}
                      <td className="py-3 px-4 font-black text-white">{item.brand}</td>

                      {/* Model */}
                      <td className="py-3 px-4 font-bold text-slate-200">{item.model}</td>

                      {/* Part Type (Motor / Transmission) */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold uppercase ${
                            isMotor
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {isMotor ? 'settings' : 'swap_driving_apps'}
                          </span>
                          <span>{item.partType}</span>
                        </span>
                      </td>

                      {/* VIN */}
                      <td className="py-3 px-4 font-mono text-cyan-300 font-medium tracking-wider">
                        {item.vin || '—'}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleConvertToOrder(item)}
                            className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 transition-transform cursor-pointer shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                            title="Crear Orden con esta pieza"
                          >
                            <span className="material-symbols-outlined text-[14px]">shopping_cart</span>
                            <span className="hidden sm:inline">Crear Orden</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 transition-colors cursor-pointer"
                            title="Editar pieza"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteConfirmItem(item)}
                            className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 transition-colors cursor-pointer"
                            title="Eliminar pieza"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
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

      {/* Simple 6-Field Editor Modal */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-lg rounded-3xl bg-[#070c18] border border-cyan-500/40 shadow-[0_20px_60px_rgba(0,0,0,0.9)] p-5 sm:p-6 text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-cyan-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center text-slate-950 font-black shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                  <span className="material-symbols-outlined text-[20px]">
                    {editorMode === 'create' ? 'add_circle' : 'edit'}
                  </span>
                </div>
                <div>
                  <h2 className="text-base font-black text-white uppercase tracking-wide">
                    {editorMode === 'create' ? 'Registrar Pieza' : 'Editar Pieza'}
                  </h2>
                  <span className="text-[11px] font-mono text-slate-400">
                    Solo los 6 datos necesarios
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Simple Form (6 Fields) */}
            <form onSubmit={handleSaveItem} className="space-y-4 mt-4 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 1. Año (Cascading Step 1) */}
                <div>
                  <label className="text-[11px] text-slate-300 font-bold block mb-1">
                    Año <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    value={editingItem.year || ''}
                    onChange={(e) => handleYearChange(e.target.value)}
                    className="w-full bg-[#070e1c] border border-cyan-500/40 rounded-xl p-2.5 text-slate-100 font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 cursor-pointer text-xs"
                  >
                    <option value="">Selecciona año</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>

                {/* 2. Marca (Cascading Step 2: Enabled after Año) */}
                <div>
                  <label className="text-[11px] text-slate-300 font-bold block mb-1">
                    Marca <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    disabled={!editingItem.year}
                    value={editingItem.brand || ''}
                    onChange={(e) => handleBrandChange(e.target.value)}
                    className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
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
                </div>

                {/* 3. Modelo (Cascading Step 3: Enabled after Marca) */}
                <div>
                  <label className="text-[11px] text-slate-300 font-bold block mb-1">
                    Modelo <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    disabled={!editingItem.brand}
                    value={editingItem.model || ''}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
                  >
                    <option value="">
                      {editingItem.brand ? 'Selecciona modelo' : 'Primero selecciona marca'}
                    </option>
                    {editingItem.model && !modelOptions.includes(editingItem.model) && (
                      <option value={editingItem.model}>{editingItem.model}</option>
                    )}
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>

                {/* 4. Tipo de Pieza (Motor / Transmisión) */}
                <div>
                  <label className="text-[11px] text-slate-300 font-bold block mb-1">
                    Tipo de Pieza <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={editingItem.partType || 'Motor'}
                    onChange={(e) => setEditingItem({ ...editingItem, partType: e.target.value })}
                    className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-emerald-300 font-bold focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 cursor-pointer text-xs"
                  >
                    <option value="Motor">⚙️ Motor</option>
                    <option value="Transmisión">🔄 Transmisión</option>
                  </select>
                </div>

                {/* 5. VIN (Número de Chasis) */}
                <div>
                  <label className="text-[11px] text-slate-300 font-bold block mb-1">
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
                    className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-cyan-300 uppercase tracking-wider font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-xs"
                  />
                  {vinDecodeMessage && (
                    <span
                      className={`mt-1 block text-[10px] font-medium ${
                        vinDecodeStatus === 'error'
                          ? 'text-rose-400'
                          : vinDecodeStatus === 'success'
                          ? 'text-emerald-400'
                          : 'text-cyan-400 animate-pulse'
                      }`}
                    >
                      {vinDecodeMessage}
                    </span>
                  )}
                </div>

                {/* 6. Número de Paleta */}
                <div>
                  <label className="text-[11px] text-slate-300 font-bold block mb-1">
                    Número de Paleta
                  </label>
                  <input
                    type="text"
                    value={editingItem.palletNumber || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, palletNumber: e.target.value.toUpperCase() })}
                    placeholder="Ej: PAL-104"
                    className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl p-2.5 text-blue-300 font-bold font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-xs"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  disabled={isSaving}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition-colors cursor-pointer text-xs"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] cursor-pointer flex items-center gap-2 text-xs hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isSaving ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                      <span>GUARDANDO...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">save</span>
                      <span>{editorMode === 'create' ? 'GUARDAR PIEZA' : 'GUARDAR CAMBIOS'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-sm rounded-3xl bg-[#0c1322] border border-red-500/50 p-6 text-center space-y-4 shadow-[0_20px_50px_rgba(0,0,0,0.85)] font-mono">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/40 mx-auto flex items-center justify-center text-red-400">
              <span className="material-symbols-outlined text-[28px]">delete</span>
            </div>
            <h3 className="text-base font-bold text-white">¿Eliminar pieza?</h3>
            <p className="text-xs text-slate-400">
              Se eliminará:{' '}
              <strong className="text-white block mt-1">
                {deleteConfirmItem.year} {deleteConfirmItem.brand} {deleteConfirmItem.model} ({deleteConfirmItem.partType})
              </strong>
              {deleteConfirmItem.palletNumber && (
                <span className="text-blue-300 block text-[11px] mt-0.5">Paleta: {deleteConfirmItem.palletNumber}</span>
              )}
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteItem}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.4)]"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
