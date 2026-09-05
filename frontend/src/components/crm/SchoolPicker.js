import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { schools as schoolsApi } from '../../lib/api';

/**
 * Pick a school — including one you don't own.
 *
 * A rep with `own` scope only has her own schools loaded, so Delhi Public
 * School simply wasn't in the dropdown when it belonged to Amit. Not greyed
 * out, not flagged — absent. Her only remaining door was "Add New", and that is
 * the step that manufactures a second Delhi Public School. Every duplicate
 * cleanup this CRM has needed starts here.
 *
 * So the picker searches two sources: the schools she already has, in full,
 * and a thin cross-owner lookup that returns only name, city and owner. She can
 * find the school and see whose it is; the phone, email and contacts stay with
 * the owner. Choosing one is never blocked and never transfers anything — the
 * owner is told instead, and this says so before the save, not after.
 */
export default function SchoolPicker({
  value,
  onChange,
  schoolsList = [],
  inputCls = '',
  placeholder = 'Search schools by name or city…',
  disabled = false,
  testId = 'school-picker',
}) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef(null);

  const selected = schoolsList.find(s => s.school_id === value)
    || remote.find(s => s.school_id === value)
    || null;

  // Close on an outside click, so the list doesn't sit over the rest of the form.
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const runLookup = useCallback(async (q) => {
    if (q.trim().length < 2) { setRemote([]); return; }
    setSearching(true);
    try {
      const r = await schoolsApi.lookup(q);
      setRemote(Array.isArray(r.data) ? r.data : []);
    } catch {
      setRemote([]);   // the local list still works; the wider search just doesn't
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced: one request per pause in typing, not one per keystroke.
  useEffect(() => {
    const id = setTimeout(() => runLookup(query), 250);
    return () => clearTimeout(id);
  }, [query, runLookup]);

  const q = query.trim().toLowerCase();
  const mine = q.length === 0 ? [] : schoolsList.filter(s =>
    (s.school_name || '').toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q)
  ).slice(0, 8);

  const mineIds = new Set(mine.map(s => s.school_id));
  const theirs = remote.filter(r => !r.is_mine && !mineIds.has(r.school_id)).slice(0, 8);

  const pick = (school, isMine) => {
    setOpen(false);
    setQuery('');
    onChange(school.school_id, { ...school, is_mine: isMine });
  };

  const clear = () => { setQuery(''); setRemote([]); onChange('', null); };

  const otherOwner = selected && selected.is_mine === false
    ? (selected.assigned_name || selected.assigned_to || 'another rep')
    : '';

  if (selected) {
    return (
      <div data-testid={`${testId}-selected`}>
        <div className={`flex items-center justify-between gap-2 h-10 px-3 rounded-md ${inputCls}`}>
          <span className="truncate text-sm">
            {selected.school_name}{selected.city ? ` · ${selected.city}` : ''}
          </span>
          {!disabled && (
            <button type="button" onClick={clear} data-testid={`${testId}-clear`}
              className="text-[var(--text-muted)] hover:text-[var(--accent)]" aria-label="Change school">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {otherOwner && (
          <p className="mt-1 text-[11px] text-yellow-500" data-testid={`${testId}-owner-notice`}>
            Belongs to {otherOwner} — they'll be notified. The school stays theirs.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef} data-testid={testId}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={`w-full h-10 pl-10 pr-3 rounded-md text-sm ${inputCls}`}
        data-testid={`${testId}-input`}
      />

      {open && q.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] shadow-lg"
          data-testid={`${testId}-results`}>
          {mine.map(s => (
            <button key={s.school_id} type="button" onClick={() => pick(s, true)}
              data-testid={`${testId}-mine-${s.school_id}`}
              className="block w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
              {s.school_name}
              {s.city && <span className="text-[var(--text-muted)]"> · {s.city}</span>}
            </button>
          ))}

          {theirs.length > 0 && (
            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
              data-testid={`${testId}-divider`}>
              Other reps' schools
            </p>
          )}
          {theirs.map(s => (
            <button key={s.school_id} type="button" onClick={() => pick(s, false)}
              data-testid={`${testId}-theirs-${s.school_id}`}
              className="block w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
              {s.school_name}
              {s.city && <span className="text-[var(--text-muted)]"> · {s.city}</span>}
              <span className="text-[var(--text-muted)]"> — {s.assigned_name || s.assigned_to}</span>
            </button>
          ))}

          {mine.length === 0 && theirs.length === 0 && (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">
              {searching ? 'Searching…'
                : q.length < 2 ? 'Type at least two letters.'
                : 'No school matches. Add it as a new school below.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
