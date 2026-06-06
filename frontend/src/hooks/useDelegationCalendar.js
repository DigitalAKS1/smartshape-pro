import { useState, useEffect, useCallback, useMemo } from 'react';
import { delegation as delApi } from '../lib/api';
import { toast } from 'sonner';

/* ── date helpers (local, no deps) ─────────────────────────────────────── */
const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfWeek  = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays      = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const ALL_SOURCES = ['delegation', 'fms', 'visit', 'task', 'followup', 'workshop', 'plan'];

export function useDelegationCalendar() {
  const [view, setView]     = useState('month');           // month | week | day
  const [cursor, setCursor] = useState(new Date());        // anchor date
  const [subjectEmp, setSubjectEmp] = useState('');        // '' = self; else emp_id (boss view)
  const [hidden, setHidden] = useState(new Set());         // hidden source keys
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => {
    if (view === 'month') {
      const from = startOfWeek(startOfMonth(cursor));
      const to   = addDays(startOfWeek(endOfMonth(cursor)), 13);
      return { from: iso(from), to: iso(to) };
    }
    if (view === 'week') {
      const from = startOfWeek(cursor);
      return { from: iso(from), to: iso(addDays(from, 6)) };
    }
    return { from: iso(cursor), to: iso(cursor) };
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { from: range.from, to: range.to };
      if (subjectEmp) params.emp_id = subjectEmp;
      const r = await delApi.agenda(params);
      setEvents(r.data?.events || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to load calendar');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, subjectEmp]);

  useEffect(() => { load(); }, [load]);

  const visibleEvents = useMemo(
    () => events.filter(e => !hidden.has(e.source)),
    [events, hidden]);

  const eventsByDate = useMemo(() => {
    const m = {};
    for (const e of visibleEvents) (m[e.date] ||= []).push(e);
    return m;
  }, [visibleEvents]);

  const toggleSource = (key) => setHidden(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const goPrev = () => setCursor(c =>
    view === 'month' ? new Date(c.getFullYear(), c.getMonth() - 1, 1)
    : addDays(c, view === 'week' ? -7 : -1));
  const goNext = () => setCursor(c =>
    view === 'month' ? new Date(c.getFullYear(), c.getMonth() + 1, 1)
    : addDays(c, view === 'week' ? 7 : 1));
  const goToday = () => setCursor(new Date());

  return {
    view, setView, cursor, setCursor, range,
    subjectEmp, setSubjectEmp,
    hidden, toggleSource, ALL_SOURCES,
    events, visibleEvents, eventsByDate, loading, reload: load,
    goPrev, goNext, goToday,
    helpers: { iso, addDays, startOfMonth, endOfMonth, startOfWeek },
  };
}
