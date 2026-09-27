// Team inbox — the details rail: the linked CRM record (Open in CRM), Link to a record
// (search contacts by name or number, or create one from this number), the assignee
// (managers), and the private notes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, UserPlus, StickyNote, X, Loader2, ExternalLink } from 'lucide-react';
import { contacts as contactsApi } from '../../lib/api';
import { prettyPhone } from './ChatList';

const timeOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const digits = (s) => String(s || '').replace(/\D/g, '');

/** Contacts whose name or phone contains the query (case-insensitive), first `limit`. */
export function filterContacts(list, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const qd = digits(q);
  const out = [];
  for (const c of list || []) {
    const name = String(c.name || '').toLowerCase();
    const phone = digits(c.phone);
    if (name.includes(q) || (qd && phone.includes(qd))) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const BTN = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[var(--border-color)] '
  + 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_PRIMARY = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold bg-[#e94560] hover:bg-[#f05c75] text-white '
  + 'transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const INPUT = 'w-full min-h-[40px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-sm '
  + 'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]';

/**
 * Props: chat, isManager, users [{email,name}], onAssign(chatId, email), onAddNote(chatId, text),
 * onLink(chatId, data), onClose (mobile sheet), salesOnly (a sales-portal user: the contact
 * opens in /sales/leads and there is no school-profile page for them).
 */
export default function ChatRail({ chat, isManager, users = [], onAssign, onAddNote, onLink, onClose, salesOnly = false }) {
  const [mode, setMode] = useState('');            // '' | 'search' | 'create'
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(null);            // contacts, loaded on first search
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSchool, setNewSchool] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setMode(''); setQuery(''); setNewName(''); setNewSchool(''); setNote(''); }, [chat?.chat_id]);

  useEffect(() => {
    if (mode !== 'search' || all !== null || loadingContacts) return;
    setLoadingContacts(true);
    contactsApi.getAll()
      .then((r) => { if (alive.current) setAll(Array.isArray(r?.data) ? r.data : []); })
      .catch(() => { if (alive.current) setAll([]); })
      .finally(() => { if (alive.current) setLoadingContacts(false); });
  }, [mode, all, loadingContacts]);

  const results = useMemo(() => filterContacts(all, query), [all, query]);

  if (!chat) return null;

  const linked = !!(chat.contact_id || chat.school_id);
  const notes = Array.isArray(chat.notes) ? chat.notes : [];

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { if (alive.current) setBusy(false); }
  };

  const linkContact = (c) => run(async () => {
    await onLink?.(chat.chat_id, { contact_id: c.contact_id });
    if (alive.current) { setMode(''); setQuery(''); }
  });

  const createContact = (e) => {
    e?.preventDefault?.();
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      const spec = { name };
      if (newSchool.trim()) spec.school_id = newSchool.trim();
      await onLink?.(chat.chat_id, { create_contact: spec });
      if (alive.current) { setMode(''); setNewName(''); setNewSchool(''); }
    });
  };

  const addNote = (e) => {
    e?.preventDefault?.();
    const text = note.trim();
    if (!text) return;
    run(async () => {
      await onAddNote?.(chat.chat_id, text);
      if (alive.current) setNote('');
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-card)]" data-testid="chat-rail">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Details</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close details" data-testid="rail-close"
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        {/* Linked record */}
        <section data-testid="rail-record" className="space-y-2">
          <p className="text-[11px] font-semibold text-[var(--text-secondary)]">Linked record</p>
          {linked ? (
            <div className="rounded-xl border border-[var(--border-color)] p-3 space-y-1">
              {chat.contact_name && <p className="text-sm font-semibold text-[var(--text-primary)]" data-testid="rail-contact">{chat.contact_name}</p>}
              {chat.school_name && <p className="text-xs text-[var(--text-secondary)]" data-testid="rail-school">{chat.school_name}</p>}
              {chat.phone_e164 && <p className="text-xs text-[var(--text-secondary)]">{prettyPhone(chat.phone_e164)}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                {chat.school_id && !salesOnly && (
                  <Link to={`/school-profile/${encodeURIComponent(chat.school_id)}`} data-testid="rail-open-school"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#e94560] hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open school in CRM
                  </Link>
                )}
                {chat.contact_id && (
                  <Link to={salesOnly ? '/sales/leads' : `/leads?contact=${encodeURIComponent(chat.contact_id)}`} data-testid="rail-open-contact"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#e94560] hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open contact in CRM
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]" data-testid="rail-unlinked">
              Not linked to a CRM record yet{chat.phone_e164 ? ` · ${prettyPhone(chat.phone_e164)}` : ''}
            </p>
          )}
          {mode === '' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${BTN} inline-flex items-center gap-1`} data-testid="rail-link-btn"
                onClick={() => setMode('search')}>
                <Link2 className="h-3.5 w-3.5" /> {linked ? 'Change link' : 'Link to a record'}
              </button>
              {!chat.contact_id && (
                <button type="button" className={`${BTN} inline-flex items-center gap-1`} data-testid="rail-create-btn"
                  onClick={() => setMode('create')}>
                  <UserPlus className="h-3.5 w-3.5" /> Create contact
                </button>
              )}
            </div>
          )}
          {mode === 'search' && (
            <div className="space-y-2" data-testid="rail-search">
              <input className={INPUT} data-testid="rail-search-input" value={query} autoFocus
                onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts by name or number" aria-label="Search contacts" />
              {loadingContacts && <p className="flex items-center gap-1 text-xs text-[var(--text-secondary)]"><Loader2 className="h-3 w-3 animate-spin" /> Loading contacts…</p>}
              {!loadingContacts && query.trim() && results.length === 0 && (
                <p className="text-xs text-[var(--text-secondary)]" data-testid="rail-search-empty">No matching contact</p>
              )}
              <div className="space-y-1">
                {results.map((c) => (
                  <button key={c.contact_id} type="button" data-testid="rail-search-result" disabled={busy}
                    onClick={() => linkContact(c)}
                    className="w-full text-left rounded-xl border border-[var(--border-color)] px-3 py-2 min-h-[44px] hover:bg-[var(--bg-hover)] disabled:opacity-50">
                    <p className="text-sm text-[var(--text-primary)] truncate">{c.name}</p>
                    <p className="text-[11px] text-[var(--text-secondary)] truncate">
                      {[c.company || c.school_name, prettyPhone(c.phone)].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                ))}
              </div>
              <button type="button" className={BTN} onClick={() => { setMode(''); setQuery(''); }}>Cancel</button>
            </div>
          )}
          {mode === 'create' && (
            <form className="space-y-2" data-testid="rail-create" onSubmit={createContact}>
              <input className={INPUT} data-testid="rail-create-name" value={newName} autoFocus
                onChange={(e) => setNewName(e.target.value)} placeholder="Contact name" aria-label="Contact name" required />
              <input className={INPUT} data-testid="rail-create-school" value={newSchool}
                onChange={(e) => setNewSchool(e.target.value)} placeholder="School id (optional)" aria-label="School id" />
              <p className="text-[11px] text-[var(--text-secondary)]">
                Saved with this number{chat.phone_e164 ? ` (${prettyPhone(chat.phone_e164)})` : ''}.
              </p>
              <div className="flex gap-2">
                <button type="submit" className={BTN_PRIMARY} disabled={busy || !newName.trim()} data-testid="rail-create-submit">
                  {busy ? 'Saving…' : 'Create & link'}
                </button>
                <button type="button" className={BTN} onClick={() => setMode('')}>Cancel</button>
              </div>
            </form>
          )}
        </section>

        {/* Assignee */}
        {isManager && (
          <section data-testid="rail-assign" className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-[var(--text-secondary)]" htmlFor="rail-assignee">Assigned to</label>
            <select id="rail-assignee" data-testid="rail-assignee" value={chat.assignee_email || ''} disabled={busy}
              onChange={(e) => run(() => onAssign?.(chat.chat_id, e.target.value))}
              className={`${INPUT} py-0`}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.email} value={u.email}>{u.name || u.email}</option>
              ))}
              {chat.assignee_email && !users.some((u) => u.email === chat.assignee_email) && (
                <option value={chat.assignee_email}>{chat.assignee_email}</option>
              )}
            </select>
          </section>
        )}
        {!isManager && chat.assignee_email && (
          <p className="text-xs text-[var(--text-secondary)]" data-testid="rail-assignee-ro">Assigned to {chat.assignee_email}</p>
        )}

        {/* Notes */}
        <section data-testid="rail-notes" className="space-y-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-[var(--text-secondary)]">
            <StickyNote className="h-3 w-3" /> Private notes
          </p>
          {notes.length === 0 && <p className="text-xs text-[var(--text-secondary)]" data-testid="rail-notes-empty">No notes yet</p>}
          <ul className="space-y-1.5">
            {notes.map((n, i) => (
              <li key={`${n.at || i}-${i}`} data-testid="rail-note"
                className="rounded-xl bg-amber-100 border border-amber-300 text-amber-900 px-3 py-2 text-xs">
                <p className="whitespace-pre-wrap break-words">{n.text}</p>
                <p className="mt-0.5 text-[10px] opacity-70">{n.by} · {timeOf(n.at)}</p>
              </li>
            ))}
          </ul>
          <form className="space-y-2" onSubmit={addNote}>
            <textarea className={`${INPUT} py-2 resize-y`} rows={2} data-testid="rail-note-input" value={note}
              onChange={(e) => setNote(e.target.value)} placeholder="Add a note only the team sees" aria-label="New note" />
            <button type="submit" className={BTN_PRIMARY} disabled={busy || !note.trim()} data-testid="rail-note-submit">Add note</button>
          </form>
        </section>
      </div>
    </div>
  );
}
