// Team inbox — one conversation: header (who, which number, Resolve/Reopen, rail toggle),
// banners (opt-out, incomplete history), the thread with date separators, ticks, inline media,
// quoted context, attribution when someone typed on another rep's number, yellow internal
// notes, and "Load older" at the top.
import React, { useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft, Check, CheckCheck, Clock, AlertCircle, StickyNote, PanelRightOpen, PanelRightClose,
  FileText, Loader2,
} from 'lucide-react';
import { chatTitle, prettyPhone } from './ChatList';

const timeOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function dayKey(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabel(iso, now = new Date()) {
  const key = dayKey(iso);
  if (!key) return '';
  if (key === dayKey(now.toISOString())) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === dayKey(y.toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Messages + notes in one ascending timeline, with a date separator before each new day.
 *  A `preview_only` stub (from the stream) is hidden while an optimistic `tmp_` bubble is
 *  still pending in the same chat — the stub is our own send echoed back; the server row
 *  replaces both a moment later. */
export function buildTimeline(messages = [], notes = []) {
  const pendingTmp = messages.some((m) => String(m.message_id || '').startsWith('tmp_'));
  const rows = [];
  messages.forEach((m) => {
    if (m.preview_only && pendingTmp) return;
    rows.push({ kind: 'message', at: m.created_at || '', key: `m-${m.message_id}`, data: m });
  });
  (notes || []).forEach((n, i) => {
    rows.push({ kind: 'note', at: n.at || '', key: `n-${n.at || i}-${i}`, data: n });
  });
  rows.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return ta - tb;
  });
  const out = [];
  let lastDay = null;
  rows.forEach((r) => {
    const day = dayKey(r.at);
    if (day && day !== lastDay) {
      out.push({ kind: 'day', key: `d-${day}`, at: r.at });
      lastDay = day;
    }
    out.push(r);
  });
  return out;
}

export function Tick({ status, reason }) {
  const base = 'inline-flex items-center';
  switch (status) {
    case 'queued':
      return <span data-testid="msg-tick" data-status="queued" title="Queued" className={`${base} text-[var(--text-muted)]`}><Clock className="h-3 w-3" /></span>;
    case 'sent':
      return <span data-testid="msg-tick" data-status="sent" title="Sent" className={`${base} text-[var(--text-muted)]`}><Check className="h-3 w-3" /></span>;
    case 'delivered':
      return <span data-testid="msg-tick" data-status="delivered" title="Delivered" className={`${base} text-[var(--text-muted)]`}><CheckCheck className="h-3 w-3" /></span>;
    case 'read':
      return <span data-testid="msg-tick" data-status="read" title="Read" className={`${base} text-sky-500`}><CheckCheck className="h-3 w-3" /></span>;
    case 'failed':
    case 'skipped':
      return (
        <span data-testid="msg-tick" data-status={status} title={reason || status} className={`${base} gap-1 text-red-500`}>
          <AlertCircle className="h-3 w-3" />
          <span data-testid="msg-fail-reason" className="text-[10px]">{reason || (status === 'skipped' ? 'Skipped' : 'Failed')}</span>
        </span>
      );
    default:
      return null;
  }
}

export function Media({ media }) {
  if (!media) return null;
  if (media.pending || !media.url) {
    return (
      <p data-testid="msg-media" data-kind="pending" className="text-xs italic text-[var(--text-secondary)]">
        Media not available yet{media.filename ? ` · ${media.filename}` : ''}
      </p>
    );
  }
  const name = media.filename || media.type || 'file';
  switch (media.type) {
    case 'image':
    case 'sticker':
      return (
        <a href={media.url} target="_blank" rel="noreferrer">
          <img src={media.url} alt={media.caption || name} data-testid="msg-media" data-kind="image"
            className="max-w-full max-h-72 rounded-lg" loading="lazy" />
        </a>
      );
    case 'video':
      // eslint-disable-next-line jsx-a11y/media-has-caption
      return <video src={media.url} controls data-testid="msg-media" data-kind="video" className="max-w-full max-h-72 rounded-lg" />;
    case 'audio':
      // eslint-disable-next-line jsx-a11y/media-has-caption
      return <audio src={media.url} controls data-testid="msg-media" data-kind="audio" className="max-w-full" />;
    default:
      return (
        <a href={media.url} target="_blank" rel="noreferrer" data-testid="msg-media" data-kind="document"
          className="inline-flex items-center gap-1.5 text-xs underline break-all">
          <FileText className="h-3.5 w-3.5 flex-shrink-0" /> {name}
        </a>
      );
  }
}

function Bubble({ m, quoted }) {
  const out = m.direction === 'out';
  const attributed = m.typed_by && m.sent_via_owner_email && m.typed_by !== m.sent_via_owner_email;
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`} data-testid="msg-row" data-direction={m.direction}
      data-message-id={m.message_id}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm border ${out
        ? 'bg-green-500/10 border-green-500/30 rounded-br-md'
        : 'bg-[var(--bg-card)] border-[var(--border-color)] rounded-bl-md'} text-[var(--text-primary)]`}>
        {m.quoted_provider_msg_id && (
          <p data-testid="msg-quoted"
            className="mb-1 pl-2 border-l-2 border-green-500/60 text-xs text-[var(--text-secondary)] truncate">
            {quoted?.text || 'Replying to an earlier message'}
          </p>
        )}
        {m.media && <div className="mb-1"><Media media={m.media} /></div>}
        {m.text && <p className="whitespace-pre-wrap break-words" data-testid="msg-text">{m.text}</p>}
        <p className="mt-1 text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5 justify-end">
          <span>{timeOf(m.created_at)}</span>
          {out && <Tick status={m.status} reason={m.fail_reason} />}
        </p>
        {attributed && (
          <p className="text-[10px] text-[var(--text-secondary)] italic" data-testid="msg-attribution">
            sent by {m.typed_by} via {m.sent_via_owner_email}
          </p>
        )}
      </div>
    </div>
  );
}

function NoteBubble({ n }) {
  return (
    <div className="flex justify-center" data-testid="note-row">
      <div className="max-w-[85%] rounded-xl px-3 py-2 text-xs bg-amber-100 border border-amber-300 text-amber-900">
        <p className="flex items-center gap-1 font-semibold mb-0.5">
          <StickyNote className="h-3 w-3" /> Internal note · {n.by}
        </p>
        <p className="whitespace-pre-wrap break-words">{n.text}</p>
        <p className="mt-0.5 text-[10px] opacity-70">{timeOf(n.at)}</p>
      </div>
    </div>
  );
}

const STATE_LABEL = {
  connected: 'Connected', qr: 'Waiting for scan', disconnected: 'Disconnected', paused: 'Paused', unlinked: 'Not linked',
};

/**
 * Props: chat, messages, hasMore, loadingOlder, onLoadOlder, onResolve(chatId), onReopen(chatId),
 * railOpen, onToggleRail, onBack (mobile only — shows the back arrow), instanceState,
 * children (the composer).
 */
export default function ChatView({
  chat, messages = [], hasMore, loadingOlder, onLoadOlder, onResolve, onReopen,
  railOpen, onToggleRail, onBack, instanceState, children,
}) {
  const scroller = useRef(null);
  const lastCount = useRef(0);
  const timeline = useMemo(() => buildTimeline(messages, chat?.notes), [messages, chat?.notes]);
  const byProvider = useMemo(() => {
    const map = new Map();
    messages.forEach((m) => { if (m.provider_msg_id) map.set(m.provider_msg_id, m); });
    return map;
  }, [messages]);

  // Stick to the bottom when a message arrives; leave the position alone when older
  // rows are prepended (the user is reading upwards).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const grewAtEnd = messages.length > lastCount.current;
    const last = messages[messages.length - 1];
    const wasOlderPage = grewAtEnd && lastCount.current > 0 && last && last.message_id === messages[lastCount.current - 1]?.message_id;
    lastCount.current = messages.length;
    if (!wasOlderPage) el.scrollTop = el.scrollHeight;
  }, [messages, chat?.chat_id]);

  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]" data-testid="chat-view-empty">
        Pick a chat to read it here
      </div>
    );
  }

  const title = chatTitle(chat);
  const phone = prettyPhone(chat.phone_e164);
  const resolved = chat.status === 'resolved';
  const historyFrom = chat.history_synced_at;
  const stateOff = instanceState && instanceState !== 'connected';

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="chat-view" data-chat-id={chat.chat_id}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-card)]">
        {onBack && (
          <button type="button" onClick={onBack} data-testid="chat-back" aria-label="Back to chats"
            className="w-10 h-10 -ml-1 flex items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]" data-testid="chat-view-title">{title}</p>
          <p className="truncate text-[11px] text-[var(--text-secondary)]" data-testid="chat-view-meta">
            {phone && phone !== title ? phone : ''}
            {chat.instance_label ? `${phone && phone !== title ? ' · ' : ''}via ${chat.instance_label}` : ''}
            {stateOff ? ` · ${STATE_LABEL[instanceState] || instanceState}` : ''}
          </p>
        </div>
        {resolved ? (
          <button type="button" data-testid="chat-reopen" onClick={() => onReopen?.(chat.chat_id)}
            className="min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            Reopen
          </button>
        ) : (
          <button type="button" data-testid="chat-resolve" onClick={() => onResolve?.(chat.chat_id)}
            className="min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            Resolve
          </button>
        )}
        {onToggleRail && (
          <button type="button" onClick={onToggleRail} data-testid="chat-rail-toggle"
            aria-label={railOpen ? 'Hide details' : 'Show details'} aria-pressed={!!railOpen}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
            {railOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
          </button>
        )}
      </header>

      {chat.opted_out && (
        <div data-testid="chat-opted-out" className="px-3 py-1.5 text-[11px] bg-red-500/10 border-b border-red-500/30 text-red-600">
          This number opted out — messages will not be sent.
        </div>
      )}
      {historyFrom && (
        <div data-testid="chat-history-banner" className="px-3 py-1.5 text-[11px] bg-[var(--bg-hover)] border-b border-[var(--border-color)] text-[var(--text-secondary)]">
          History before {new Date(historyFrom).toLocaleDateString()} may be incomplete
        </div>
      )}

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-[var(--bg-primary)]" data-testid="chat-thread">
        {hasMore && (
          <div className="flex justify-center">
            <button type="button" data-testid="chat-load-older" onClick={onLoadOlder} disabled={loadingOlder}
              className="min-h-[36px] px-3 rounded-full text-xs font-medium border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 inline-flex items-center gap-1">
              {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />} Load older
            </button>
          </div>
        )}
        {timeline.length === 0 && (
          <p className="text-center text-xs text-[var(--text-secondary)]" data-testid="chat-thread-empty">No messages yet</p>
        )}
        {timeline.map((r) => {
          if (r.kind === 'day') {
            return (
              <div key={r.key} className="flex justify-center" data-testid="day-separator">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">{dayLabel(r.at)}</span>
              </div>
            );
          }
          if (r.kind === 'note') return <NoteBubble key={r.key} n={r.data} />;
          return <Bubble key={r.key} m={r.data} quoted={r.data.quoted_provider_msg_id ? byProvider.get(r.data.quoted_provider_msg_id) : null} />;
        })}
      </div>

      {children}
    </div>
  );
}
