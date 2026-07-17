import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PhoneCall, PhoneOff, X, Forward, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { onCallStart } from '../../lib/callBus';
import { telephonyApi, salesPersons } from '../../lib/api';

// Map raw provider/lifecycle status -> friendly label + phase.
// phase: 'ringing' (polling), 'connected' (polling+timer), 'ended' (stop)
function phaseFor(row) {
  const s = (row?.status || '').toLowerCase();
  if (row?.end_time || ['completed', 'no-answer', 'noanswer', 'busy', 'failed', 'cancelled'].includes(s)) {
    return 'ended';
  }
  if (['answered', 'bridged', 'connected'].includes(s)) return 'connected';
  return 'ringing';
}

const OUTCOME_UI = {
  connected: { label: 'Connected', cls: 'text-green-600', Icon: CheckCircle2 },
  no_answer: { label: 'No answer', cls: 'text-amber-600', Icon: XCircle },
  busy: { label: 'Busy', cls: 'text-orange-600', Icon: XCircle },
  failed: { label: 'Failed', cls: 'text-red-600', Icon: XCircle },
};

function outcomeFromRow(row) {
  const s = (row?.status || '').toLowerCase();
  if (['answered', 'bridged', 'connected', 'completed'].includes(s) && (row?.duration_sec || 0) > 0) return 'connected';
  if (['busy'].includes(s)) return 'busy';
  if (['failed', 'cancelled'].includes(s)) return 'failed';
  return 'no_answer';
}

const fmtDur = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function CallWidget() {
  const [call, setCall] = useState(null);   // {event_id, label, phone}
  const [row, setRow] = useState(null);      // latest telephony_calls row
  const [tick, setTick] = useState(0);       // drives the live timer
  const [showFwd, setShowFwd] = useState(false);
  const [mates, setMates] = useState([]);
  const pollRef = useRef(null);
  const startedAt = useRef(null);

  // subscribe to call:start events
  useEffect(() => onCallStart((detail) => {
    setCall(detail); setRow(null); setShowFwd(false); startedAt.current = Date.now();
  }), []);

  // poll the call row while a call is active and not ended
  useEffect(() => {
    if (!call) return undefined;
    let stop = false;
    const poll = async () => {
      try {
        const { data } = await telephonyApi.getCall(call.event_id);
        if (!stop) setRow(data);
        if (!stop && phaseFor(data) !== 'ended') pollRef.current = setTimeout(poll, 2500);
      } catch {
        if (!stop) pollRef.current = setTimeout(poll, 4000);
      }
    };
    poll();
    return () => { stop = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [call]);

  // 1s timer while connected
  useEffect(() => {
    if (!call || phaseFor(row) === 'ended') return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [call, row]);

  if (!call) return null;

  const phase = phaseFor(row);
  const connectedSecs = row?.duration_sec || Math.floor((Date.now() - (startedAt.current || Date.now())) / 1000);
  const outcome = outcomeFromRow(row);
  const oui = OUTCOME_UI[outcome] || OUTCOME_UI.no_answer;

  const openForward = async () => {
    setShowFwd(true);
    if (mates.length === 0) {
      try {
        const { data } = await salesPersons.getAll();
        setMates((data || []).filter((m) => m.email));
      } catch { /* leave empty */ }
    }
  };

  const doForward = async (email, name) => {
    try {
      await telephonyApi.forward(call.event_id, { to_email: email });
      toast.success(`Forwarded to ${name || email}`);
      setShowFwd(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not forward');
    }
  };

  const close = () => { setCall(null); setRow(null); };

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-80 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#e94560]/10 border-b border-[var(--border-color)]">
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <PhoneCall className="h-4 w-4 text-[#e94560]" /> {call.label}
        </span>
        <button onClick={close} aria-label="Close call widget" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {phase === 'ringing' && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin text-[#e94560]" />
            {row?.status ? `Ringing… (${row.status})` : 'Ringing your phone — pick up to connect'}
          </div>
        )}

        {phase === 'connected' && (
          <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            Connected · {fmtDur(connectedSecs)}
          </div>
        )}

        {phase === 'ended' && (
          <div className="space-y-2">
            <div className={`flex items-center gap-2 text-sm font-medium ${oui.cls}`}>
              <oui.Icon className="h-4 w-4" /> {oui.label}
              {(row?.duration_sec || 0) > 0 && <span className="text-[var(--text-muted)]">· {fmtDur(row.duration_sec)}</span>}
            </div>
            {row?.recording_url && (
              <audio controls preload="none" src={row.recording_url} className="h-8 w-full" />
            )}
          </div>
        )}

        {phase !== 'ended' && (
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <PhoneOff className="h-3 w-3" /> Hang up on your phone to end the call.
          </p>
        )}

        {/* Forward */}
        {!showFwd ? (
          <button onClick={openForward}
            className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            <Forward className="h-3.5 w-3.5" /> Forward to colleague
          </button>
        ) : (
          <div className="border border-[var(--border-color)] rounded-lg max-h-40 overflow-y-auto">
            {mates.length === 0 && <p className="text-xs text-[var(--text-muted)] p-2">No colleagues found.</p>}
            {mates.map((m) => (
              <button key={m.email} onClick={() => doForward(m.email, m.name)}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-b border-[var(--border-color)] last:border-0">
                {m.name} <span className="text-[var(--text-muted)]">· {m.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
