import React from 'react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarMonth({
  cursor, eventsByDate, onDayClick, helpers, textPri, textSec, textMuted, card,
}) {
  const { iso, addDays, startOfMonth, startOfWeek } = helpers;
  const today = iso(new Date());
  const month = cursor.getMonth();
  const gridStart = startOfWeek(startOfMonth(cursor));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className={`${card} border rounded-xl overflow-hidden`}>
      <div className="grid grid-cols-7 border-b border-[var(--border-color)]">
        {WEEKDAYS.map(w => (
          <div key={w} className={`py-2 text-center text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const ds = iso(d);
          const inMonth = d.getMonth() === month;
          const isToday = ds === today;
          const evs = eventsByDate[ds] || [];
          const sources = [...new Set(evs.map(e => e.source))];
          return (
            <button key={i} onClick={() => onDayClick?.(d)} aria-label={`${ds}${evs.length ? `, ${evs.length} item${evs.length > 1 ? 's' : ''}` : ''}`}
              className={`min-h-[84px] border-b border-r border-[var(--border-color)] p-1.5 text-left align-top cursor-pointer hover:bg-[var(--bg-hover)] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#e94560]/60 ${inMonth ? '' : 'opacity-40'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${isToday ? 'text-white rounded-full w-5 h-5 flex items-center justify-center' : textSec}`}
                  style={isToday ? { background: '#e94560' } : {}}>{d.getDate()}</span>
                {evs.length > 0 && <span className={`text-[10px] ${textMuted}`}>{evs.length}</span>}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {sources.slice(0, 5).map(s => {
                  const c = evs.find(e => e.source === s)?.color || '#64748b';
                  return <span key={s} className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />;
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
