import React, { useState, useMemo } from 'react';
import { InventoryPart } from '../types';

interface InventoryPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryPart[];
}

export const InventoryPrintModal: React.FC<InventoryPrintModalProps> = ({
  isOpen,
  onClose,
  items,
}) => {
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<'all' | 'Motor' | 'Transmisión'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'disponible' | 'reservado' | 'vendido'>('all');
  const [showNotes, setShowNotes] = useState(true);
  const [showVin, setShowVin] = useState(true);

  // Available unique brands
  const allBrands = useMemo(() => {
    const brands = Array.from(new Set(items.map((i) => i.brand?.trim()).filter(Boolean)));
    return brands.sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Filter items based on user selection
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedBrand !== 'all' && item.brand !== selectedBrand) return false;
      if (selectedType !== 'all' && item.partType !== selectedType) return false;
      if (selectedStatus !== 'all' && (item.status || 'disponible').toLowerCase() !== selectedStatus) return false;
      return true;
    });
  }, [items, selectedBrand, selectedType, selectedStatus]);

  // Group filtered items by brand
  const groupedByBrand = useMemo(() => {
    const map = new Map<string, InventoryPart[]>();
    filteredItems.forEach((item) => {
      const brandKey = (item.brand?.trim() || 'SIN MARCA').toUpperCase();
      if (!map.has(brandKey)) {
        map.set(brandKey, []);
      }
      map.get(brandKey)!.push(item);
    });

    // Sort brands alphabetically
    const sortedEntries = Array.from(map.entries()).sort(([brandA], [brandB]) =>
      brandA.localeCompare(brandB)
    );

    // Within each brand, sort by year descending, then model
    sortedEntries.forEach(([, brandItems]) => {
      brandItems.sort((a, b) => {
        const yearA = parseInt(a.year, 10) || 0;
        const yearB = parseInt(b.year, 10) || 0;
        if (yearB !== yearA) return yearB - yearA;
        return (a.model || '').localeCompare(b.model || '');
      });
    });

    return sortedEntries;
  }, [filteredItems]);

  // Total metrics
  const metrics = useMemo(() => {
    const total = filteredItems.length;
    const motors = filteredItems.filter((i) => (i.partType || '').toLowerCase().includes('motor')).length;
    const transmissions = filteredItems.filter((i) => (i.partType || '').toLowerCase().includes('transmi')).length;
    const available = filteredItems.filter((i) => (i.status || 'disponible').toLowerCase() === 'disponible').length;
    return { total, motors, transmissions, available, brandsCount: groupedByBrand.length };
  }, [filteredItems, groupedByBrand]);

  if (!isOpen) return null;

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor permite las ventanas emergentes (popups) para imprimir el inventario.');
      return;
    }

    const currentDate = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte de Inventario por Marcas - RADAR 3.0</title>
        <style>
          @page {
            size: letter portrait;
            margin: 12mm 10mm 15mm 10mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 11px;
            line-height: 1.35;
          }
          .header {
            border-bottom: 2px solid #0284c7;
            padding-bottom: 10px;
            margin-bottom: 14px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .logo-title {
            font-size: 20px;
            font-weight: 900;
            color: #0369a1;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin: 0;
          }
          .subtitle {
            font-size: 11px;
            font-weight: 600;
            color: #475569;
            margin: 2px 0 0 0;
          }
          .meta-info {
            text-align: right;
            font-size: 10px;
            color: #64748b;
          }
          .metrics-bar {
            display: flex;
            gap: 10px;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 16px;
            font-size: 11px;
          }
          .metric-item {
            flex: 1;
            text-align: center;
          }
          .metric-item strong {
            display: block;
            font-size: 15px;
            color: #0f172a;
          }
          .metric-item span {
            font-size: 9.5px;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 600;
          }
          .brand-section {
            margin-bottom: 18px;
            page-break-inside: avoid;
          }
          .brand-header {
            background: #0f172a;
            color: #ffffff;
            padding: 6px 10px;
            font-size: 12px;
            font-weight: 800;
            border-radius: 4px 4px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .brand-badge {
            background: #0284c7;
            color: #ffffff;
            font-size: 10px;
            padding: 2px 7px;
            border-radius: 12px;
            font-weight: 700;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            border: 1px solid #cbd5e1;
            border-top: none;
          }
          th {
            background: #e2e8f0;
            color: #334155;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 9px;
            padding: 6px 6px;
            text-align: left;
            border-bottom: 1px solid #cbd5e1;
          }
          td {
            padding: 5px 6px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
          }
          tr:nth-child(even) {
            background-color: #f8fafc;
          }
          .pallet-badge {
            font-family: monospace;
            font-weight: 800;
            background: #e0f2fe;
            color: #0369a1;
            border: 1px solid #bae6fd;
            padding: 2px 5px;
            border-radius: 4px;
            display: inline-block;
          }
          .type-badge {
            font-weight: 700;
            font-size: 9.5px;
            padding: 2px 5px;
            border-radius: 4px;
            display: inline-block;
            text-transform: uppercase;
          }
          .type-motor {
            background: #dcfce7;
            color: #15803d;
            border: 1px solid #bbf7d0;
          }
          .type-trans {
            background: #fef3c7;
            color: #b45309;
            border: 1px solid #fde68a;
          }
          .spec-badge {
            font-weight: 800;
            font-family: monospace;
            font-size: 9.5px;
            background: #f1f5f9;
            color: #1e293b;
            border: 1px solid #cbd5e1;
            padding: 1px 4px;
            border-radius: 3px;
            margin-left: 4px;
          }
          .status-tag {
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            padding: 2px 5px;
            border-radius: 3px;
          }
          .status-disponible { background: #dcfce7; color: #166534; }
          .status-reservado { background: #fef3c7; color: #854d0e; }
          .status-vendido { background: #dbeafe; color: #1e40af; }
          .status-en_revision { background: #f3e8ff; color: #6b21a8; }
          .vin-text {
            font-family: monospace;
            font-size: 9.5px;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .notes-text {
            font-size: 9px;
            color: #475569;
            font-style: italic;
          }
          .footer {
            margin-top: 25px;
            padding-top: 10px;
            border-top: 1px solid #cbd5e1;
            display: flex;
            justify-content: space-between;
            font-size: 9px;
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 class="logo-title">RADAR 3.0 • REPORTE DE INVENTARIO</h1>
            <p class="subtitle">Clasificación y disponibilidad organizada por Marcas de Vehículo</p>
          </div>
          <div class="meta-info">
            <div><strong>Fecha:</strong> ${currentDate}</div>
            <div><strong>Filtro Tipo:</strong> ${selectedType === 'all' ? 'Todos' : selectedType}</div>
            <div><strong>Filtro Estado:</strong> ${selectedStatus === 'all' ? 'Todos' : selectedStatus}</div>
          </div>
        </div>

        <div class="metrics-bar">
          <div class="metric-item">
            <strong>${metrics.total}</strong>
            <span>Total Piezas</span>
          </div>
          <div class="metric-item">
            <strong style="color: #15803d;">${metrics.motors}</strong>
            <span>Motores</span>
          </div>
          <div class="metric-item">
            <strong style="color: #b45309;">${metrics.transmissions}</strong>
            <span>Transmisiones</span>
          </div>
          <div class="metric-item">
            <strong style="color: #0369a1;">${metrics.brandsCount}</strong>
            <span>Marcas Registradas</span>
          </div>
          <div class="metric-item">
            <strong style="color: #059669;">${metrics.available}</strong>
            <span>Disponibles</span>
          </div>
        </div>

        ${groupedByBrand
          .map(([brand, items]) => {
            const brandMotors = items.filter((i) => (i.partType || '').toLowerCase().includes('motor')).length;
            const brandTrans = items.filter((i) => (i.partType || '').toLowerCase().includes('transmi')).length;
            return `
              <div class="brand-section">
                <div class="brand-header">
                  <span>🚗 ${brand}</span>
                  <span class="brand-badge">${items.length} pieza${items.length > 1 ? 's' : ''} (${brandMotors} Mot / ${brandTrans} Trans)</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th style="width: 12%;">Paleta #</th>
                      <th style="width: 8%;">Año</th>
                      <th style="width: 20%;">Modelo</th>
                      <th style="width: 22%;">Tipo / Especificación</th>
                      ${showVin ? '<th style="width: 18%;">VIN / Chasis</th>' : ''}
                      <th style="width: 10%;">Estado</th>
                      ${showNotes ? '<th style="width: 18%;">Notas Extra</th>' : ''}
                    </tr>
                  </thead>
                  <tbody>
                    ${items
                      .map((item) => {
                        const isMotor = (item.partType || '').toLowerCase().includes('motor');
                        const statusClass = `status-${(item.status || 'disponible').toLowerCase()}`;
                        return `
                          <tr>
                            <td><span class="pallet-badge">${item.palletNumber || 'S/P'}</span></td>
                            <td><strong>${item.year}</strong></td>
                            <td><strong>${item.model || '—'}</strong></td>
                            <td>
                              <span class="type-badge ${isMotor ? 'type-motor' : 'type-trans'}">
                                ${item.partType}
                              </span>
                              ${item.engineSpecs ? `<span class="spec-badge">${item.engineSpecs}</span>` : ''}
                            </td>
                            ${showVin ? `<td><span class="vin-text">${item.vin || '—'}</span></td>` : ''}
                            <td>
                              <span class="status-tag ${statusClass}">
                                ${item.status || 'disponible'}
                              </span>
                            </td>
                            ${showNotes ? `<td class="notes-text">${item.notes || '—'}</td>` : ''}
                          </tr>
                        `;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>
            `;
          })
          .join('')}

        <div class="footer">
          <div>RADAR 3.0 — Sistema Integral de Gestión de Autopartes y Talleres</div>
          <div>Reporte generado automáticamente • Página 1 de 1</div>
        </div>

        <script>
          window.onload = function() {
            window.focus();
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleExportCsv = () => {
    const headers = 'Marca,Modelo,Año,Tipo de Pieza,Litraje/Tracción,Paleta,VIN,Estado,Notas\n';
    const rows: string[] = [];

    groupedByBrand.forEach(([brand, brandItems]) => {
      brandItems.forEach((item) => {
        rows.push(
          `"${brand}","${item.model}","${item.year}","${item.partType}","${item.engineSpecs || ''}","${item.palletNumber || ''}","${item.vin || ''}","${item.status || 'disponible'}","${(item.notes || '').replace(/"/g, '""')}"`
        );
      });
    });

    const blob = new Blob([headers + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `radar3_inventario_por_marcas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-xl animate-fade-in font-sans">
      <div className="relative w-full max-w-4xl rounded-3xl bg-[#070c18] border border-cyan-500/40 shadow-[0_20px_70px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col max-h-[92vh]">
        {/* Laser Top Accent */}
        <div className="h-1 bg-gradient-to-r from-cyan-500 via-emerald-400 to-blue-500 w-full shrink-0 shadow-[0_0_12px_rgba(6,182,212,0.6)]" />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-cyan-500/20 bg-[#0a1022]/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <span className="material-symbols-outlined text-[24px]">print</span>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-wide">
                Imprimir Inventario por Marcas
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                Reporte clasificado y ordenado alfabéticamente por marca de vehículo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Filter Controls Toolbar */}
        <div className="p-4 bg-[#050914] border-b border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 shrink-0 font-mono text-xs">
          {/* Brand Selector */}
          <div>
            <label className="text-[10px] text-cyan-400 uppercase font-bold block mb-1">
              Marca:
            </label>
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="w-full bg-[#03060f] border border-cyan-500/30 rounded-xl p-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-400"
            >
              <option value="all">⭐ Todas las Marcas ({allBrands.length})</option>
              {allBrands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Part Type Filter */}
          <div>
            <label className="text-[10px] text-cyan-400 uppercase font-bold block mb-1">
              Tipo de Pieza:
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as any)}
              className="w-full bg-[#03060f] border border-cyan-500/30 rounded-xl p-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-400"
            >
              <option value="all">Todas las piezas</option>
              <option value="Motor">⚙️ Motores</option>
              <option value="Transmisión">🔄 Transmisiones</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="text-[10px] text-cyan-400 uppercase font-bold block mb-1">
              Estado:
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="w-full bg-[#03060f] border border-cyan-500/30 rounded-xl p-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-400"
            >
              <option value="all">Todos los estados</option>
              <option value="disponible">🟢 Solo Disponibles</option>
              <option value="reservado">🟡 Reservados</option>
              <option value="vendido">🔵 Vendidos</option>
            </select>
          </div>

          {/* Column Toggles */}
          <div className="flex flex-col justify-end gap-1.5">
            <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showVin}
                onChange={(e) => setShowVin(e.target.checked)}
                className="rounded accent-cyan-400 cursor-pointer"
              />
              <span>Incluir columna VIN</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showNotes}
                onChange={(e) => setShowNotes(e.target.checked)}
                className="rounded accent-cyan-400 cursor-pointer"
              />
              <span>Incluir notas extra</span>
            </label>
          </div>
        </div>

        {/* Live Preview List */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 font-mono text-xs">
          {/* Summary Badge bar */}
          <div className="flex items-center justify-between bg-[#040814] border border-slate-800 p-3 rounded-2xl flex-wrap gap-2">
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <span className="text-white font-bold">
                Total a Imprimir: <span className="text-cyan-400">{metrics.total} piezas</span>
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-emerald-300 font-bold">⚙️ {metrics.motors} Motores</span>
              <span className="text-slate-600">|</span>
              <span className="text-amber-300 font-bold">🔄 {metrics.transmissions} Transmisiones</span>
              <span className="text-slate-600">|</span>
              <span className="text-blue-300 font-bold">🚗 {metrics.brandsCount} Marcas</span>
            </div>
            <span className="text-[10px] text-slate-400">
              Vista previa en pantalla
            </span>
          </div>

          {groupedByBrand.length === 0 ? (
            <div className="p-8 text-center bg-[#050914] border border-slate-800 rounded-2xl text-slate-400">
              No hay piezas que coincidan con los filtros seleccionados.
            </div>
          ) : (
            groupedByBrand.map(([brand, brandItems]) => (
              <div key={brand} className="rounded-2xl bg-[#050914] border border-cyan-500/20 overflow-hidden shadow-md">
                {/* Brand Header */}
                <div className="bg-[#03060f] px-4 py-2.5 border-b border-cyan-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-black text-sm">🚗 {brand}</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold">
                    {brandItems.length} {brandItems.length === 1 ? 'pieza' : 'piezas'}
                  </span>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#040814]/80 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                        <th className="py-2 px-3">Paleta</th>
                        <th className="py-2 px-3">Año</th>
                        <th className="py-2 px-3">Modelo</th>
                        <th className="py-2 px-3">Tipo / Especificación</th>
                        {showVin && <th className="py-2 px-3">VIN</th>}
                        <th className="py-2 px-3">Estado</th>
                        {showNotes && <th className="py-2 px-3">Notas</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 text-slate-200 text-[11px]">
                      {brandItems.map((item) => {
                        const isMotor = (item.partType || '').toLowerCase().includes('motor');
                        return (
                          <tr key={item.id} className="hover:bg-cyan-500/5">
                            <td className="py-2 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                {item.palletNumber || 'S/P'}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-bold text-amber-300">{item.year}</td>
                            <td className="py-2 px-3 font-bold text-white">
                              {item.model || <span className="text-slate-500 font-normal italic">Sin modelo</span>}
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  isMotor
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                }`}
                              >
                                {item.partType}
                              </span>
                              {item.engineSpecs && (
                                <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-200 border border-slate-700">
                                  {item.engineSpecs}
                                </span>
                              )}
                            </td>
                            {showVin && (
                              <td className="py-2 px-3 text-cyan-300 font-mono text-[10px]">
                                {item.vin || '—'}
                              </td>
                            )}
                            <td className="py-2 px-3">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                item.status === 'reservado'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : item.status === 'vendido'
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-emerald-500/20 text-emerald-300'
                              }`}>
                                {item.status || 'disponible'}
                              </span>
                            </td>
                            {showNotes && (
                              <td className="py-2 px-3 text-slate-400 italic text-[10px] max-w-[180px] truncate">
                                {item.notes || '—'}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="p-4 bg-[#0a1022] border-t border-cyan-500/20 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-400 font-mono">
            {metrics.total} piezas en {metrics.brandsCount} marcas listas para imprimir
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px] text-cyan-400">table_chart</span>
              <span>CSV por Marcas</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={groupedByBrand.length === 0}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 text-xs font-mono font-black uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] cursor-pointer hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              <span>Imprimir Reporte (PDF)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
