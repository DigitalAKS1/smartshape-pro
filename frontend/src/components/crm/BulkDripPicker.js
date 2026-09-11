import React from 'react';
import { Zap } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { dripSequences as dripApi } from '../../lib/api';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The toast after a bulk drip enrolment — every count the server reports, in
 * plain words, so nobody is silently left out:
 *   "Enrolled 40 contacts in “GSLC follow-up” (3 already in it, 2 not yours) · 5 have no phone or email"
 */
export function formatDripEnrolResult(data = {}, seqName = '') {
  const {
    enrolled = 0, skipped_duplicate: dup = 0, skipped_not_visible: hidden = 0,
    skipped_missing: missing = 0, no_channel: noChannel = 0, starting_now: now = false,
  } = data || {};
  const skips = [
    dup ? `${dup} already in it` : '',
    hidden ? `${hidden} not yours` : '',
    missing ? `${missing} deleted` : '',
  ].filter(Boolean);
  return `Enrolled ${plural(enrolled, 'contact')}${seqName ? ` in “${seqName}”` : ''}`
    + (skips.length ? ` (${skips.join(', ')})` : '')
    + (noChannel ? ` · ${noChannel} ha${noChannel === 1 ? 's' : 've'} no phone or email` : '')
    + (now && enrolled ? ' · the first step goes out now' : '');
}

/**
 * "Enrol in drip…" button + popover for the Contacts bulk bar: pick one ACTIVE
 * sequence, then "Enrol N". Sequences are loaded when the popover first opens.
 *
 * Props:
 *   count         how many contacts would be enrolled (shown on the button)
 *   disabled      disables the trigger and the enrol button
 *   onEnrol       (sequence) => Promise|any. Resolve to `false` to keep the
 *                 popover open (cancelled confirm, or a failed request).
 *   testIdPrefix  prefix for every data-testid (default "bulk-drip")
 */
export default function BulkDripPicker({ count = 0, disabled = false, onEnrol, testIdPrefix = 'bulk-drip' }) {
  const { isDark } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [sequences, setSequences] = React.useState(null);   // null = not loaded yet
  const [seqId, setSeqId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const rootRef = React.useRef(null);

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const tid = (s) => `${testIdPrefix}-${s}`;

  React.useEffect(() => {
    if (!open || sequences !== null) return;
    let alive = true;
    dripApi.getAll()
      .then(r => { if (alive) setSequences((r?.data || []).filter(s => s.is_active && (s.steps || []).length)); })
      .catch(() => { if (alive) setSequences([]); });
    return () => { alive = false; };
  }, [open, sequences]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const seq = (sequences || []).find(s => s.sequence_id === seqId) || null;

  const enrol = async () => {
    if (!seq || busy || disabled || !onEnrol) return;
    setBusy(true);
    let ok = false;
    try { ok = (await onEnrol(seq)) !== false; } catch { ok = false; } finally { setBusy(false); }
    if (ok) { setSeqId(''); setOpen(false); }
  };

  return (
    <div ref={rootRef} className="relative inline-block" data-testid={tid('root')}>
      <button type="button" disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog" aria-expanded={open}
        className={`h-8 px-2.5 rounded border text-xs inline-flex items-center gap-1.5 ${inputCls} cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
        data-testid={tid('button')}>
        <Zap className="h-3 w-3" /> Enrol in drip…
      </button>

      {open && (
        <div role="dialog" aria-label="Enrol in a drip sequence"
          className={`${card} border rounded-md shadow-xl z-50 p-3 space-y-2
            fixed left-4 right-4 bottom-4
            sm:absolute sm:left-0 sm:right-auto sm:bottom-auto sm:top-full sm:mt-1 sm:w-80`}
          data-testid={tid('popover')}>
          {sequences === null ? (
            <p className={`text-xs ${textMuted}`}>Loading sequences…</p>
          ) : sequences.length === 0 ? (
            <p className={`text-xs ${textMuted}`} data-testid={tid('empty')}>No active sequences. Create one under Drip first.</p>
          ) : (
            <select value={seqId} onChange={e => setSeqId(e.target.value)}
              className={`w-full h-9 px-2 rounded-md text-sm border ${inputCls}`} data-testid={tid('select')}>
              <option value="">Choose a sequence…</option>
              {sequences.map(s => (
                <option key={s.sequence_id} value={s.sequence_id}>{s.name} ({(s.steps || []).length} steps)</option>
              ))}
            </select>
          )}
          <p className={`text-[11px] ${textMuted}`}>
            Starts real messages to each contact. Anyone already in the sequence — directly or through their lead — is skipped.
          </p>
          <button type="button" onClick={enrol} disabled={!seq || busy || disabled}
            className="w-full h-8 rounded text-xs font-medium bg-[#e94560] hover:bg-[#f05c75] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid={tid('enrol')}>
            {busy ? 'Enrolling…' : `Enrol ${plural(count, 'contact')}`}
          </button>
        </div>
      )}
    </div>
  );
}
