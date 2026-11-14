import React, { useRef, useState } from 'react';
import { uploadDownpaymentReceipt } from './DownpaymentConfirmation';

export const OrderImageFields: React.FC<{
  label: string;
  description: string;
  imageLabel: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled?: boolean;
  required?: boolean;
  removeLabel?: string;
  onUpload: (file: File) => Promise<string>;
  onUploadingChange?: (active: boolean) => void;
}> = ({
  label,
  description,
  imageLabel,
  photos,
  onChange,
  disabled,
  required = false,
  removeLabel = 'Quitar imagen',
  onUpload,
  onUploadingChange,
}) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const upload = async (files: File[]) => {
    if (inFlight.current) return;
    if (files.length + photos.length > 20) {
      setError('Adjunta un máximo de 20 imágenes.');
      return;
    }
    inFlight.current = true;
    setUploading(true);
    onUploadingChange?.(true);
    setError('');
    const saved = [...photos];
    try {
      for (const file of files) {
        saved.push(await onUpload(file));
        onChange([...saved]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron subir las imágenes.');
    } finally {
      inFlight.current = false;
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  return (
    <section className="space-y-4">
      <fieldset disabled={disabled || uploading} className="min-w-0 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-primary-400 text-base">photo_library</span>
            {label}
          </label>
          <span className="text-[11px] text-slate-400 font-medium">
            {photos.length}/20 imágenes ({description})
          </span>
        </div>

        {/* Visual Drag & Drop Upload Zone */}
        <label className={`relative group flex flex-col items-center justify-center p-5 sm:p-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
          disabled || uploading
            ? 'opacity-60 cursor-not-allowed border-slate-700 bg-slate-900/40'
            : 'border-slate-700/80 hover:border-primary-500/70 bg-slate-900/50 hover:bg-primary-950/20'
        }`}>
          <input
            className="sr-only"
            type="file"
            multiple
            required={required && !photos.length}
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={event => {
              const files = Array.from<File>(event.currentTarget.files || []);
              event.currentTarget.value = '';
              if (files.length) void upload(files);
            }}
          />
          <div className="p-3 rounded-full bg-primary-500/10 text-primary-400 group-hover:bg-primary-500/20 group-hover:scale-110 transition-all mb-2">
            <span aria-hidden="true" className="material-symbols-outlined text-2xl sm:text-3xl">add_photo_alternate</span>
          </div>
          <div className="text-center">
            <p className="text-xs sm:text-sm font-medium text-slate-200">
              <span className="text-primary-400 font-semibold underline decoration-primary-500/50 underline-offset-2">Haz clic para subir</span> o arrastra tus imágenes aquí
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              JPG, PNG, WebP o GIF (hasta 10 MB c/u)
            </p>
          </div>
        </label>

        {/* Visual Gallery Grid of Uploaded Photos */}
        {photos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2">
            {photos.map((url, index) => (
              <div
                key={`${url}-${index}`}
                className="group relative rounded-xl overflow-hidden border border-slate-700/80 bg-slate-900/80 aspect-video sm:aspect-square flex flex-col justify-end p-2.5 shadow-md"
              >
                <img
                  src={url}
                  alt={`Evidencia ${index + 1}`}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  onError={e => {
                    // Fallback to placeholder if image fails to render
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-transparent pointer-events-none" />

                <div className="relative z-10 flex items-center justify-between gap-1 w-full">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-semibold text-white/90 hover:text-primary-400 truncate flex items-center gap-1 drop-shadow"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-xs">visibility</span>
                    <span>{imageLabel} {index + 1}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => onChange(photos.filter((_, i) => i !== index))}
                    className="p-1 rounded-lg bg-red-500/80 hover:bg-red-500 text-white transition-all shadow-sm shrink-0"
                    title={`${removeLabel} ${index + 1}`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-xs">delete</span>
                    <span className="sr-only">{removeLabel} {index + 1}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      {uploading && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-primary-950/40 border border-primary-500/40 text-primary-300 text-xs sm:text-sm animate-pulse">
          <span aria-hidden="true" className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
          <p role="status">Subiendo y procesando imágenes…</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs sm:text-sm">
          <span aria-hidden="true" className="material-symbols-outlined text-lg">error</span>
          <p role="alert">{error}</p>
        </div>
      )}
    </section>
  );
};

export const OrderDeliveryFields: React.FC<{
  orderId: string;
  customerName: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled?: boolean;
  onUploadingChange: (active: boolean) => void;
}> = ({ customerName, orderId, ...props }) => (
  <section className="space-y-4">
    {/* Visual Receiver Banner / Hero Card */}
    <div className="rounded-2xl p-4 sm:p-5 bg-gradient-to-r from-cyan-950/60 to-slate-900/60 border border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.12)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 shrink-0">
            <span aria-hidden="true" className="material-symbols-outlined text-2xl">local_shipping</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-base sm:text-lg text-slate-100">
                Entrega Física y Cierre Comercial
              </h4>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider bg-cyan-500/30 text-cyan-300">
                Paso Final
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Persona que recibe la pieza: <strong className="text-cyan-300 font-semibold">{customerName}</strong> · Cliente de la orden
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-900/30 border border-cyan-500/30 text-cyan-200 text-xs self-start sm:self-auto">
          <span aria-hidden="true" className="material-symbols-outlined text-base">verified</span>
          <span>Garantía activa al entregar</span>
        </div>
      </div>
    </div>

    {/* Modern Gallery & Photo Upload */}
    <OrderImageFields
      {...props}
      onUpload={file => uploadDownpaymentReceipt(orderId, file)}
      label="Evidencia de entrega · imágenes de la pieza (opcional)"
      description="Puedes confirmar sin fotos o adjuntar una o varias imágenes de la pieza opcional."
      imageLabel="Ver imagen de entrega"
    />
  </section>
);
