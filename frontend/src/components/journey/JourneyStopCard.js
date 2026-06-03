import React from 'react';
import { CheckCircle2 } from 'lucide-react';

const OUTCOMES = [
  { value: 'interested',         label: 'Interested'     },
  { value: 'follow_up',          label: 'Follow Up'      },
  { value: 'demo_booked',        label: 'Demo Booked'    },
  { value: 'not_interested',     label: 'Not Interested' },
  { value: 'callback_requested', label: 'Callback'       },
  { value: 'already_purchased',  label: 'Purchased'      },
];

function fmt(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

function fmtDuration(fromIso, toIso) {
  if (!fromIso) return '';
  const ms = (toIso ? new Date(toIso) : new Date()) - new Date(fromIso);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StopDot({ num, active, done }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
      done   ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
      active ? 'bg-[#e94560]/20 text-[#e94560] border border-[#e94560]/40 animate-pulse' :
               'bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)]'
    }`}>
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : num}
    </div>
  );
}

export default function JourneyStopCard({ stop, index }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <StopDot num={index + 1} active={stop.status === 'arrived'} done={stop.status === 'completed'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-[var(--text-primary)]">{stop.school_name}</span>
          {stop.km_from_prev > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
              +{stop.km_from_prev} km
            </span>
          )}
          {stop.status === 'arrived' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e94560]/15 text-[#e94560] animate-pulse">
              Here now
            </span>
          )}
          {stop.outcome && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
              {OUTCOMES.find(o => o.value === stop.outcome)?.label || stop.outcome}
            </span>
          )}
        </div>
        <div className="text-[var(--text-muted)] mt-0.5">
          In: {fmt(stop.arrived_at)}
          {stop.departed_at && ` · Out: ${fmt(stop.departed_at)} · ${fmtDuration(stop.arrived_at, stop.departed_at)}`}
        </div>
      </div>
    </div>
  );
}
