import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Order, YardCompatibility, CompatibleVehicleItem } from '../types';
import { MAKE_MODEL_MAP } from '../data/vehicleData';
import { apiFetch } from '../services/apiFetch';
import { uploadOrderFile } from '../services/orderFiles';
import { formatYearRange, expandYearRangesInText } from '../utils/compatibilityFormat';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface YardCompatibilityModalProps {
  order: Order;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (compatibility: YardCompatibility) => void;
  onToast: (msg: string) => void;
  registerCloseRequest?: (handler: (() => void) | null) => void;
}

export const YardCompatibilityModal: React.FC<YardCompatibilityModalProps> = ({
  order,
  isOpen,
  onClose,
  onSaved,
  onToast,
  registerCloseRequest,
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
  const isBusy = isSaving || isUploading;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showManualEdit, setShowManualEdit] = useState(false);
  const [manualText, setManualText] = useState<string>(() => {
    const raw = order.yardCompatibility?.compatibilityList || '';
    return expandYearRangesInText(raw);
  });

  // When make changes, select first available model
  const handleMakeChange = (newMake: string) => {
    setSelectedMake(newMake);
    const models = MAKE_MODEL_MAP[newMake] || [];
    setSelectedModel(models[0] || '');
  };

  // Helper: Format compatibility text
  const formatCompatibilityText = (items: CompatibleVehicleItem[]): string => {
    if (items.length === 0) return '';
    const lines: string[] = ['Compatibilidad'];
    items.forEach((item) => {
      const yearsStr = formatYearRange(item.yearFrom, item.yearTo);
      const notesStr = item.notes ? ` (${item.notes})` : '';
      lines.push(`*${item.make} ${item.model}: ${yearsStr}${notesStr}`);
    });
    return lines.join('\n');
  };

  // Regenerate only when the selector list actually changes; toggling between
  // selectors and free text must not overwrite what the person already typed.
  const selectorSnapshotRef = useRef(JSON.stringify(vehiclesList));
  useEffect(() => {
    const nextSnapshot = JSON.stringify(vehiclesList);
    if (nextSnapshot === selectorSnapshotRef.current) return;
    selectorSnapshotRef.current = nextSnapshot;
    if (showManualEdit) return;
    setManualText(formatCompatibilityText(vehiclesList));
  }, [vehiclesList, showManualEdit]);

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
      : formatCompatibilityText(vehiclesList);

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

  // Snapshot of what the order already has, to detect unsaved edits before closing.
  const initialSnapshotRef = useRef({
    vehicles: JSON.stringify(order.yardCompatibility?.compatibleVehicles || []),
    images: JSON.stringify(order.yardCompatibility?.referenceImages || []),
    manualText: expandYearRangesInText(order.yardCompatibility?.compatibilityList || '').trim(),
  });

  const isDirty = useMemo(() => {
    const base = initialSnapshotRef.current;
    if (JSON.stringify(images) !== base.images) return true;
    if (JSON.stringify(vehiclesList) !== base.vehicles) return true;
    if (showManualEdit && manualText.trim() !== base.manualText) return true;
    return false;
  }, [images, vehiclesList, showManualEdit, manualText]);

  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const discardSafeRef = useRef<HTMLButtonElement>(null);
  const discardTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isDiscardConfirmOpen) return;
    const timer = window.setTimeout(() => discardSafeRef.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [isDiscardConfirmOpen]);

  const dismissDiscardConfirm = useCallback(() => {
    setIsDiscardConfirmOpen(false);
    window.setTimeout(() => discardTriggerRef.current?.focus({ preventScroll: true }), 0);
  }, []);

  const requestClose = useCallback(() => {
    if (isSaving || isUploading) return;
    if (isDiscardConfirmOpen) { dismissDiscardConfirm(); return; }
    if (isDirty) {
      discardTriggerRef.current = document.activeElement as HTMLElement | null;
      setIsDiscardConfirmOpen(true);
      return;
    }
    onClose();
  }, [isSaving, isUploading, isDiscardConfirmOpen, isDirty, dismissDiscardConfirm, onClose]);

  useEffect(() => {
    registerCloseRequest?.(requestClose);
    return () => registerCloseRequest?.(null);
  }, [registerCloseRequest, requestClose]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility({ open: isOpen, dialogRef, onEscape: requestClose });

  if (!isOpen) return null;

  const currentVehicleLabel = [order.vehicle?.year, order.vehicle?.make, order.vehicle?.model]
    .filter(Boolean)
    .join(' ');
  const photosLabel = `${images.length} ${images.length === 1 ? 'foto' : 'fotos'}`;

  return (
    <>
      <div className="yard-overlay fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in font-sans">
        <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={isBusy}
        tabIndex={-1}
        aria-label={`Compatibilidad y fotos de la orden ${order.code}`}
        className="yard-sheet max-h-[92dvh] w-full max-w-2xl mx-auto flex flex-col animate-sheet-up sm:max-h-[88dvh] sm:overflow-hidden"
      >
        {/* Grabber: solo en móvil */}
        <div className="sm:hidden pt-3 pb-1 flex flex-col items-center select-none">
          <div className="w-12 h-1.5 rounded-full bg-yard-line-strong" />
        </div>

        {/* Header compacto */}
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-yard-line">
          <button
            type="button"
            onClick={requestClose}
            disabled={isSaving || isUploading}
            aria-label="Volver a la cola de patio"
            className="yard-icon-btn shrink-0 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="text-[15px] sm:text-base font-black text-yard-ink leading-tight break-words">
              Compatibilidad y fotos
            </h2>
            <p className="mt-0.5 text-[10.5px] font-mono text-yard-muted break-words">
              #{order.code} · {order.mainPart} · {currentVehicleLabel || 'Vehículo sin datos'}
            </p>
          </div>

          <button
            type="button"
            onClick={requestClose}
            disabled={isSaving || isUploading}
            aria-label="Cerrar"
            className="yard-icon-btn shrink-0 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Contenido desplazable */}
        <div className="flex-1 overflow-y-auto bg-yard-bg p-3 sm:p-4 space-y-3 custom-scrollbar">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-2xl border border-yard-danger bg-yard-danger-soft px-4 py-3 flex items-start gap-2 text-[12px] font-medium text-yard-danger-strong"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span className="leading-snug">{errorMessage}</span>
            </div>
          )}

          {/* VEHÍCULOS COMPATIBLES */}
          <section className="rounded-2xl border border-yard-line bg-yard-surface p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="yard-eyebrow flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-yard-accent-strong">swap_horiz</span>
                  Vehículos compatibles
                </p>
                <p className="mt-1 text-[11px] text-yard-muted">
                  Define marcas, modelos y años que aceptan esta pieza.
                </p>
              </div>
              <span className="yard-chip shrink-0">
                {vehiclesList.length} {vehiclesList.length === 1 ? 'agregado' : 'agregados'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="yard-eyebrow hidden min-[360px]:inline">{showManualEdit ? 'Texto libre' : 'Agregar compatibilidad'}</span>
              <button
                type="button"
                onClick={() => setShowManualEdit(!showManualEdit)}
                disabled={isBusy}
                className="min-h-[44px] px-2.5 rounded-lg text-[10.5px] font-mono font-bold text-yard-accent-strong hover:bg-yard-accent-soft flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
                  {showManualEdit ? 'tune' : 'edit_note'}
                </span>
                <span>{showManualEdit ? 'Usar selectores' : 'Ajustar texto libre'}</span>
              </button>
            </div>

            {!showManualEdit ? (
              <div className="rounded-xl border border-yard-line bg-yard-sunken p-3 space-y-2.5">
                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="block text-[10.5px] font-mono font-bold uppercase tracking-wide text-yard-muted mb-1">
                      1 · Marca
                    </span>
                    <select
                      value={selectedMake}
                      onChange={(e) => handleMakeChange(e.target.value)}
                      disabled={isBusy}
                      className="yard-select"
                    >
                      {makeOptions.map((make) => (
                        <option key={make} value={make}>{make}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="block text-[10.5px] font-mono font-bold uppercase tracking-wide text-yard-muted mb-1">
                      2 · Modelo
                    </span>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      disabled={isBusy}
                      className="yard-select"
                    >
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="block text-[10.5px] font-mono font-bold uppercase tracking-wide text-yard-muted mb-1">
                      3 · Año desde
                    </span>
                    <select
                      value={selectedYearFrom}
                      onChange={(e) => setSelectedYearFrom(Number(e.target.value))}
                      disabled={isBusy}
                      className="yard-select"
                    >
                      {yearOptions.map((yr) => (
                        <option key={yr} value={yr}>{yr}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="block text-[10.5px] font-mono font-bold uppercase tracking-wide text-yard-muted mb-1">
                      4 · Año hasta
                    </span>
                    <select
                      value={selectedYearTo}
                      onChange={(e) => setSelectedYearTo(Number(e.target.value))}
                      disabled={isBusy}
                      className="yard-select"
                    >
                      {yearOptions.map((yr) => (
                        <option key={yr} value={yr}>{yr}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleAddCurrentOrderVehicle}
                  disabled={isBusy}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-yard-line bg-yard-surface text-yard-ink-soft hover:bg-yard-raised font-mono font-bold text-[10.5px] flex items-center justify-center gap-1.5 text-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-yard-accent-strong">bolt</span>
                  <span className="truncate">
                    Copiar vehículo de la orden<span className="hidden sm:inline"> ({currentVehicleLabel})</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleAddVehicle}
                  disabled={isBusy}
                  className="yard-btn yard-btn--primary w-full"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">add_circle</span>
                  <span>Agregar a compatibilidad</span>
                </button>
              </div>
            ) : (
              <textarea
                rows={6}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                disabled={isBusy}
                placeholder={`Compatibilidad\n*Nissan Pathfinder: 2015 y 2016.\n*Infiniti QX60: 2015 y 2016.`}
                className="yard-textarea disabled:opacity-60 disabled:cursor-not-allowed"
              />
            )}

            {!showManualEdit && vehiclesList.length === 0 && (
              <div className="rounded-xl border border-dashed border-yard-line-strong bg-yard-sunken px-4 py-5 text-center">
                <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-yard-muted">directions_car</span>
                <p className="mt-1 text-[11.5px] font-bold text-yard-ink-soft">Aún no hay vehículos compatibles</p>
                <p className="text-[10.5px] text-yard-muted">Agrega marca, modelo y años arriba.</p>
              </div>
            )}

            {vehiclesList.length > 0 && (
              <div className="space-y-2 sm:max-h-56 sm:overflow-y-auto custom-scrollbar pr-0.5">
                {vehiclesList.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="flex items-center gap-2.5 p-2 pl-2.5 rounded-xl border border-yard-line bg-yard-sunken"
                  >
                    <span className="w-6 h-6 shrink-0 rounded-lg bg-yard-accent-soft text-yard-accent-strong border border-yard-accent/40 flex items-center justify-center text-[11px] font-mono font-black">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-bold text-yard-ink truncate">
                        {item.make} {item.model}
                      </p>
                      <p className="text-[10.5px] font-mono font-bold text-yard-accent-strong">
                        {item.yearFrom === item.yearTo ? item.yearFrom : `${item.yearFrom} – ${item.yearTo}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveVehicle(item.id, idx)}
                      disabled={isBusy}
                      aria-label={`Eliminar ${item.make} ${item.model}`}
                      className="shrink-0 w-11 h-11 rounded-xl border border-yard-line bg-yard-surface text-yard-muted hover:text-yard-danger-strong hover:border-yard-danger/50 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {vehiclesList.length > 0 && !showManualEdit && (
              <div className="rounded-xl border border-yard-line bg-yard-sunken p-3 space-y-1.5">
                <p className="yard-eyebrow">Vista previa del texto para patio</p>
                <div className="whitespace-pre-line font-mono text-[11px] leading-relaxed text-yard-ink-soft">
                  {formatCompatibilityText(vehiclesList)}
                </div>
              </div>
            )}
          </section>

          {/* FOTOS DE REFERENCIA */}
          <section className="rounded-2xl border border-yard-line bg-yard-surface p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="yard-eyebrow flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-yard-accent-strong">photo_library</span>
                  Fotos de referencia
                </p>
                <p className="mt-1 text-[11px] text-yard-muted">
                  Frente, convertidor, acoples, carcasa y etiquetas para que patio verifique la pieza.
                </p>
              </div>
              <span className="yard-chip shrink-0">{photosLabel}</span>
            </div>

            <p className="sr-only" role="status" aria-live="polite">
              {isUploading
                ? uploadProgress || 'Subiendo imágenes…'
                : `${photosLabel} de referencia`}
            </p>

            {/* Acciones táctiles: cámara y galería */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isUploading || isSaving}
                onClick={() => cameraInputRef.current?.click()}
                className="yard-btn yard-btn--secondary text-[11px]"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">photo_camera</span>
                <span>Tomar foto</span>
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
                className="yard-btn yard-btn--ghost text-[11px]"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">collections</span>
                <span>Galería / archivos</span>
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

            {isUploading && (
              <div className="min-h-[40px] px-3 rounded-xl bg-yard-accent-soft border border-yard-accent text-yard-accent-strong text-[11px] font-mono font-bold flex items-center justify-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] animate-spin" aria-hidden="true">progress_activity</span>
                <span>{uploadProgress || 'Subiendo imágenes…'}</span>
              </div>
            )}

            {/* Dropzone para escritorio */}
            <div className="hidden sm:flex border-2 border-dashed border-yard-line-strong hover:border-yard-accent rounded-xl p-4 text-center bg-yard-sunken transition-colors relative items-center justify-center">
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={isUploading || isSaving}
                onChange={handleFilesSelected}
                aria-label="Arrastrar o elegir fotos de referencia"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="flex flex-col items-center justify-center gap-1 pointer-events-none">
                <span aria-hidden="true" className="material-symbols-outlined text-yard-accent-strong text-[26px]">add_photo_alternate</span>
                <span className="text-[11.5px] font-bold text-yard-ink-soft">
                  {isUploading ? uploadProgress || 'Subiendo imágenes…' : 'O arrastra fotos aquí'}
                </span>
                <span className="text-[10.5px] text-yard-muted">
                  JPG, PNG o WebP · hasta 10 MB c/u · selección múltiple
                </span>
              </div>
            </div>

            {images.length === 0 ? (
              <div className="sm:hidden rounded-xl border border-dashed border-yard-line-strong bg-yard-sunken px-4 py-4 text-center">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-yard-muted">hide_image</span>
                <p className="mt-1 text-[11px] font-bold text-yard-ink-soft">Sin fotos todavía</p>
                <p className="text-[10.5px] text-yard-muted">Usa la cámara o la galería para agregarlas.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {images.map((imgUrl, index) => (
                  <div
                    key={index}
                    className="relative rounded-xl overflow-hidden border border-yard-line bg-yard-sunken aspect-square"
                  >
                    <img
                      src={imgUrl}
                      alt={`Referencia ${index + 1}`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      disabled={isBusy}
                      aria-label={`Eliminar foto ${index + 1}`}
                      className="absolute top-1.5 right-1.5 w-11 h-11 rounded-xl bg-black/65 text-white hover:bg-yard-danger-strong flex items-center justify-center backdrop-blur-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                    <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-[9px] font-mono font-bold text-white">
                      #{index + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer de acciones */}
        <div className="border-t border-yard-line bg-yard-surface px-3 sm:px-4 pt-3 pb-3 safe-bottom-padded flex flex-wrap items-center gap-2 sm:justify-between">
          <button
            type="button"
            onClick={requestClose}
            disabled={isSaving || isUploading}
            className="yard-btn yard-btn--ghost order-2 sm:order-none flex-1 sm:flex-none px-4"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isUploading}
            className="yard-btn yard-btn--primary order-first w-full sm:order-none sm:w-auto sm:min-w-[260px]"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              {isSaving ? 'hourglass_top' : 'save'}
            </span>
            <span className="truncate">{isSaving ? 'Guardando…' : 'Guardar compatibilidad y fotos'}</span>
          </button>
        </div>
        </div>
      </div>

      {isDiscardConfirmOpen && (
        <div
          className="yard-discard-modal fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={(event) => {
            if (event.target === event.currentTarget) dismissDiscardConfirm();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="yard-discard-title"
            aria-describedby="yard-discard-desc"
            tabIndex={-1}
            className="w-full max-w-sm rounded-3xl border border-yard-line bg-yard-surface p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          >
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 shrink-0 rounded-2xl bg-yard-accent-soft border border-yard-accent/40 text-yard-accent-strong flex items-center justify-center">
                <span aria-hidden="true" className="material-symbols-outlined text-[22px]">edit_note</span>
              </span>
              <div className="min-w-0">
                <h3 id="yard-discard-title" className="text-[15px] font-black text-yard-ink leading-tight">
                  ¿Descartar cambios?
                </h3>
                <p id="yard-discard-desc" className="mt-1 text-[11.5px] text-yard-muted leading-snug">
                  La compatibilidad o las fotos que editaste todavía no se guardaron.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                ref={discardSafeRef}
                type="button"
                onClick={dismissDiscardConfirm}
                className="yard-btn yard-btn--primary"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsDiscardConfirmOpen(false);
                  onClose();
                }}
                className="yard-btn yard-btn--danger"
              >
                Descartar cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
