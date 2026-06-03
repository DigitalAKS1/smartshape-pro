import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { MessageSquare, Smartphone, Monitor } from 'lucide-react';

/**
 * WhatsApp picker: shows "Mobile App" vs "Web" options in a dropdown.
 * Falls back to clipboard copy when no phone is available.
 */
export default function WaPickerButton({ phone, message, label = 'Send via WhatsApp', className = '', testId = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const num     = (phone || '').replace(/\D/g, '');
  const e164    = num ? (num.startsWith('91') ? num : '91' + num) : '';
  const encoded = encodeURIComponent(message || '');

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const send = (type) => {
    setOpen(false);
    if (!e164) {
      navigator.clipboard?.writeText(message || '');
      toast.success('No phone found — message copied to clipboard');
      return;
    }
    const url = type === 'web'
      ? `https://web.whatsapp.com/send?phone=${e164}&text=${encoded}`
      : `https://wa.me/${e164}?text=${encoded}`;
    window.open(url, '_blank');
  };

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" onClick={() => setOpen(o => !o)}
        className={`border-green-600/50 text-green-500 hover:bg-green-500/10 ${className}`}
        data-testid={testId}>
        <MessageSquare className="mr-1 h-3 w-3" /> {label}
      </Button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 w-52 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-xl overflow-hidden">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold px-3 pt-2.5 pb-1">Open in</p>
          <button onClick={() => send('mobile')}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <Smartphone className="h-4 w-4 text-green-400 flex-shrink-0" />
            <div className="text-left">
              <p className="font-medium leading-tight">WhatsApp App</p>
              <p className="text-[10px] text-[var(--text-muted)]">Mobile / Desktop app</p>
            </div>
          </button>
          <button onClick={() => send('web')}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border-t border-[var(--border-color)]">
            <Monitor className="h-4 w-4 text-blue-400 flex-shrink-0" />
            <div className="text-left">
              <p className="font-medium leading-tight">WhatsApp Web</p>
              <p className="text-[10px] text-[var(--text-muted)]">web.whatsapp.com</p>
            </div>
          </button>
          {!e164 && (
            <div className="px-3 py-2 border-t border-[var(--border-color)]">
              <p className="text-[10px] text-amber-400">No phone — will copy message</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
