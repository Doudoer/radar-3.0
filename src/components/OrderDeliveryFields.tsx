import React, { useRef, useState } from 'react';
import { uploadDownpaymentReceipt } from './DownpaymentConfirmation';

export const OrderImageFields: React.FC<{
  label: string; description: string; imageLabel: string; photos: string[]; onChange: (photos: string[]) => void;
  disabled?: boolean; required?: boolean; removeLabel?: string; onUpload: (file: File) => Promise<string>;
  onUploadingChange?: (active: boolean) => void;
}> = ({ label, description, imageLabel, photos, onChange, disabled, required = false, removeLabel = 'Quitar imagen', onUpload, onUploadingChange }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const upload = async (files: File[]) => {
    if (inFlight.current) return;
    if (files.length + photos.length > 20) { setError('Adjunta un máximo de 20 imágenes.'); return; }
    inFlight.current = true; setUploading(true); onUploadingChange?.(true); setError('');
    const saved = [...photos];
    try {
      for (const file of files) {
        saved.push(await onUpload(file));
        onChange([...saved]);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron subir las imágenes.'); }
    finally { inFlight.current = false; setUploading(false); onUploadingChange?.(false); }
  };
  return <section className="space-y-3">
    <fieldset disabled={disabled || uploading} className="min-w-0 space-y-3">
      <label className="flex min-w-0 flex-col gap-2 text-sm">{label}
        <input className="w-full min-w-0 max-w-full" type="file" multiple required={required && !photos.length} accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => {
          const files = Array.from<File>(event.currentTarget.files || []); event.currentTarget.value = '';
          if (files.length) void upload(files);
        }} />
      </label>
      <p className="text-xs">{description} Máximo 20 imágenes, de hasta 10 MB cada una.</p>
      {photos.map((url, index) => <div key={`${url}-${index}`} className="flex flex-wrap gap-3 text-sm">
        <a href={url} target="_blank" rel="noreferrer" className="underline">{imageLabel} {index + 1}</a>
        <button type="button" className="underline" onClick={() => onChange(photos.filter((_, i) => i !== index))}>{removeLabel} {index + 1}</button>
      </div>)}
    </fieldset>
    {uploading && <p role="status">Subiendo imágenes…</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </section>;
};

export const OrderDeliveryFields: React.FC<{
  orderId: string; customerName: string; photos: string[]; onChange: (photos: string[]) => void;
  disabled?: boolean; onUploadingChange: (active: boolean) => void;
}> = ({ customerName, orderId, ...props }) => <section className="space-y-3">
  <p className="text-sm">Persona que recibe la pieza: <strong>{customerName}</strong> · Cliente de la orden</p>
  <OrderImageFields {...props} onUpload={file => uploadDownpaymentReceipt(orderId, file)} label="Evidencia de entrega · imágenes de la pieza (opcional)"
    description="Puedes confirmar sin fotos o adjuntar una o varias imágenes de la pieza." imageLabel="Ver imagen de entrega" />
</section>;
