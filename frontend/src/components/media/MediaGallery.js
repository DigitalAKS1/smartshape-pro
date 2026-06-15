import React, { useState } from 'react';
import { Scissors, Expand } from 'lucide-react';
import Lightbox from './Lightbox';

export default function MediaGallery({ images = [], alt = '', backendUrl = '', className = '' }) {
  const [open, setOpen] = useState(false);
  const list = (images || []).filter(Boolean);
  const primary = list[0];
  const extra = list.length - 1;

  return (
    <>
      <div className={`relative w-full h-full ${className}`}>
        {primary ? (
          <button type="button" onClick={() => setOpen(true)} className="group block w-full h-full" aria-label="View photos">
            <img src={`${backendUrl}${primary}`} alt={alt} className="w-full h-full object-contain p-2" />
            <span className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <Expand className="h-3.5 w-3.5" />
            </span>
            {extra > 0 && (
              <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/55 text-white">+{extra}</span>
            )}
          </button>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
            <Scissors className="h-6 w-6 opacity-20" />
          </div>
        )}
      </div>
      {open && <Lightbox images={list} index={0} backendUrl={backendUrl} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
