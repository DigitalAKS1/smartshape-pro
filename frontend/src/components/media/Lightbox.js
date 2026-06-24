import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

export default function Lightbox({ images, index = 0, onClose, backendUrl = '', alt = '' }) {
  const [i, setI] = useState(index);
  const [zoom, setZoom] = useState(1);
  const touchX = React.useRef(null);

  const total = images?.length || 0;
  const clamp = useCallback((n) => (n + total) % total, [total]);
  const go = useCallback((n) => { setI(clamp(n)); setZoom(1); }, [clamp]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [i, go, onClose]);

  if (!total) return null;
  const src = `${backendUrl}${images[i]}`;
  const zoomBy = (d) => setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + d).toFixed(2))));

  // Render to document.body via a portal: the lightbox is position:fixed, but a
  // transformed ancestor (e.g. a card's hover:-translate-y-1) would otherwise become
  // its containing block and trap it inside that card instead of the viewport.
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col" onClick={onClose}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white/80" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-mono">{i + 1} / {total}</span>
        <button onClick={onClose} aria-label="Close"><X className="h-6 w-6 hover:text-white" /></button>
      </div>

      {/* Stage */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={e => e.stopPropagation()}
        onWheel={e => zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)}
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchX.current == null || zoom !== 1) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1);
          touchX.current = null;
        }}>
        {total > 1 && (
          <button onClick={() => go(i - 1)} className="absolute left-2 sm:left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white" aria-label="Previous">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <img src={src} alt={alt} draggable={false}
          className="max-h-full max-w-full object-contain transition-transform duration-150 select-none"
          style={{ transform: `scale(${zoom})` }} />
        {total > 1 && (
          <button onClick={() => go(i + 1)} className="absolute right-2 sm:right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white" aria-label="Next">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-3 py-2 text-white/80" onClick={e => e.stopPropagation()}>
        <button onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30" aria-label="Zoom out"><ZoomOut className="h-5 w-5" /></button>
        <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30" aria-label="Zoom in"><ZoomIn className="h-5 w-5" /></button>
      </div>

      {/* Thumbnail strip */}
      {total > 1 && (
        <div className="flex items-center justify-center gap-2 px-4 pb-4 overflow-x-auto no-scrollbar" onClick={e => e.stopPropagation()}>
          {images.map((u, idx) => (
            <button key={u} onClick={() => go(idx)}
              className={`shrink-0 w-12 h-12 rounded-md overflow-hidden border-2 ${idx === i ? 'border-[#e94560]' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              <img src={`${backendUrl}${u}`} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
