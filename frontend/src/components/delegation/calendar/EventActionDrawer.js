import React, { useState } from 'react';
import { X, Check, RotateCcw, Calendar, ExternalLink, Video, ArrowRightLeft, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PINK = '#e94560';

const ACTION_META = {
  complete:       { label: 'Mark done',      Icon: Check,     color: '#10b981' },
  verify:         { label: 'Verify',         Icon: Check,     color: '#3b82f6' },
  reopen:         { label: 'Reopen',         Icon: RotateCcw, color: '#64748b' },
  complete_stage: { label: 'Complete stage', Icon: Check,     color: '#10b981' },
  checkin:        { label: 'Check in',       Icon: Check,     color: '#10b981' },
  checkout:       { label: 'Check out',      Icon: Check,     color: '#06b6d4' },
  set_status:     { label: 'Mark completed', Icon: Check,     color: '#10b981' },
};

export default function EventActionDrawer({ event, onAction, onEditEvent, onSendInvites, onManageReminder, onClose, card, textPri, textSec, textMuted, inputCls }) {
  const navigate = useNavigate();
  const [rescheduleDate, setRescheduleDate] = useState(event?.date || '');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  if (!event) return null;

  const acts = event.actions || [];
  const has = (a) => acts.includes(a);
  const meta = event.meta || {};

  const fire = async (action, payload) => {
    setBusy(true);
    const ok = await onAction(event, action, payload);
    setBusy(false);
    if (ok) onClose();
  };

  // SP3 — send-safe: confirm the recipient list before emailing real people
  const sendInvites = async () => {
    const people = (meta.collaborators || []).join('\n');
    const verb = meta.invited ? 'an update' : 'invites';
    if (!window.confirm(
      `Email ${verb} for "${event.title}" to its collaborators?\n\n${people}\n\n` +
      `(You are not emailed.)`)) return;
    setBusy(true);
    await onSendInvites?.(event.entity_id, 'request');
    setBusy(false);
    onClose();
  };

  // Cancel, optionally emailing a cancellation notice to collaborators
  const cancelEvent = async () => {
    if (!window.confirm('Cancel this event?')) return;
    const notify = meta.invited && !!onSendInvites &&
      window.confirm('Also email collaborators that it has been cancelled?');
    setBusy(true);
    const ok = await onAction(event, 'cancel', {});
    if (ok && notify) await onSendInvites(event.entity_id, 'cancel');
    setBusy(false);
    if (ok) onClose();
  };

  const row = `w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold`;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className={`relative w-full max-w-md ${card} border-l border-[var(--border-color)] flex flex-col shadow-2xl`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border-color)]">
          <span className="w-1.5 h-10 rounded-full flex-shrink-0 mt-0.5" style={{ background: event.color }} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${textPri}`}>{event.title}</p>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              {event.date}{event.start_time ? ` · ${event.start_time}` : ''} · <span className="capitalize">{(event.type || event.source || '').replace(/_/g, ' ')}</span>
              {event.status ? ` · ${event.status}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className={`p-1.5 rounded-lg cursor-pointer transition-colors duration-200 hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e94560]/60 ${textSec}`}><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {(meta.delegator_name || meta.customer_name || meta.location || (meta.assigned_out && meta.emp_name)) && (
            <div className={`text-xs ${textSec} space-y-1`}>
              {meta.assigned_out && meta.emp_name && <p>Assigned to: {meta.emp_name}</p>}
              {!meta.assigned_out && meta.delegator_name && <p>From: {meta.delegator_name}</p>}
              {meta.customer_name && <p>Customer: {meta.customer_name}</p>}
              {meta.location && <p>Location: {meta.location}</p>}
            </div>
          )}

          {/* ── collaborative event ── */}
          {event.source === 'event' && (
            <div className="space-y-3">
              {meta.description && <p className={`text-xs ${textSec}`}>{meta.description}</p>}
              {Array.isArray(meta.collaborators) && meta.collaborators.length > 0 && (
                <div className={`text-xs ${textMuted}`}>
                  <span className="font-semibold uppercase tracking-wide text-[10px]">Collaborators</span>
                  <p className={`${textSec} mt-1`}>{meta.collaborators.join(', ')}</p>
                </div>
              )}
              {meta.join_url && (
                <a href={meta.join_url} target="_blank" rel="noreferrer"
                  className={`${row} text-white`} style={{ background: '#6366f1' }}>
                  <Video className="h-4 w-4" /> Join {meta.meeting_provider === 'zoom' ? 'Zoom'
                    : meta.meeting_provider === 'meet' ? 'Google Meet' : 'meeting'}
                </a>
              )}
              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/delegation/events/${event.entity_id}.ics`}
                className={`${row} border border-[var(--border-color)] ${textSec}`}>
                <Calendar className="h-4 w-4" /> Add to calendar (Google / Apple / Outlook)
              </a>
              {meta.is_creator ? (
                <>
                  {onSendInvites && (meta.collaborators || []).length > 0 && (
                    <button disabled={busy} onClick={sendInvites}
                      className={`${row} text-white`} style={{ background: '#0ea5e9' }}>
                      <Send className="h-4 w-4" /> {meta.invited ? 'Send update' : 'Send invites'}
                    </button>
                  )}
                  {onEditEvent && (
                    <button disabled={busy} onClick={() => { onEditEvent(event); onClose(); }}
                      className={`${row} text-white`} style={{ background: PINK }}>
                      <Calendar className="h-4 w-4" /> Edit event
                    </button>
                  )}
                  <button disabled={busy} onClick={cancelEvent}
                    className={`${row} border border-[var(--border-color)] text-red-400`}>
                    <X className="h-4 w-4" /> Cancel event
                  </button>
                  {meta.invited && (
                    <p className={`text-[11px] ${textMuted} text-center`}>
                      Invites sent · update #{(meta.sequence ?? 0)}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => fire('respond', { response: 'accepted' })}
                    className={`${row} text-white`} style={{ background: '#10b981' }}>
                    <Check className="h-4 w-4" /> Accept
                  </button>
                  <button disabled={busy} onClick={() => fire('respond', { response: 'declined' })}
                    className={`${row} border border-[var(--border-color)] ${textSec}`}>
                    <X className="h-4 w-4" /> Decline
                  </button>
                </div>
              )}
              {meta.my_response && meta.my_response !== 'pending' && (
                <p className={`text-[11px] ${textMuted}`}>Your response: {meta.my_response}</p>
              )}
            </div>
          )}

          {/* ── reminder ── */}
          {event.source === 'reminder' && (
            <div className="space-y-2">
              <div className={`text-xs ${textSec} space-y-1`}>
                <p>Category: <span className="capitalize">{meta.category || 'custom'}</span></p>
                {meta.amount ? <p>Amount: ₹{meta.amount}</p> : null}
                <p>Repeats: <span className="capitalize">{meta.recurrence}</span></p>
                <p>Notify: {[meta.channels?.email && 'Email', meta.channels?.whatsapp && 'WhatsApp'].filter(Boolean).join(' + ') || '—'}</p>
                {Array.isArray(meta.lead_offsets) && meta.lead_offsets.length > 0 && (
                  <p>Reminds: {meta.lead_offsets.map(o => `${o.value} ${o.unit}${o.value !== 1 ? 's' : ''} before`).join(', ')}</p>
                )}
                {meta.notes && <p className={textMuted}>{meta.notes}</p>}
              </div>
              {onManageReminder && (
                <button onClick={() => { onManageReminder(); onClose(); }}
                  className={`${row} text-white`} style={{ background: '#f97316' }}>
                  <Calendar className="h-4 w-4" /> Manage in Reminders
                </button>
              )}
            </div>
          )}

          {/* check-in/out need device GPS → done via "Open in module" (visit page), not here */}
          {['complete','verify','reopen','complete_stage','set_status'].filter(has).map(a => {
            const m = ACTION_META[a];
            return (
              <button key={a} disabled={busy} onClick={() => fire(a, {})}
                className={`${row} text-white`} style={{ background: m.color }}>
                <m.Icon className="h-4 w-4" /> {m.label}
              </button>
            );
          })}

          {has('join') && meta.meeting_link && (
            <a href={meta.meeting_link} target="_blank" rel="noreferrer"
              className={`${row} text-white`} style={{ background: '#6366f1' }}>
              <Video className="h-4 w-4" /> Join
            </a>
          )}

          {has('log_outcome') && (
            <div className="space-y-1.5">
              <input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Outcome (optional)…"
                className={`w-full h-9 px-2.5 text-sm rounded border border-[var(--border-color)] ${inputCls}`} />
              <button disabled={busy} onClick={() => fire('log_outcome', { outcome })}
                className={`${row} text-white`} style={{ background: '#10b981' }}>
                <Check className="h-4 w-4" /> Log outcome &amp; done
              </button>
            </div>
          )}

          {has('reschedule') && (
            <div className="space-y-1.5">
              <label className={`text-[11px] uppercase tracking-wide font-semibold ${textMuted}`}>Reschedule to</label>
              <div className="flex gap-2">
                <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
                  className={`flex-1 h-9 px-2.5 text-sm rounded border border-[var(--border-color)] ${inputCls}`} />
                <button disabled={busy || !rescheduleDate} onClick={() => fire('reschedule', { date: rescheduleDate })}
                  className="h-9 px-3 rounded-lg text-sm font-semibold border border-[var(--border-color)]" style={{ color: PINK }}>
                  <Calendar className="h-4 w-4 inline" />
                </button>
              </div>
            </div>
          )}

          {has('reassign') && (
            <button onClick={() => navigate('/delegation')}
              className={`${row} border border-[var(--border-color)] ${textSec}`}>
              <ArrowRightLeft className="h-4 w-4" /> Reassign (in Delegation)
            </button>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--border-color)]">
          <button onClick={() => navigate(event.link || '/delegation')}
            className={`${row} border border-[var(--border-color)] ${textSec}`}>
            <ExternalLink className="h-4 w-4" /> Open in module
          </button>
        </div>
      </div>
    </div>
  );
}
