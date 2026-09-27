// Read-only "recent WhatsApp" block for a contact, school or lead: the last N messages
// (newest at the bottom, like a chat) and an Open chat link into the team inbox. Nothing
// is sent from here — the rep opens the inbox to reply.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { waInbox } from '../../lib/api';

/** Outbound status → tick text. Anything unknown shows nothing. */
export function statusTick(status) {
  switch (status) {
    case 'queued':    return '⏱';
    case 'sent':      return '✓';
    case 'delivered': return '✓✓';
    case 'read':      return '✓✓ read';
    case 'failed':
    case 'skipped':   return '!';
    default:          return '';
  }
}

/** "just now", "5m ago", "3h ago", "2d ago", else the local date. */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

function Media({ media }) {
  if (!media) return null;
  const label = `📎 ${media.filename || media.type || 'attachment'}`;
  if (media.url) {
    return (
      <a href={media.url} target="_blank" rel="noreferrer" className="underline break-all" data-testid="rw-media">
        {label}
      </a>
    );
  }
  return <span data-testid="rw-media">{label}</span>;
}

function Bubble({ m }) {
  const out = m.direction === 'out';
  const tick = out ? statusTick(m.status) : '';
  const failed = m.status === 'failed' || m.status === 'skipped';
  const attributed = m.typed_by && m.sent_via_owner_email && m.typed_by !== m.sent_via_owner_email;
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`} data-testid="rw-row" data-direction={m.direction}>
      <div className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs border ${out
        ? 'bg-green-500/10 border-green-500/30 text-[var(--text-primary)]'
        : 'bg-[var(--bg-hover)] border-[var(--border-color)] text-[var(--text-primary)]'}`}>
        {m.text && <p className="whitespace-pre-wrap break-words" data-testid="rw-text">{m.text}</p>}
        {m.media && <p className="mt-0.5"><Media media={m.media} /></p>}
        <p className="mt-0.5 text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5 justify-end">
          <span>{relativeTime(m.created_at)}</span>
          {tick && (
            <span data-testid="rw-tick" title={failed ? (m.fail_reason || '') : undefined}
              className={failed ? 'text-red-500 font-semibold' : ''}>{tick}</span>
          )}
        </p>
        {attributed && (
          <p className="text-[10px] text-[var(--text-secondary)] italic" data-testid="rw-attribution">
            sent by {m.typed_by} via {m.sent_via_owner_email}
          </p>
        )}
      </div>
    </div>
  );
}

export default function RecentWhatsApp({ contactId, schoolId, leadId, limit = 20 }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const seq = useRef(0);   // only the newest load may write its answer

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    const params = { limit };
    if (contactId) params.contact_id = contactId;
    if (schoolId) params.school_id = schoolId;
    if (leadId) params.lead_id = leadId;
    if (!contactId && !schoolId && !leadId) {
      setRows([]); setLoading(false); setError('');
      return;
    }
    setLoading(true);
    waInbox.byRecord(params)
      .then((r) => {
        if (!alive.current || mine !== seq.current) return;
        const list = Array.isArray(r?.data) ? r.data : (Array.isArray(r?.data?.messages) ? r.data.messages : []);
        setRows(list);
        setError('');
      })
      .catch(() => {
        if (!alive.current || mine !== seq.current) return;
        setError('Could not load WhatsApp messages');
      })
      .finally(() => {
        if (alive.current && mine === seq.current) setLoading(false);
      });
  }, [contactId, schoolId, leadId, limit]);

  const newest = rows[0];                       // the API returns newest first
  const ordered = rows.slice().reverse();       // chat order: newest at the bottom
  const chatId = newest?.chat_id;

  return (
    <div data-testid="recent-whatsapp">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[var(--text-secondary)]">WhatsApp</p>
        {chatId && (
          <Link to={`/whatsapp?chat=${encodeURIComponent(chatId)}`} data-testid="rw-open-chat"
            className="text-xs font-medium text-[#e94560] hover:underline">Open chat</Link>
        )}
      </div>
      {loading && <p className="text-xs text-[var(--text-secondary)]" data-testid="rw-loading">Loading…</p>}
      {!loading && error && <p className="text-xs text-red-500" data-testid="rw-error">{error}</p>}
      {!loading && !error && ordered.length === 0 && (
        <p className="text-xs text-[var(--text-secondary)]" data-testid="rw-empty">No WhatsApp messages yet</p>
      )}
      {!loading && !error && ordered.length > 0 && (
        <div className="space-y-1.5" data-testid="rw-list">
          {ordered.map((m, i) => <Bubble key={m.message_id || m.id || `${m.created_at}-${i}`} m={m} />)}
        </div>
      )}
    </div>
  );
}
