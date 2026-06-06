import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDelegationCalendar } from '../../../hooks/useDelegationCalendar';
import CalendarMonth from './CalendarMonth';
import AgendaList from './AgendaList';

const PINK = '#e94560';
const SOURCE_LABELS = {
  delegation: 'Tasks', fms: 'FMS', visit: 'Visits', task: 'CRM', followup: 'Calls',
  workshop: 'Workshops', plan: 'My Plan',
};
const SOURCE_COLORS = {
  delegation: '#e94560', fms: '#8b5cf6', visit: '#06b6d4', task: '#f59e0b',
  followup: '#10b981', workshop: '#6366f1', plan: '#64748b',
};

export default function DelegationCalendar({ onEventClick, card, textPri, textSec, textMuted }) {
  const c = useDelegationCalendar();
  const monthLabel = c.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const rangeDates = () => {
    const out = []; let d = new Date(c.range.from + 'T00:00:00');
    const end = new Date(c.range.to + 'T00:00:00');
    while (d <= end) { out.push(c.helpers.iso(d)); d = c.helpers.addDays(d, 1); }
    return out;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <button onClick={c.goPrev} className={`p-2 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={c.goToday} className={`px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>Today</button>
          <button onClick={c.goNext} className={`p-2 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><ChevronRight className="h-4 w-4" /></button>
          <h2 className={`text-base font-semibold ${textPri} ml-2`}>
            {c.view === 'month' ? monthLabel
              : c.view === 'week' ? `Week of ${c.range.from}`
              : new Date(c.range.from + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
        </div>
        <div className={`${card} border rounded-xl p-1 flex gap-0.5`}>
          {['month', 'week', 'day'].map(v => (
            <button key={v} onClick={() => c.setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${c.view === v ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={c.view === v ? { background: PINK } : {}}>{v}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {c.ALL_SOURCES.map(s => {
          const on = !c.hidden.has(s);
          return (
            <button key={s} onClick={() => c.toggleSource(s)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${on ? '' : 'opacity-40'}`}
              style={{ borderColor: SOURCE_COLORS[s] + '55', background: on ? SOURCE_COLORS[s] + '18' : 'transparent', color: on ? SOURCE_COLORS[s] : textMuted }}>
              <span className="w-2 h-2 rounded-full" style={{ background: SOURCE_COLORS[s] }} />
              {SOURCE_LABELS[s]}
            </button>
          );
        })}
      </div>

      {c.loading && (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-7 w-7 border-4 border-[#e94560] border-t-transparent" />
        </div>
      )}

      {!c.loading && c.view === 'month' && (
        <CalendarMonth cursor={c.cursor} eventsByDate={c.eventsByDate}
          onDayClick={(d) => { c.setCursor(d); c.setView('day'); }}
          helpers={c.helpers} card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
      )}
      {!c.loading && c.view !== 'month' && (
        <AgendaList dates={rangeDates()} eventsByDate={c.eventsByDate}
          onEventClick={onEventClick} card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
      )}

      {c.view === 'month' && (
        <p className={`text-[11px] ${textMuted} text-center`}>Tip: click a day to open it.</p>
      )}
    </div>
  );
}
