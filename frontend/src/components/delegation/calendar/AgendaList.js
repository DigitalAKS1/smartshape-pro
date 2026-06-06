import React from 'react';

const fmtDay = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined,
  { weekday: 'short', month: 'short', day: 'numeric' });

export default function AgendaList({ dates, eventsByDate, onEventClick, textPri, textSec, textMuted, card }) {
  if (!dates.length) return null;
  const empty = dates.every(d => !(eventsByDate[d] || []).length);
  if (empty) {
    return <div className={`${card} border rounded-xl text-center py-12`}>
      <p className={`text-sm ${textMuted}`}>Nothing scheduled in this range.</p>
    </div>;
  }
  return (
    <div className="space-y-4">
      {dates.map(d => {
        const evs = (eventsByDate[d] || []).slice().sort(
          (a, b) => (a.start_time || '99').localeCompare(b.start_time || '99'));
        if (!evs.length) return null;
        return (
          <div key={d}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${textMuted}`}>{fmtDay(d)}</p>
            <div className="space-y-1.5">
              {evs.map(e => (
                <button key={e.event_id} onClick={() => onEventClick?.(e)}
                  className={`${card} border rounded-lg w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-[var(--bg-hover)]`}>
                  <span className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: e.color }} />
                  <span className={`text-[11px] font-mono ${textMuted} w-12 flex-shrink-0`}>{e.start_time || '—'}</span>
                  <span className={`flex-1 min-w-0 text-sm ${textPri} truncate ${(e.status === 'completed' || e.status === 'verified' || e.status === 'done') ? 'line-through opacity-60' : ''}`}>{e.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: e.color + '22', color: e.color }}>{e.source}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
