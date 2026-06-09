import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { delegation as delApi } from '../../lib/api';
import { CalendarDays, ChevronRight, RefreshCw } from 'lucide-react';

const SOURCE_COLORS = {
  delegation: '#e94560', fms: '#8b5cf6', visit: '#06b6d4', task: '#f59e0b',
  followup: '#10b981', workshop: '#6366f1', plan: '#64748b', reminder: '#f97316', event: '#0ea5e9',
};

// Local (not UTC) ISO date — matches how due_dates are stored.
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; };

export default function AgendaWeekWidget({ card, textPri, textSec, textMuted }) {
  const nav = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const today = iso(new Date());
  const range = useMemo(() => {
    const from = startOfWeek(new Date());
    return { from: iso(from), to: iso(addDays(from, 6)) };
  }, []);

  const load = async () => {
    setLoading(true); setErr(false);
    try {
      const r = await delApi.agenda({ from: range.from, to: range.to });
      setEvents(r.data?.events || []);
    } catch { setErr(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range.from, range.to]);

  const days = useMemo(() => {
    const byDate = {};
    for (const e of events) (byDate[e.date] ||= []).push(e);
    return Array.from({ length: 7 }, (_, i) => {
      const d = iso(addDays(new Date(range.from + 'T00:00:00'), i));
      return { date: d, items: (byDate[d] || []).sort((a, b) => (a.start_time || '99').localeCompare(b.start_time || '99')) };
    }).filter(day => day.items.length);
  }, [events, range.from]);

  const todayCount = events.filter(e => e.date === today).length;
  const wd = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

  return (
    <div className={`${card} border rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4" style={{ color: '#e94560' }} />
          <h2 className={`text-sm font-bold ${textPri}`}>This Week</h2>
          {todayCount > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#e9456018', color: '#e94560' }}>
              {todayCount} today
            </span>
          )}
        </div>
        <button onClick={load} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textMuted}`} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-4 border-[#e94560] border-t-transparent" />
        </div>
      ) : err ? (
        <button onClick={load} className={`text-xs ${textMuted} py-6 w-full text-center`}>Couldn’t load — tap to retry</button>
      ) : days.length === 0 ? (
        <p className={`text-sm ${textMuted} py-6 text-center`}>Nothing scheduled — you’re clear.</p>
      ) : (
        <div className="space-y-3">
          {days.map(day => (
            <div key={day.date}>
              <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${day.date === today ? '' : textMuted}`}
                style={day.date === today ? { color: '#e94560' } : {}}>
                {day.date === today ? 'Today' : wd(day.date)}
              </p>
              <div className="space-y-1">
                {day.items.slice(0, 4).map(e => (
                  <div key={e.event_id} className="flex items-center gap-2 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[e.source] || '#64748b' }} />
                    <span className={`font-mono text-[10px] ${textMuted} w-10 flex-shrink-0`}>{e.start_time || '—'}</span>
                    <span className={`flex-1 min-w-0 truncate ${textSec} ${['completed', 'verified', 'done'].includes(e.status) ? 'line-through opacity-60' : ''}`}>{e.title}</span>
                  </div>
                ))}
                {day.items.length > 4 && <p className={`text-[10px] ${textMuted} pl-3.5`}>+{day.items.length - 4} more</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => nav('/delegation?tab=calendar')}
        className={`mt-3 w-full flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>
        Open Calendar <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
