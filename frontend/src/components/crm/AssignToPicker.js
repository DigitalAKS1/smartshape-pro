import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '../ui/input';
import { User, X, ChevronDown } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Searchable, typeable "Assign To" user picker — replaces the plain
 * `<select>{spList.map(...)}</select>` pattern used across the CRM forms.
 *
 * Type a user's NAME or EMAIL to filter; pick a match ("Name — email") to set
 * both `assigned_to` (email) and `assigned_name`. A free-typed exact email
 * (containing '@') is also accepted even if it isn't in `users` — the backend
 * write paths resolve name-or-email -> user, so sending a bare valid email is
 * safe even when the local `users` list doesn't have every assignable person.
 *
 * Props:
 *   value      current assigned_to (email string, may be '')
 *   valueName  current assigned_name (display name for `value`)
 *   users      [{email, name}] — the picklist. NOTE (v1): callers currently
 *              pass spList (salespersons only), not every assignable user —
 *              see call sites for the "no broader users API yet" caveat.
 *   onChange   (email, name) => void — name is '' for an unresolved free-typed email
 *   placeholder, className, disabled
 */
export default function AssignToPicker({
  value = '', valueName = '', users = [], onChange,
  placeholder = 'Type a name or email…', className = '', disabled = false,
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  // Never drop the current assignee out of the list just because they're not
  // in `users` (e.g. a name-only legacy record, or a rep no longer active) —
  // append a synthetic entry so the box never shows blank for a real value.
  const allUsers = useMemo(() => {
    const list = users || [];
    if (value && !list.some((u) => (u.email || '').toLowerCase() === value.toLowerCase())) {
      return [...list, { email: value, name: valueName || value }];
    }
    return list;
  }, [users, value, valueName]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? allUsers.filter((u) => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      : allUsers;
    return [...base].sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')).slice(0, 50);
  }, [allUsers, query]);

  useEffect(() => { setHighlight(0); }, [query, open]);

  const commitEmail = (email, name) => {
    onChange?.(email, name || '');
    setQuery(''); setEditing(false); setOpen(false);
  };

  const selectUser = (u) => commitEmail(u.email, u.name || '');

  // Resolve whatever is currently typed: exact name/email match wins, else a
  // well-formed free-typed email is accepted as-is (name left blank — the
  // backend resolves it), else the edit is discarded (revert to prior value).
  const resolveTyped = () => {
    const q = query.trim();
    if (!q) { setEditing(false); setOpen(false); return; }
    const exact = allUsers.find((u) => (u.name || '').toLowerCase() === q.toLowerCase() || (u.email || '').toLowerCase() === q.toLowerCase());
    if (exact) { commitEmail(exact.email, exact.name || ''); return; }
    if (EMAIL_RE.test(q)) { commitEmail(q, ''); return; }
    // Doesn't resolve to anything — discard the typed text, keep prior value.
    setQuery(''); setEditing(false); setOpen(false);
  };

  // Click anywhere outside the picker resolves whatever was typed (same rule
  // as blur/Enter) instead of silently discarding it — e.g. typing a full
  // email then clicking the Save button should still commit it.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) resolveTyped();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlight]) selectUser(filtered[highlight]);
      else resolveTyped();
    } else if (e.key === 'Escape') {
      setQuery(''); setEditing(false); setOpen(false);
      inputRef.current?.blur();
    }
  };

  const clear = () => {
    onChange?.('', '');
    setQuery(''); setEditing(false); setOpen(false);
  };

  const displayValue = editing ? query : (valueName || value || '');

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)] pointer-events-none" />
        <Input
          ref={inputRef}
          value={displayValue}
          disabled={disabled}
          onFocus={() => { setEditing(true); setQuery(''); setOpen(true); }}
          onChange={(e) => { setQuery(e.target.value); setEditing(true); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onBlur={() => resolveTyped()}
          placeholder={value ? undefined : placeholder}
          autoComplete="off"
          data-testid="assign-to-input"
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] pl-8 pr-14 h-10 text-sm"
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && !disabled && (
            <button type="button" onClick={clear} aria-label="Clear assignee" data-testid="assign-to-clear"
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        </div>
      </div>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-56 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] shadow-lg" data-testid="assign-to-dropdown">
          {filtered.length > 0 ? (
            filtered.map((u, i) => (
              <button
                key={u.email}
                type="button"
                data-testid={`assign-to-option-${u.email}`}
                onMouseDown={(e) => e.preventDefault()} // keep focus so click fires before blur
                onMouseEnter={() => setHighlight(i)}
                onClick={() => selectUser(u)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 ${
                  i === highlight ? 'bg-[var(--accent)]/10 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
              >
                <span className="truncate">{u.name || u.email}</span>
                <span className="text-[10px] text-[var(--text-muted)] truncate">{u.email}</span>
              </button>
            ))
          ) : query.trim() && EMAIL_RE.test(query.trim()) ? (
            <div className="px-3 py-1.5 text-xs text-[var(--text-muted)]">
              Press Enter to assign <span className="font-mono text-[var(--text-secondary)]">{query.trim()}</span> (not in the list)
            </div>
          ) : (
            <div className="px-3 py-1.5 text-xs text-[var(--text-muted)]">No match — type a full email to assign someone not listed</div>
          )}
        </div>
      )}
    </div>
  );
}
