import React, { useState } from 'react';
import { INVENTORY_ITEMS } from '../data/mockData';
import { InventoryItem } from '../types';

export const InventoryView: React.FC = () => {
  const [items] = useState<InventoryItem[]>(INVENTORY_ITEMS);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [search, setSearch] = useState('');

  const categories = ['Todos', 'Vehículos', 'Repuestos', 'Accesorios'];

  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'Todos' && item.category !== selectedCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="radar-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-headline-md text-2xl md:text-3xl font-bold text-[#dfe2ef] tracking-tight">
              Control de Inventario & Stock
            </h2>
            <span className="inline-flex items-center justify-center bg-[#31353f] border border-[rgba(255,255,255,0.08)] rounded-full px-2.5 py-0.5 font-data-mono text-[#4edea3] text-[11px] font-semibold">
              38 Unidades en Lote
            </span>
          </div>
          <p className="font-body-md text-[14px] text-[#c2c6d6]">
            Catálogo unificado de vehículos de showroom, repuestos originales y consumibles.
          </p>
        </div>

        <button className="bg-[#4d8eff] text-[#00285d] font-body-sm font-bold text-[13px] py-1.5 px-4 rounded-lg flex items-center gap-1.5 shadow-[0_0_12px_rgba(77,142,255,0.3)] hover:bg-[#3b7cee] transition-all cursor-pointer">
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>Registrar Entrada Stock</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="glass-card rounded-xl p-3.5 flex flex-col sm:flex-row justify-between items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`font-body-sm text-[12px] py-1 px-3 rounded-full transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-[#4d8eff] text-[#00285d] font-bold shadow-sm'
                  : 'text-[#c2c6d6] hover:text-[#dfe2ef] hover:bg-[#31353f]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#c2c6d6] text-[16px]">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU, nombre..."
            className="w-full bg-[#0a0e17] border border-[rgba(255,255,255,0.08)] rounded-lg py-1.5 pl-9 pr-3 text-[13px] text-[#dfe2ef] focus:outline-none focus:border-[#4d8eff]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl shadow-lg overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap border-collapse text-xs">
            <thead className="bg-[#181b25] border-b border-[rgba(255,255,255,0.08)] font-data-label uppercase text-[#c2c6d6]">
              <tr>
                <th className="p-3.5">SKU</th>
                <th className="p-3.5">Descripción del Artículo</th>
                <th className="p-3.5">Categoría</th>
                <th className="p-3.5">Ubicación en Almacén</th>
                <th className="p-3.5 text-center">Stock</th>
                <th className="p-3.5 text-right">Precio Unitario</th>
                <th className="p-3.5 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)] font-body-sm text-[13px]">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-[#31353f]/30 transition-colors">
                  <td className="p-3.5 font-data-mono font-bold text-[#adc6ff]">{item.sku}</td>
                  <td className="p-3.5 font-medium text-[#dfe2ef]">{item.name}</td>
                  <td className="p-3.5 text-[#c2c6d6]">{item.category}</td>
                  <td className="p-3.5 text-[#c2c6d6] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px] text-[#4d8eff]">
                      warehouse
                    </span>
                    <span>{item.location}</span>
                  </td>
                  <td className="p-3.5 text-center font-data-mono font-bold">{item.stock}</td>
                  <td className="p-3.5 text-right font-data-mono text-[#dfe2ef]">
                    ${item.price.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3.5 text-center">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-data-label ${
                        item.status === 'Disponible'
                          ? 'bg-[#4edea3]/10 text-[#4edea3] border border-[#4edea3]/20'
                          : item.status === 'Bajo Stock'
                          ? 'bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20'
                          : 'bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
