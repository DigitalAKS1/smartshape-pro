import { useState, useEffect, useCallback, useMemo } from 'react';
import { delegation as delApi, fms as fmsApi, visitPlans as visitApi, tasks as tasksApi, followups as fuApi, training as trainingApi } from '../lib/api';
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

  const createBlock = useCallback(async (payload) => {
    try { await delApi.planBlocks.create(payload); toast.success('Block added'); load(); return true; }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed to add block'); return false; }
  }, [load]);

  const updateBlock = useCallback(async (id, payload) => {
    try { await delApi.planBlocks.update(id, payload); toast.success('Block updated'); load(); return true; }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed to update'); return false; }
  }, [load]);

  const deleteBlock = useCallback(async (id) => {
    try { await delApi.planBlocks.delete(id); toast.success('Block removed'); load(); return true; }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed to remove'); return false; }
  }, [load]);

  const scheduleItem = useCallback(async (ev, date, startHHMM) => {
    const endHH = String(Math.min(23, parseInt(startHHMM.slice(0, 2), 10) + 1)).padStart(2, '0');
    try {
      await delApi.planBlocks.create({
        date, start_time: startHHMM, end_time: `${endHH}:00`,
        title: ev.title, color: ev.color, linked_event_id: ev.event_id,
      });
      toast.success('Added to your day'); load(); return true;
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); return false; }
  }, [load]);

  const runAction = useCallback(async (ev, action, payload = {}) => {
    const id = ev.entity_id;
    try {
      switch (`${ev.source}:${action}`) {
        case 'delegation:complete': await delApi.instances.complete(id, { note: payload.note || '' }); break;
        case 'delegation:verify':   await delApi.instances.verify(id); break;
        case 'delegation:reopen':   await delApi.instances.reopen(id); break;
        case 'delegation:reschedule': await delApi.instances.patch(id, { due_date: payload.date }); break;
        case 'fms:complete_stage':  await fmsApi.completeStage(id, {}); break;
        case 'visit:checkin':       await visitApi.checkIn(id, {}); break;
        case 'visit:checkout':      await visitApi.checkOut(id, {}); break;
        case 'visit:reschedule':    await visitApi.reschedule(id, { visit_date: payload.date }); break;
        case 'task:complete':       await tasksApi.update(id, { status: 'done' }); break;
        case 'task:reschedule':     await tasksApi.update(id, { due_date: payload.date }); break;
        case 'followup:log_outcome':await fuApi.update(id, { status: 'done', outcome: payload.outcome || '' }); break;
        case 'followup:reschedule': await fuApi.update(id, { followup_date: payload.date }); break;
        case 'workshop:set_status': await trainingApi.updateSession(id, { status: payload.status || 'completed' }); break;
        case 'plan:delete':         await delApi.planBlocks.delete(id); break;
        default:
          toast.error('Action not available'); return false;
      }
      toast.success('Done');
      load();
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Action failed');
      return false;
    }
  }, [load]);

  return {
    view, setView, cursor, setCursor, range,
    subjectEmp, setSubjectEmp,
    hidden, toggleSource, ALL_SOURCES,
    events, visibleEvents, eventsByDate, loading, reload: load,
    goPrev, goNext, goToday,
    createBlock, updateBlock, deleteBlock, scheduleItem, runAction,
    helpers: { iso, addDays, startOfMonth, endOfMonth, startOfWeek },
  };
}
