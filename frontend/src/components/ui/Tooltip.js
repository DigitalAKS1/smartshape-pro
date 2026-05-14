import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Inline question-mark tooltip. Mobile-safe: tapping toggles, clicking outside dismisses.
 *
 * Usage:
 *   <label>GST Number <FieldTooltip text="Your 15-digit GSTIN issued by the government." /></label>
 */
export function FieldTooltip({ text, className = '' }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!show) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [show]);

  return (
    <span ref={ref} className={`relative inline-flex items-center ml-1 ${className}`}>
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(s => !s)}
        className="text-[var(--text-muted)] hover:text-[#e94560] transition-colors focus:outline-none"
        aria-label="More information"
        tabIndex={-1}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {show && (
        <span
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-[200] pointer-events-none"
          style={{ minWidth: '180px', maxWidth: 'min(260px, calc(100vw - 2rem))' }}
        >
          {/* Arrow */}
          <span className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-[var(--bg-card)] border-r border-b border-[var(--border-color)] rotate-45 -mt-1" />
          <span className="block bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] shadow-xl leading-relaxed">
            {text}
          </span>
        </span>
      )}
    </span>
  );
}

/** Convenience: wraps a label string with a trailing tooltip icon. */
export function TooltipLabel({ label, text, required, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-0 ${className}`}>
      {label}
      {required && <span className="text-[#e94560] ml-0.5">*</span>}
      <FieldTooltip text={text} />
    </span>
  );
}
