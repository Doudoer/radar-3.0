import React, { useState, useEffect, useRef, useCallback } from 'react';

interface YardPhotoGalleryProps {
  images: string[];
  maxThumbnails?: number;
  lightboxIndex: number | null;
  onLightboxIndexChange: (index: number | null) => void;
}

export const YardPhotoGallery: React.FC<YardPhotoGalleryProps> = ({
  images,
  maxThumbnails = 4,
  lightboxIndex,
  onLightboxIndexChange,
}) => {
  const activeLightboxIndex = lightboxIndex;
  const [scale, setScale] = useState<number>(1);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [swipeDismissY, setSwipeDismissY] = useState<number>(0);

  // References to keep gesture state without triggering re-render cascades
  const gestureRef = useRef({
    isPinching: false,
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
    lastTapTime: 0,
    isDragging: false,
    touchCount: 0,
    deltaX: 0,
    deltaY: 0,
  });

  const imgContainerRef = useRef<HTMLDivElement>(null);

  if (!images || images.length === 0) return null;

  const total = images.length;
  const visibleImages = images.slice(0, maxThumbnails);
  const remainingCount = total - maxThumbnails;

  const resetZoomAndPosition = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setSwipeDismissY(0);
  }, []);

  const handleOpenLightbox = (index: number) => {
    onLightboxIndexChange(index);
    resetZoomAndPosition();
  };

  const handleCloseLightbox = useCallback(() => {
    onLightboxIndexChange(null);
    resetZoomAndPosition();
  }, [onLightboxIndexChange, resetZoomAndPosition]);

  const handlePrev = useCallback(() => {
    if (lightboxIndex !== null) {
      onLightboxIndexChange((lightboxIndex - 1 + total) % total);
      resetZoomAndPosition();
    }
  }, [lightboxIndex, total, onLightboxIndexChange, resetZoomAndPosition]);

  const handleNext = useCallback(() => {
    if (lightboxIndex !== null) {
      onLightboxIndexChange((lightboxIndex + 1) % total);
      resetZoomAndPosition();
    }
  }, [lightboxIndex, total, onLightboxIndexChange, resetZoomAndPosition]);

  // Keyboard navigation (Arrow keys). Escape lo gestiona la pila de overlays del portal.
  useEffect(() => {
    if (activeLightboxIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeLightboxIndex, handlePrev, handleNext]);

  // Prevent background scroll while lightbox is open
  useEffect(() => {
    if (activeLightboxIndex !== null) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [activeLightboxIndex]);

  // Double tap / double click zoom toggle (1x <-> 2.5x)
  const handleDoubleTap = (clientX: number, clientY: number) => {
    if (scale > 1) {
      resetZoomAndPosition();
    } else {
      const targetScale = 2.5;
      if (imgContainerRef.current) {
        const rect = imgContainerRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const offsetX = (centerX - clientX) * (targetScale - 1);
        const offsetY = (centerY - clientY) * (targetScale - 1);
        setPosition({ x: offsetX, y: offsetY });
      }
      setScale(targetScale);
    }
  };

  // Touch Handlers for Pinch, Pan, Double-tap, and Swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    const touches = e.touches;
    gestureRef.current.touchCount = touches.length;

    if (touches.length === 2) {
      // Pinch start
      gestureRef.current.isPinching = true;
      gestureRef.current.startDistance = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      gestureRef.current.startScale = scale;
      gestureRef.current.isDragging = false;
    } else if (touches.length === 1) {
      // Single touch start
      gestureRef.current.isPinching = false;
      gestureRef.current.startX = touches[0].clientX;
      gestureRef.current.startY = touches[0].clientY;
      gestureRef.current.startPosX = position.x;
      gestureRef.current.startPosY = position.y;
      gestureRef.current.deltaX = 0;
      gestureRef.current.deltaY = 0;
      gestureRef.current.isDragging = true;

      // Double tap check (within 300ms)
      const now = Date.now();
      if (now - gestureRef.current.lastTapTime < 300) {
        handleDoubleTap(touches[0].clientX, touches[0].clientY);
        gestureRef.current.lastTapTime = 0;
        gestureRef.current.isDragging = false;
      } else {
        gestureRef.current.lastTapTime = now;
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touches = e.touches;

    if (gestureRef.current.isPinching && touches.length === 2) {
      // Handle pinch zoom
      const currentDist = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      if (gestureRef.current.startDistance > 0) {
        const ratio = currentDist / gestureRef.current.startDistance;
        const newScale = Math.min(Math.max(gestureRef.current.startScale * ratio, 1), 4);
        setScale(newScale);
        if (newScale <= 1) {
          setPosition({ x: 0, y: 0 });
        }
      }
    } else if (touches.length === 1 && gestureRef.current.isDragging) {
      const deltaX = touches[0].clientX - gestureRef.current.startX;
      const deltaY = touches[0].clientY - gestureRef.current.startY;
      gestureRef.current.deltaX = deltaX;
      gestureRef.current.deltaY = deltaY;

      if (scale > 1) {
        // Panning inside zoomed image
        const maxPanX = (imgContainerRef.current?.clientWidth || 300) * (scale - 1) * 0.55;
        const maxPanY = (imgContainerRef.current?.clientHeight || 400) * (scale - 1) * 0.55;

        const nextX = Math.min(Math.max(gestureRef.current.startPosX + deltaX, -maxPanX), maxPanX);
        const nextY = Math.min(Math.max(gestureRef.current.startPosY + deltaY, -maxPanY), maxPanY);

        setPosition({ x: nextX, y: nextY });
      } else {
        // When scale === 1, track pull-down to dismiss (like WhatsApp / iOS)
        if (deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
          setSwipeDismissY(deltaY);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const { deltaX, deltaY, isPinching } = gestureRef.current;
    gestureRef.current.isDragging = false;

    if (isPinching) {
      gestureRef.current.isPinching = false;
      if (scale < 1.05) {
        resetZoomAndPosition();
      }
      return;
    }

    if (scale <= 1) {
      // Check swipe-down dismiss
      if (swipeDismissY > 90) {
        handleCloseLightbox();
        return;
      } else {
        setSwipeDismissY(0);
      }

      // Check horizontal swipe navigation
      if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 60) {
        if (deltaX < 0) {
          handleNext();
        } else {
          handlePrev();
        }
      }
    }
  };

  // Mouse wheel zoom for desktop
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setScale((prev) => Math.min(prev + 0.3, 4));
    } else {
      setScale((prev) => {
        const next = Math.max(prev - 0.3, 1);
        if (next === 1) setPosition({ x: 0, y: 0 });
        return next;
      });
    }
  };

  // Mouse drag for desktop pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    gestureRef.current.isDragging = true;
    gestureRef.current.startX = e.clientX;
    gestureRef.current.startY = e.clientY;
    gestureRef.current.startPosX = position.x;
    gestureRef.current.startPosY = position.y;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!gestureRef.current.isDragging || scale <= 1) return;
    const deltaX = e.clientX - gestureRef.current.startX;
    const deltaY = e.clientY - gestureRef.current.startY;

    const maxPanX = (imgContainerRef.current?.clientWidth || 300) * (scale - 1) * 0.55;
    const maxPanY = (imgContainerRef.current?.clientHeight || 400) * (scale - 1) * 0.55;

    setPosition({
      x: Math.min(Math.max(gestureRef.current.startPosX + deltaX, -maxPanX), maxPanX),
      y: Math.min(Math.max(gestureRef.current.startPosY + deltaY, -maxPanY), maxPanY),
    });
  };

  const handleMouseUp = () => {
    gestureRef.current.isDragging = false;
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
            <button
              key={idx}
              type="button"
              onClick={() => handleOpenLightbox(idx)}
              aria-label={`Ver foto de referencia ${idx + 1} de ${total}`}
              aria-haspopup="dialog"
              className="relative aspect-square bg-slate-950 rounded-xl overflow-hidden cursor-pointer group border border-slate-800 hover:border-amber-500/50 transition-all shadow-sm"
            >
              <img
                src={url}
                alt=""
                aria-hidden="true"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />

              {/* +N Overlay on the last thumbnail */}
              {isLastAndOverflowing && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-white font-mono font-black text-lg sm:text-xl">
                  +{remainingCount + 1}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* WhatsApp-Style Lightbox Modal */}
      {activeLightboxIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fotos de referencia"
          tabIndex={-1}
          className="yard-lightbox fixed inset-0 z-[120] flex flex-col justify-between bg-black text-white select-none transition-opacity duration-150"
          style={{
            '--lightbox-fade': Math.max(0.7, 1 - swipeDismissY / 300),
          } as React.CSSProperties}
        >
          {/* Top Bar - WhatsApp Style (Back/Close, Counter, Reset zoom) */}
          <div className="relative z-30 flex items-center justify-between px-3 py-3 bg-gradient-to-b from-black/80 to-transparent">
            {/* Close button with back icon (WhatsApp style) */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCloseLightbox}
                className="w-11 h-11 -ml-1 flex items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors cursor-pointer"
                aria-label="Cerrar visor"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-wide text-white">
                  {activeLightboxIndex + 1} / {total}
                </span>
                <span className="text-[10px] text-white/60">
                  {scale > 1 ? `${Math.round(scale * 100)}% zoom · Desliza para mover` : 'Pellizca o doble toque para zoom'}
                </span>
              </div>
            </div>

            {/* Quick Actions (Reset Zoom, Close X) */}
            <div className="flex items-center gap-1">
              {scale > 1 && (
                <button
                  type="button"
                  onClick={resetZoomAndPosition}
                  className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/15 hover:bg-white/25 text-white transition-all cursor-pointer mr-1"
                >
                  100%
                </button>
              )}
              <button
                type="button"
                onClick={handleCloseLightbox}
                className="w-11 h-11 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Cerrar"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>
          </div>

          {/* Main Image Viewport with Touch/Pinch/Pan handling */}
          <div
            ref={imgContainerRef}
            className="relative flex-1 w-full flex items-center justify-center overflow-hidden touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
          >
            {/* Previous Photo Button (Subtle, desktop & tablet) */}
            {total > 1 && scale === 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                className="absolute left-2 sm:left-4 z-20 p-2.5 sm:p-3 rounded-full bg-black/40 hover:bg-black/70 text-white/90 hover:text-white backdrop-blur-sm transition-all border border-white/10 cursor-pointer hidden sm:flex items-center justify-center"
                aria-label="Foto anterior"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[24px]">chevron_left</span>
              </button>
            )}

            {/* Active Image with transform for pinch-zoom and pan */}
            <div
              className="flex items-center justify-center w-full h-full"
              style={{
                transform: `translate3d(${position.x}px, ${position.y + swipeDismissY}px, 0px) scale(${scale})`,
                transition: gestureRef.current.isDragging || gestureRef.current.isPinching ? 'none' : 'transform 0.18s ease-out',
                cursor: scale > 1 ? (gestureRef.current.isDragging ? 'grabbing' : 'grab') : 'default',
              }}
            >
              <img
                src={images[activeLightboxIndex]}
                alt={`Foto de referencia ${activeLightboxIndex + 1}`}
                draggable={false}
                className="max-h-[80vh] max-w-full w-auto h-auto object-contain pointer-events-none select-none drop-shadow-[0_10px_25px_rgba(0,0,0,0.9)]"
              />
            </div>

            {/* Next Photo Button (Subtle, desktop & tablet) */}
            {total > 1 && scale === 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                className="absolute right-2 sm:right-4 z-20 p-2.5 sm:p-3 rounded-full bg-black/40 hover:bg-black/70 text-white/90 hover:text-white backdrop-blur-sm transition-all border border-white/10 cursor-pointer hidden sm:flex items-center justify-center"
                aria-label="Foto siguiente"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[24px]">chevron_right</span>
              </button>
            )}
          </div>

          {/* Bottom Thumbnail Strip - WhatsApp Style */}
          <div className="relative z-30 px-3 py-3 bg-gradient-to-t from-black/90 to-transparent">
            {total > 1 && (
              <div className="flex items-center justify-center gap-2 overflow-x-auto py-1 max-w-screen-md mx-auto scrollbar-none">
                {images.map((url, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      handleOpenLightbox(idx);
                    }}
                    className={`relative w-11 h-11 sm:w-13 sm:h-13 rounded-lg overflow-hidden flex-shrink-0 transition-all cursor-pointer ${
                      activeLightboxIndex === idx
                        ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-black scale-105 opacity-100'
                        : 'opacity-40 hover:opacity-80'
                    }`}
                  >
                    <img
                      src={url}
                      alt={`Miniatura ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
