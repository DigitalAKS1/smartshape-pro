import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { youtubeEmbedUrl } from '../../lib/youtube';

export default function VideoModal({ url, title, open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const embed = youtubeEmbedUrl(url);

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative w-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-white/80 hover:text-white" aria-label="Close video">
          <X className="h-6 w-6" />
        </button>
        {title && <p className="text-white/90 text-sm mb-2 font-medium">{title}</p>}
        <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
          {embed
            ? <iframe className="absolute inset-0 w-full h-full" src={embed} title={title || 'Product video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen />
            : <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">Invalid video link</div>}
        </div>
      </div>
    </div>
  );
}
