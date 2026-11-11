import React, { useState } from 'react';

interface YardPhotoGalleryProps {
  images: string[];
  maxThumbnails?: number;
}

export const YardPhotoGallery: React.FC<YardPhotoGalleryProps> = ({
  images,
  maxThumbnails = 4,
}) => {
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  if (!images || images.length === 0) return null;

  const total = images.length;
  const visibleImages = images.slice(0, maxThumbnails);
  const remainingCount = total - maxThumbnails;

  const handleOpenLightbox = (index: number) => {
    setActiveLightboxIndex(index);
    setZoomLevel(1);
  };

  const handleCloseLightbox = () => {
    setActiveLightboxIndex(null);
    setZoomLevel(1);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeLightboxIndex !== null) {
      setActiveLightboxIndex((activeLightboxIndex - 1 + total) % total);
      setZoomLevel(1);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeLightboxIndex !== null) {
      setActiveLightboxIndex((activeLightboxIndex + 1) % total);
      setZoomLevel(1);
    }
  };

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel((prev) => Math.min(prev + 0.5, 3));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel((prev) => Math.max(prev - 0.5, 1));
  };

  return (
    <div className="space-y-2">
      {/* Thumbnails grid */}
      <div
        className={`grid gap-2 rounded-xl overflow-hidden ${
          visibleImages.length === 1
            ? 'grid-cols-1'
            : visibleImages.length === 2
            ? 'grid-cols-2'
            : 'grid-cols-2 sm:grid-cols-4'
        }`}
      >
        {visibleImages.map((url, idx) => {
          const isLastAndOverflowing = idx === maxThumbnails - 1 && remainingCount > 0;

          return (
            <div
              key={idx}
              onClick={() => handleOpenLightbox(idx)}
              className="relative aspect-square bg-slate-950 rounded-xl overflow-hidden cursor-pointer group border border-slate-800 hover:border-amber-500/50 transition-all shadow-sm"
            >
              <img
                src={url}
                alt={`Foto referencia ${idx + 1}`}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              />
              <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />

              {/* +N Overlay on the last thumbnail (WhatsApp style) */}
              {isLastAndOverflowing && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px] flex items-center justify-center text-white font-mono font-black text-lg sm:text-xl">
                  +{remainingCount + 1}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lightbox Modal */}
      {activeLightboxIndex !== null && (
        <div
          onClick={handleCloseLightbox}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-3 sm:p-6 bg-black/95 backdrop-blur-md animate-fade-in font-mono"
        >
          {/* Lightbox Controls Header */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl flex items-center justify-between pb-3 text-white border-b border-slate-800"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-[20px]">photo_camera</span>
              <span className="text-xs sm:text-sm font-bold">
                Foto {activeLightboxIndex + 1} de {total}
              </span>
            </div>

            {/* Zoom & Close controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoomLevel <= 1}
                title="Alejar"
                className="p-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">zoom_out</span>
              </button>
              <span className="text-[11px] text-slate-400 w-12 text-center">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoomLevel >= 3}
                title="Acercar"
                className="p-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">zoom_in</span>
              </button>

              <button
                type="button"
                onClick={handleCloseLightbox}
                title="Cerrar (Esc)"
                className="p-1.5 rounded-lg border border-rose-500/40 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 transition-all ml-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          {/* Main Image Viewport */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex-1 w-full max-w-4xl flex items-center justify-center overflow-hidden my-3 select-none"
          >
            {/* Prev Button */}
            {total > 1 && (
              <button
                type="button"
                onClick={handlePrev}
                title="Anterior"
                className="absolute left-2 sm:left-4 z-10 p-2 sm:p-3 rounded-full bg-slate-900/80 hover:bg-amber-500 text-white hover:text-slate-950 border border-slate-700 transition-all shadow-lg cursor-pointer"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_left</span>
              </button>
            )}

            <img
              src={images[activeLightboxIndex]}
              alt={`Foto de referencia ${activeLightboxIndex + 1}`}
              style={{ transform: `scale(${zoomLevel})` }}
              className="max-h-[75vh] max-w-full object-contain rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.8)] transition-transform duration-150"
            />

            {/* Next Button */}
            {total > 1 && (
              <button
                type="button"
                onClick={handleNext}
                title="Siguiente"
                className="absolute right-2 sm:right-4 z-10 p-2 sm:p-3 rounded-full bg-slate-900/80 hover:bg-amber-500 text-white hover:text-slate-950 border border-slate-700 transition-all shadow-lg cursor-pointer"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_right</span>
              </button>
            )}
          </div>

          {/* Bottom Thumbnails Strip in Lightbox */}
          {total > 1 && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl flex items-center justify-center gap-2 overflow-x-auto py-2 custom-scrollbar"
            >
              {images.map((url, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setActiveLightboxIndex(idx);
                    setZoomLevel(1);
                  }}
                  className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 cursor-pointer ${
                    activeLightboxIndex === idx
                      ? 'border-amber-400 scale-105 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                      : 'border-slate-800 opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={url} alt={`Thumb ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

