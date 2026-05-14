import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { X, Send, Loader2, Plus } from 'lucide-react';

function EmailChip({ email, onRemove, fixed }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#e94560]/15 text-[#e94560] border border-[#e94560]/30">
      {email}
      {!fixed && (
        <button onClick={() => onRemove(email)} className="hover:text-white transition-colors ml-0.5" tabIndex={-1}>
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function ChipInput({ label, fixed = [], emails, onChange }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const addEmail = (raw) => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) return;
    if (fixed.some(f => f.toLowerCase() === trimmed)) return;
    if (emails.some(e => e.toLowerCase() === trimmed)) return;
    onChange([...emails, trimmed]);
    setDraft('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addEmail(draft);
    }
    if (e.key === 'Backspace' && !draft && emails.length > 0) {
      onChange(emails.slice(0, -1));
    }
  };

  const remove = (email) => onChange(emails.filter(e => e !== email));

  return (
    <div>
      <Label className="text-[var(--text-secondary)] text-xs mb-1.5 block">{label}</Label>
      <div
        className="min-h-[40px] flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {fixed.map(e => <EmailChip key={e} email={e} fixed />)}
        {emails.map(e => <EmailChip key={e} email={e} onRemove={remove} />)}
        <input
          ref={inputRef}
          value={draft}
          onChange={ev => setDraft(ev.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => addEmail(draft)}
          placeholder={fixed.length + emails.length === 0 ? 'Type email and press Enter…' : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>
      <p className="text-[10px] text-[var(--text-muted)] mt-1">Press Enter, comma, or space to add. Backspace to remove last.</p>
    </div>
  );
}

/**
 * Reusable dialog for sending quotation/catalogue emails.
 * Props:
 *   open         — boolean
 *   onClose      — () => void
 *   onSend       — ({ extraTo, extraCc }) => Promise<void>
 *   title        — string
 *   defaultTo    — string  (customer email, shown as fixed chip)
 *   defaultCc    — string  (sales person email, shown as fixed chip)
 *   sending      — boolean (controls spinner on Send button)
 */
export default function SendEmailDialog({ open, onClose, onSend, title, defaultTo, defaultCc, sending }) {
  const [extraTo, setExtraTo] = useState([]);
  const [extraCc, setExtraCc] = useState([]);

  useEffect(() => {
    if (open) { setExtraTo([]); setExtraCc([]); }
  }, [open]);

  const fixedTo = defaultTo ? [defaultTo] : [];
  const fixedCc = defaultCc ? [defaultCc] : [];

  const handleSend = () => onSend({ extraTo, extraCc });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[var(--bg-card)] border border-[var(--border-color)] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2">
            <Send className="h-4 w-4 text-[#e94560]" />
            {title || 'Send Email'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* To */}
          <ChipInput
            label={`To${fixedTo.length ? ' (primary recipient — locked)' : ''}`}
            fixed={fixedTo}
            emails={extraTo}
            onChange={setExtraTo}
          />

          {/* CC */}
          <ChipInput
            label={`CC${fixedCc.length ? ' (sales executive — locked)' : ''}`}
            fixed={fixedCc}
            emails={extraCc}
            onChange={setExtraCc}
          />

          {!defaultTo && (
            <p className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-md px-3 py-2">
              No customer email found on this quotation. Add one above or edit the quotation first.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="border-[var(--border-color)] text-[var(--text-secondary)]" disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || (!defaultTo && extraTo.length === 0)}
            className="bg-[#e94560] hover:bg-[#f05c75] text-white"
          >
            {sending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
              : <><Send className="mr-2 h-4 w-4" /> Send</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
