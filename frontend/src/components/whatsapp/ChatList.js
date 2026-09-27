// Team inbox — the chat list column: filter bar (scope / status / rep / search) and one
// row per chat with an initials avatar, the name and its school line, the last preview,
// a relative time, the unread badge and (for managers) which number the chat is on.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, MessageCircle } from 'lucide-react';
import { relativeTime } from './RecentWhatsApp';

export const SEARCH_DEBOUNCE_MS = 300;

/** Up to two initials from a name, or "#" for a bare number. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const letters = words.map((w) => w[0]).filter((ch) => /[A-Za-z]/.test(ch));
  if (!letters.length) return '#';
  return letters.slice(0, 2).join('').toUpperCase();
}

/** "+91 98111 11111" for an E.164 digit string; anything else as-is. */
export function prettyPhone(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.length === 12 && p.startsWith('91')) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
  return `+${p}`;
}

/** The row title: the CRM contact, else what WhatsApp calls them, else the number. */
export function chatTitle(chat) {
  if (!chat) return '';
  return chat.contact_name || chat.display_name || chat.push_name || prettyPhone(chat.phone_e164) || chat.chat_id || '';
}

/** The second line: the school, else the number when the title is already a name. */
export function chatSubtitle(chat) {
  if (!chat) return '';
  if (chat.school_name) return chat.school_name;
  const title = chatTitle(chat);
  const phone = prettyPhone(chat.phone_e164);
  return phone && phone !== title ? phone : '';
}

/** Distinct numbers seen in the list — the manager's rep filter. */
export function instanceOptions(chats) {
  const seen = new Map();
  (chats || []).forEach((c) => {
    if (c?.instance_name && !seen.has(c.instance_name)) {
      seen.set(c.instance_name, c.instance_label || c.instance_name);
    }
  });
  return Array.from(seen, ([value, label]) => ({ value, label }));
}

const SCOPES = [
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'all', label: 'All' },
];
const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const seg = (active) => `min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${active
  ? 'bg-[#e94560] text-white'
  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`;

function Row({ chat, selected, isManager, onSelect }) {
  const title = chatTitle(chat);
  const sub = chatSubtitle(chat);
  const unread = Number(chat.unread_count) || 0;
  const preview = chat.last_message_preview || '';
  return (
    <button type="button" data-testid="chat-row" data-chat-id={chat.chat_id}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(chat.chat_id)}
      className={`w-full text-left flex items-start gap-3 px-3 py-2.5 min-h-[64px] border-b border-[var(--border-color)] transition-colors ${selected
        ? 'bg-[var(--accent-bg)]'
        : 'hover:bg-[var(--bg-hover)]'}`}>
      <div className="w-10 h-10 rounded-full bg-green-500/15 text-green-700 flex items-center justify-center text-sm font-bold flex-shrink-0"
        aria-hidden="true">
        {initials(title)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`flex-1 min-w-0 truncate text-sm ${unread ? 'font-semibold' : 'font-medium'} text-[var(--text-primary)]`}
            data-testid="chat-title">{title}</p>
          <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap" data-testid="chat-time">
            {relativeTime(chat.last_message_at)}
          </span>
        </div>
        {sub && <p className="truncate text-[11px] text-[var(--text-secondary)]" data-testid="chat-subtitle">{sub}</p>}
        <div className="flex items-center gap-2 mt-0.5">
          <p className={`flex-1 min-w-0 truncate text-xs ${unread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
            data-testid="chat-preview">
            {chat.last_direction === 'out' && <span className="text-[var(--text-muted)]">You: </span>}
            {preview}
          </p>
          {unread > 0 && (
            <span data-testid="chat-unread"
              className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#e94560] text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        {isManager && chat.instance_label && (
          <span data-testid="chat-instance"
            className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border-color)] text-[var(--text-muted)]">
            via {chat.instance_label}
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * Props: chats, selectedId, onSelect(chatId), filters {scope,status,instance,q},
 * onFiltersChange(patch), isManager, loading, degraded.
 */
export default function ChatList({ chats = [], selectedId, onSelect, filters = {}, onFiltersChange, isManager, loading, degraded }) {
  const [q, setQ] = useState(filters.q || '');
  const timer = useRef(null);
  const lastEmitted = useRef(filters.q || '');
  const options = useMemo(() => instanceOptions(chats), [chats]);

  // Keep the box in step when the filter is changed from outside (a reset).
  useEffect(() => {
    if ((filters.q || '') !== lastEmitted.current) {
      lastEmitted.current = filters.q || '';
      setQ(filters.q || '');
    }
  }, [filters.q]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onSearch = (value) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const next = value.trim();
      if (next === lastEmitted.current) return;
      lastEmitted.current = next;
      onFiltersChange?.({ q: next });
    }, SEARCH_DEBOUNCE_MS);
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="chat-list">
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-1 rounded-xl bg-[var(--bg-hover)] p-1" role="tablist" aria-label="Scope">
          {SCOPES.map((s) => (
            <button key={s.value} type="button" role="tab" aria-selected={filters.scope === s.value}
              data-testid={`scope-${s.value}`} className={`flex-1 ${seg(filters.scope === s.value)}`}
              onClick={() => onFiltersChange?.({ scope: s.value })}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-[var(--bg-hover)] p-1" role="tablist" aria-label="Status">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" role="tab" aria-selected={filters.status === s.value}
                data-testid={`status-${s.value}`} className={seg(filters.status === s.value)}
                onClick={() => onFiltersChange?.({ status: s.value })}>
                {s.label}
              </button>
            ))}
          </div>
          {isManager && (
            <select data-testid="filter-instance" aria-label="Number"
              value={filters.instance || ''}
              onChange={(e) => onFiltersChange?.({ instance: e.target.value })}
              className="flex-1 min-w-0 min-h-[36px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] text-xs px-2 text-[var(--text-primary)]">
              <option value="">All numbers</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
        <label className="relative block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          <input type="search" data-testid="chat-search" value={q} onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name or number" aria-label="Search chats"
            className="w-full min-h-[40px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] pl-8 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
        </label>
      </div>

      {degraded && (
        <div data-testid="chat-degraded"
          className="px-3 py-1.5 text-[11px] bg-amber-500/10 border-b border-amber-500/30 text-amber-700">
          Live updates paused — refreshing every 30 s
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && chats.length === 0 && (
          <p data-testid="chat-loading" className="flex items-center gap-2 p-4 text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading chats…
          </p>
        )}
        {!loading && chats.length === 0 && (
          <div data-testid="chat-empty" className="p-6 text-center text-sm text-[var(--text-secondary)]">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 text-[var(--text-muted)]" aria-hidden="true" />
            No chats here yet
          </div>
        )}
        {chats.map((c) => (
          <Row key={c.chat_id} chat={c} selected={c.chat_id === selectedId} isManager={isManager} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
