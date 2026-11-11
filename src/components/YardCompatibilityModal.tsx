import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Order, YardCompatibility, CompatibleVehicleItem } from '../types';
import { MAKE_MODEL_MAP } from '../data/vehicleData';
import { apiFetch } from '../services/apiFetch';
import { uploadOrderFile } from '../services/orderFiles';

interface YardCompatibilityModalProps {
  order: Order;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (compatibility: YardCompatibility) => void;
  onToast: (msg: string) => void;
}

export const YardCompatibilityModal: React.FC<YardCompatibilityModalProps> = ({
  order,
  isOpen,
  onClose,
  onSaved,
  onToast,
}) => {
  const makeOptions = useMemo(() => Object.keys(MAKE_MODEL_MAP).sort(), []);

  // Pre-fill initial make
  const initialMake = useMemo(() => {
    const m = order.vehicle?.make?.trim();
    const found = makeOptions.find((opt) => opt.toLowerCase() === m?.toLowerCase());
    return found || makeOptions[0] || 'Toyota';
  }, [order, makeOptions]);

  const [selectedMake, setSelectedMake] = useState<string>(initialMake);

  const modelOptions = useMemo(() => {
    return MAKE_MODEL_MAP[selectedMake] || [];
  }, [selectedMake]);

  // Pre-fill initial model
  const initialModel = useMemo(() => {
    const m = order.vehicle?.model?.trim();
    const found = (MAKE_MODEL_MAP[initialMake] || []).find((opt) => opt.toLowerCase() === m?.toLowerCase());
    return found || (MAKE_MODEL_MAP[initialMake] || [])[0] || '';
  }, [order, initialMake]);

  const [selectedModel, setSelectedModel] = useState<string>(initialModel);

  // Year options: from currentYear + 1 down to 1980
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear + 1; y >= 1980; y--) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  const initialYear = Number(order.vehicle?.year) || currentYear;
  const [selectedYearFrom, setSelectedYearFrom] = useState<number>(initialYear);
  const [selectedYearTo, setSelectedYearTo] = useState<number>(initialYear);
  const [extraCustomNotes, setExtraCustomNotes] = useState<string>('');

  // Structured vehicles list
  const [vehiclesList, setVehiclesList] = useState<CompatibleVehicleItem[]>(() => {
    if (order.yardCompatibility?.compatibleVehicles && order.yardCompatibility.compatibleVehicles.length > 0) {
      return order.yardCompatibility.compatibleVehicles;
    }
    return [];
  });

  // Images state
  const [images, setImages] = useState<string[]>(
    order.yardCompatibility?.referenceImages || []
  );
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showManualEdit, setShowManualEdit] = useState(false);
  const [manualText, setManualText] = useState<string>(
    order.yardCompatibility?.compatibilityList || ''
  );

  // When make changes, select first available model
  const handleMakeChange = (newMake: string) => {
    setSelectedMake(newMake);
    const models = MAKE_MODEL_MAP[newMake] || [];
    setSelectedModel(models[0] || '');
  };

  // Helper: Format compatibility text
  const formatCompatibilityText = (items: CompatibleVehicleItem[], extra: string): string => {
    if (items.length === 0 && !extra.trim()) return '';
    const lines: string[] = ['Compatibilidad'];
    items.forEach((item) => {
      const yearsStr = item.yearFrom === item.yearTo ? `${item.yearFrom}.` : `${item.yearFrom} y ${item.yearTo}.`;
      const notesStr = item.notes ? ` (${item.notes})` : '';
      lines.push(`*${item.make} ${item.model}: ${yearsStr}${notesStr}`);
    });
    if (extra.trim()) {
      lines.push(extra.trim());
    }
    return lines.join('\n');
  };

  // Keep manual text in sync if not manually edited
  useEffect(() => {
    if (!showManualEdit && vehiclesList.length > 0) {
      setManualText(formatCompatibilityText(vehiclesList, extraCustomNotes));
    }
  }, [vehiclesList, extraCustomNotes, showManualEdit]);

  // Action: Add vehicle from selectors
  const handleAddVehicle = () => {
    if (!selectedMake || !selectedModel) {
      setErrorMessage('Por favor selecciona una marca y un modelo.');
      return;
    }

    setErrorMessage(null);
    const from = Math.min(selectedYearFrom, selectedYearTo);
    const to = Math.max(selectedYearFrom, selectedYearTo);

    const newItem: CompatibleVehicleItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      make: selectedMake,
      model: selectedModel,
      yearFrom: from,
      yearTo: to,
    };

    setVehiclesList((prev) => [...prev, newItem]);
  };

  // Action: Quick-add current order vehicle
  const handleAddCurrentOrderVehicle = () => {
    const make = order.vehicle?.make || selectedMake;
    const model = order.vehicle?.model || selectedModel;
    const yr = Number(order.vehicle?.year) || currentYear;

    const newItem: CompatibleVehicleItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      make,
      model,
      yearFrom: yr,
      yearTo: yr,
      notes: order.productSpecs?.trim() || undefined,
    };

    setVehiclesList((prev) => [...prev, newItem]);
  };

  // Action: Remove vehicle from list
  const handleRemoveVehicle = (idToRemove?: string, index?: number) => {
    setVehiclesList((prev) =>
      prev.filter((item, idx) => (item.id && idToRemove ? item.id !== idToRemove : idx !== index))
    );
  };

  // Multiple file upload
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setErrorMessage(null);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(`Subiendo imagen ${i + 1} de ${files.length}...`);
        const url = await uploadOrderFile(order.id, file, false);
        uploadedUrls.push(url);
      }
      setImages((prev) => [...prev, ...uploadedUrls]);
      onToast(`¡${uploadedUrls.length} imagen(es) subida(s) correctamente!`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al subir imágenes');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Save changes
  const handleSave = async () => {
    setIsSaving(true);
    setErrorMessage(null);

    const finalText = showManualEdit
      ? manualText.trim()
      : formatCompatibilityText(vehiclesList, extraCustomNotes);

    try {
      const response = await apiFetch(`/orders/${order.id}/yard-compatibility`, {
        method: 'PUT',
        body: JSON.stringify({
          compatibilityList: finalText,
          compatibleVehicles: vehiclesList,
          referenceImages: images,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'No se pudo guardar la compatibilidad e imágenes.');
      }

      onSaved(
        data.yardCompatibility || {
          compatibilityList: finalText,
          compatibleVehicles: vehiclesList,
          referenceImages: images,
          updatedAt: new Date().toISOString(),
        }
      );
      onToast(`Compatibilidad e imágenes guardadas para orden #${order.code}`);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in font-mono">
      <div className="bg-[#0d1424] border border-amber-500/40 rounded-2xl w-full max-w-3xl max-h-[94vh] flex flex-col shadow-[0_0_50px_rgba(245,158,11,0.25)] text-xs text-slate-100">
        
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-800 p-4 sm:p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-[22px]">swap_horiz</span>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Compatibilidad & Fotos de Referencia
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="text-amber-400 font-bold">#{order.code}</span>
              <span>·</span>
              <span className="text-slate-200 font-bold">{order.mainPart}</span>
              <span>·</span>
              <span>{order.vehicle?.year} {order.vehicle?.make} {order.vehicle?.model}</span>
              <span>·</span>
              <span>VIN: {order.vehicle?.vin ? order.vehicle.vin.slice(-8) : 'N/D'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving || isUploading}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 custom-scrollbar">
          
          {/* Error message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/50 text-rose-300 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Section 1: Compatibility with Selectors */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-slate-200 uppercase font-bold text-[12px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px] text-amber-400">tune</span>
                <span>Selectores de Compatibilidad Vehicular</span>
              </label>

              <button
                type="button"
                onClick={() => setShowManualEdit(!showManualEdit)}
                className="text-[10px] text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {showManualEdit ? 'tune' : 'edit_note'}
                </span>
                <span>{showManualEdit ? 'Volver a Selectores' : 'Ajustar texto libre'}</span>
              </button>
            </div>

            {/* Selectors Form Card */}
            {!showManualEdit ? (
              <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/30 space-y-3 shadow-inner">
                {/* Row 1: Make & Model */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      1. Marca (Make)
                    </label>
                    <select
                      value={selectedMake}
                      onChange={(e) => handleMakeChange(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-amber-500 focus:outline-none font-mono text-xs cursor-pointer"
                    >
                      {makeOptions.map((make) => (
                        <option key={make} value={make}>
                          {make}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      2. Modelo (Model)
                    </label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-amber-500 focus:outline-none font-mono text-xs cursor-pointer"
                    >
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 2: Year Range */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      3. Año Desde
                    </label>
                    <select
                      value={selectedYearFrom}
                      onChange={(e) => setSelectedYearFrom(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-amber-500 focus:outline-none font-mono text-xs cursor-pointer"
                    >
                      {yearOptions.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      4. Año Hasta
                    </label>
                    <select
                      value={selectedYearTo}
                      onChange={(e) => setSelectedYearTo(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-amber-500 focus:outline-none font-mono text-xs cursor-pointer"
                    >
                      {yearOptions.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Action Buttons: Add to List */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={handleAddCurrentOrderVehicle}
                    className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">bolt</span>
                    <span>Copiar vehículo de la orden ({order.vehicle?.year} {order.vehicle?.make} {order.vehicle?.model})</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAddVehicle}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">add_circle</span>
                    <span>+ Agregar a Compatibilidad</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Fallback Manual Textarea */
              <div className="space-y-2">
                <textarea
                  rows={6}
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder={`Compatibilidad\n*Nissan Pathfinder: 2015 y 2016.\n*Infiniti QX60: 2015 y 2016.`}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 p-3 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none font-mono text-xs leading-relaxed"
                />
              </div>
            )}

            {/* List of Added Vehicles */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-300 uppercase block">
                Vehículos Compatibles Agregados ({vehiclesList.length}):
              </span>

              {vehiclesList.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center text-slate-500 text-[11px] space-y-1">
                  <p>Aún no has agregado vehículos compatibles.</p>
                  <p className="text-[10px] text-slate-600">
                    Usa los selectores de Marca, Modelo y Años arriba y haz clic en <strong>+ Agregar a Compatibilidad</strong>.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {vehiclesList.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500/40 flex items-center justify-between gap-2 transition-all shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-[12px] font-bold">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-bold text-white text-xs">
                            {item.make} {item.model}
                            <span className="text-amber-400 ml-2 font-mono">
                              ({item.yearFrom === item.yearTo ? item.yearFrom : `${item.yearFrom} - ${item.yearTo}`})
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveVehicle(item.id, idx)}
                        title="Eliminar de la lista"
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generated WhatsApp Text Preview */}
            {vehiclesList.length > 0 && !showManualEdit && (
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Vista Previa del Texto Generado (Formato WhatsApp/Patio):
                </span>
                <pre className="text-[11px] text-amber-300 font-mono whitespace-pre-line leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                  {formatCompatibilityText(vehiclesList, extraCustomNotes)}
                </pre>
              </div>
            )}
          </div>

          {/* Section 2: Reference Images Gallery */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-slate-200 uppercase font-bold text-[12px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px] text-amber-400">photo_library</span>
                <span>Fotos de Referencia de la Pieza ({images.length})</span>
              </label>
            </div>

            <p className="text-[10px] text-slate-400">
              Sube fotos desde distintos ángulos (frente, convertidor de torque, acoples, carcasa, etiquetas) para que en patio verifiquen la pieza físicamente.
            </p>

            {/* Mobile Touch Quick Actions: Camera + Gallery */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isUploading || isSaving}
                onClick={() => cameraInputRef.current?.click()}
                className="py-2.5 px-4 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 text-xs shadow-sm"
              >
                <span className="material-symbols-outlined text-[20px]">photo_camera</span>
                <span>Tomar Foto con Cámara</span>
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={isUploading || isSaving}
                onChange={handleFilesSelected}
              />

              <button
                type="button"
                disabled={isUploading || isSaving}
                onClick={() => fileInputRef.current?.click()}
                className="py-2.5 px-4 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 text-xs shadow-sm"
              >
                <span className="material-symbols-outlined text-[20px]">collections</span>
                <span>Elegir de Galería / Archivos</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                disabled={isUploading || isSaving}
                onChange={handleFilesSelected}
              />
            </div>

            {/* Upload Area / Dropzone */}
            <div className="border-2 border-dashed border-slate-700 hover:border-amber-500/60 rounded-xl p-4 text-center bg-slate-900/40 transition-colors relative">
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={isUploading || isSaving}
                onChange={handleFilesSelected}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                <span className="material-symbols-outlined text-amber-400 text-3xl">add_photo_alternate</span>
                <span className="text-xs font-bold text-slate-200">
                  {isUploading ? uploadProgress || 'Subiendo imágenes...' : 'O arrastra fotos aquí desde tu ordenador'}
                </span>
                <span className="text-[10px] text-slate-500">
                  Formatos JPG, PNG, WebP (hasta 10MB c/u · Selección múltiple soportada)
                </span>
              </div>
            </div>

            {/* Images Grid */}
            {images.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                {images.map((imgUrl, index) => (
                  <div
                    key={index}
                    className="relative group rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-square flex items-center justify-center"
                  >
                    <img
                      src={imgUrl}
                      alt={`Referencia ${index + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(index)}
                        title="Eliminar foto"
                        className="p-1.5 rounded-lg bg-rose-600/90 text-white hover:bg-rose-500 transition-colors shadow-md cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                    <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-bold text-white">
                      #{index + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 p-4 sm:p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving || isUploading}
            className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/60 hover:bg-slate-700 text-slate-300 hover:text-white transition-all font-bold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isUploading}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all disabled:opacity-60 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isSaving ? 'hourglass_top' : 'save'}
            </span>
            <span>{isSaving ? 'Guardando...' : 'Guardar Compatibilidad y Fotos'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
