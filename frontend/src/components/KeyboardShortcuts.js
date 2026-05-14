import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Keyboard } from 'lucide-react';

const SHORTCUTS = [
  { keys: ['?'],        desc: 'Open this shortcuts reference' },
  { keys: ['Esc'],      desc: 'Close modal / dialog' },
  { keys: ['Ctrl', 'K'],desc: 'Focus global search (where available)' },
  { keys: ['Ctrl', 'N'],desc: 'New record (context-sensitive)' },
  { keys: ['G', 'D'],   desc: 'Go to Today\'s Dashboard' },
  { keys: ['G', 'Q'],   desc: 'Go to Quotations' },
  { keys: ['G', 'L'],   desc: 'Go to Leads & CRM' },
  { keys: ['G', 'I'],   desc: 'Go to Inventory' },
  { keys: ['G', 'F'],   desc: 'Go to Field Sales' },
  { keys: ['G', 'S'],   desc: 'Go to Sales Portal' },
];

function Key({ label }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] text-[10px] font-mono font-semibold shadow-sm">
      {label}
    </kbd>
  );
}

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const [gBuffer, setGBuffer] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let gTimeout = null;

    const handler = (e) => {
      const tag = e.target.tagName.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

      // Esc: close any open dialog (handled by dialog components themselves), but also close shortcut modal
      if (e.key === 'Escape') { setOpen(false); return; }

      // ? key: toggle shortcut modal (not in inputs)
      if (e.key === '?' && !isInput) { e.preventDefault(); setOpen(s => !s); return; }

      if (isInput) return;

      // Ctrl+K: focus first search input visible on page
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
        return;
      }

      // Ctrl+N: click the first primary "Add" / "Create" / "New" button
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        const btn = document.querySelector('[data-testid*="add-"], [data-testid*="create-"], button[title*="Add"], button[title*="Create"]');
        if (btn) btn.click();
        return;
      }

      // G + letter navigation (vim-style)
      if (e.key === 'g' || e.key === 'G') {
        setGBuffer('g');
        clearTimeout(gTimeout);
        gTimeout = setTimeout(() => setGBuffer(''), 1500);
        return;
      }

      if (gBuffer === 'g') {
        clearTimeout(gTimeout);
        setGBuffer('');
        const routes = { d: '/today', q: '/quotations', l: '/leads', i: '/inventory', f: '/field-sales', s: '/sales' };
        const target = routes[e.key.toLowerCase()];
        if (target) { e.preventDefault(); navigate(target); }
      }
    };

    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); clearTimeout(gTimeout); };
  }, [gBuffer, navigate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[800] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-md max-h-[80dvh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-[#e94560]" />
            <h2 className="font-bold text-sm text-[var(--text-primary)]">Keyboard Shortcuts</h2>
          </div>
          <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Shortcut list */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          <div className="space-y-2.5">
            {SHORTCUTS.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <span className="text-sm text-[var(--text-secondary)]">{s.desc}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {s.keys.map((k, ki) => (
                    <React.Fragment key={ki}>
                      <Key label={k} />
                      {ki < s.keys.length - 1 && <span className="text-[10px] text-[var(--text-muted)]">+</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-color)]">
          <p className="text-[11px] text-[var(--text-muted)] text-center">Press <Key label="?" /> anytime to open this panel</p>
        </div>
      </div>
    </div>
  );
}
