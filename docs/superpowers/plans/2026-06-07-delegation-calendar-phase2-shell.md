# Delegation Calendar — Phase 2 (Calendar UI Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make the unified Calendar the default landing of the Delegation module — a Month/Week/Day shell with date navigation, source-filter chips, and a Month grid that shows colour-coded event dots from the Phase-1 `GET /delegation/agenda` endpoint. (Day hour-timeline + plan-block editing + action drawer come in Phases 3–4.)

**Architecture:** A `useDelegationCalendar` hook fetches the agenda for the visible range and holds view/cursor/filters/subject state. `DelegationCalendar` renders a header (nav + view switch + source chips) and the active view. Month is full; Week and Day are simple agenda lists in Phase 2 (upgraded in Phase 3). Wired as the first tab + default `viewTab` in `DelegationApp`.

**Tech Stack:** React (CRA), axios `delApi`, lucide-react icons, tailwind + CSS-variable theming (match existing delegation components). Verify with `DISABLE_ESLINT_PLUGIN=true react-scripts build` (no backend needed).

---

## Reference — agenda event shape (from Phase 1, do not change)
`GET /delegation/agenda?from&to&emp_id` → `{ from, to, subject_emp_id, is_self, subject_team, events: [...] }`
Each event: `{ event_id, source, type, title, date(YYYY-MM-DD), start_time(HH:MM|null), end_time, status, priority, entity_id, link, color, actions[], meta{} }`.
Sources & colours: delegation `#e94560`, fms `#8b5cf6`, visit `#06b6d4`, task `#f59e0b`, followup `#10b981`, workshop `#6366f1`, plan `#64748b`.

Existing theme tokens used by DelegationApp: `card`, `textPri`, `textSec`, `textMuted`, `inputCls` (CSS vars). The pink accent is `#e94560`.

## File Structure (Phase 2)
- **Modify** `frontend/src/lib/api.js` — add `delegation.agenda` + `delegation.planBlocks.*`.
- **Create** `frontend/src/hooks/useDelegationCalendar.js` — calendar state + data.
- **Create** `frontend/src/components/delegation/calendar/DelegationCalendar.js` — container (header + view router).
- **Create** `frontend/src/components/delegation/calendar/CalendarMonth.js` — month grid with dots.
- **Create** `frontend/src/components/delegation/calendar/AgendaList.js` — simple grouped list (used by Week/Day in Phase 2).
- **Modify** `frontend/src/pages/admin/DelegationApp.js` — add Calendar as first tab + default landing.

## Conventions
- No backend needed; verify each task with the production build. Commit after each green build.
- Match existing delegation component styling (pink `#e94560`, CSS-var theme classes).

---

### Task 1: API client + `useDelegationCalendar` hook

**Files:**
- Modify: `frontend/src/lib/api.js` (the `delegation` export's nested objects)
- Create: `frontend/src/hooks/useDelegationCalendar.js`

- [ ] **Step 1: Add API methods**

In `frontend/src/lib/api.js`, inside the `delegation` export object, add an `agenda` method and a `planBlocks` group (place near the existing `calendar`/`reports` lines):

```javascript
  agenda:     (p)  => API.get('/delegation/agenda', { params: p }),
  planBlocks: {
    list:   (p)    => API.get('/delegation/plan-blocks', { params: p }),
    create: (d)    => API.post('/delegation/plan-blocks', d),
    update: (id,d) => API.patch(`/delegation/plan-blocks/${id}`, d),
    delete: (id)   => API.delete(`/delegation/plan-blocks/${id}`),
  },
```

- [ ] **Step 2: Create the hook**

Create `frontend/src/hooks/useDelegationCalendar.js`:

```javascript
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

  // visible [from, to] for the current view
  const range = useMemo(() => {
    if (view === 'month') {
      // pad to full weeks so the grid edges have data
      const from = startOfWeek(startOfMonth(cursor));
      const to   = addDays(startOfWeek(endOfMonth(cursor)), 13);
      return { from: iso(from), to: iso(to) };
    }
    if (view === 'week') {
      const from = startOfWeek(cursor);
      return { from: iso(from), to: iso(addDays(from, 6)) };
    }
    return { from: iso(cursor), to: iso(cursor) };   // day
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
    n.has(key) ? n.delete(key) : n.add(key);
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
```

- [ ] **Step 3: Verify build compiles**

Run: `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error" | head`
Expected: `Compiled successfully.` (the hook isn't imported yet but must parse; api.js change is used nowhere yet — both compile).
Then clean the build dir: `rm -rf "f:/SMARTSHAPE APP/frontend/build"`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/hooks/useDelegationCalendar.js
git commit -m "feat(delegation): calendar API client + useDelegationCalendar hook"
```

---

### Task 2: AgendaList + CalendarMonth components

**Files:**
- Create: `frontend/src/components/delegation/calendar/AgendaList.js`
- Create: `frontend/src/components/delegation/calendar/CalendarMonth.js`

- [ ] **Step 1: Create AgendaList** (grouped, used by Week/Day in Phase 2)

```javascript
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
```

- [ ] **Step 2: Create CalendarMonth** (grid with dots)

```javascript
import React from 'react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarMonth({
  cursor, eventsByDate, onDayClick, helpers, textPri, textSec, textMuted, card,
}) {
  const { iso, addDays, startOfMonth, endOfMonth, startOfWeek } = helpers;
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
            <button key={i} onClick={() => onDayClick?.(d)}
              className={`min-h-[84px] border-b border-r border-[var(--border-color)] p-1.5 text-left align-top hover:bg-[var(--bg-hover)] transition-colors ${inMonth ? '' : 'opacity-40'}`}>
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
```

- [ ] **Step 3: Verify build**

Run: `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error" | head` → `Compiled successfully.` then `rm -rf build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/delegation/calendar/AgendaList.js frontend/src/components/delegation/calendar/CalendarMonth.js
git commit -m "feat(delegation): CalendarMonth grid + AgendaList components"
```

---

### Task 3: DelegationCalendar container + wire as default landing

**Files:**
- Create: `frontend/src/components/delegation/calendar/DelegationCalendar.js`
- Modify: `frontend/src/pages/admin/DelegationApp.js`

- [ ] **Step 1: Create the container**

```javascript
import React from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
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
      {/* Header */}
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

      {/* Source filter chips */}
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
```

- [ ] **Step 2: Wire into DelegationApp as first tab + default landing**

In `frontend/src/pages/admin/DelegationApp.js`:
1. Import at top: `import DelegationCalendar from '../../components/delegation/calendar/DelegationCalendar';`
2. Add `CalendarDays` to the existing lucide-react import if not present.
3. In the tab list array (currently begins with `{ id: 'planner', label: 'My Planner', icon: Sun }, ...VIEWS`), add a calendar entry FIRST:
   ```javascript
   { id: 'calendar', label: 'Calendar', icon: CalendarDays },
   ```
   so the array starts: `[{ id: 'calendar', label: 'Calendar', icon: CalendarDays }, { id: 'planner', ... }, ...VIEWS, ...]`.
4. Render the calendar tab content (add near the other `{s.viewTab === '...' && (...)}` blocks):
   ```javascript
   {s.viewTab === 'calendar' && (
     <DelegationCalendar
       onEventClick={() => {}}
       card={card} textPri={textPri} textSec={textSec} textMuted={textMuted}
     />
   )}
   ```
5. Make Calendar the default landing: where the role-switch sets the tab, default non-delegatee roles to `'calendar'`. Locate the role-button onClick that currently does `s.setViewTab(r === 'delegatee' ? 'planner' : 'overview')` and change `'overview'` → `'calendar'`. Also set the hook's initial `viewTab` default to `'calendar'` if it is currently `'overview'` (in `useDelegationApp.js`, `const [viewTab, setViewTab] = useState('overview')` → `useState('calendar')`).

> Note: `onEventClick` is a no-op placeholder in Phase 2; the EventActionDrawer (Phase 4) will replace it.

- [ ] **Step 3: Verify build**

Run: `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error" | head` → `Compiled successfully.` then `rm -rf build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/delegation/calendar/DelegationCalendar.js frontend/src/pages/admin/DelegationApp.js frontend/src/hooks/useDelegationApp.js
git commit -m "feat(delegation): Calendar container + default landing (Month/Week/Day shell)"
```

---

## Self-Review (Phase 2)
- **Spec coverage:** §5 default landing + Month/Week/Day switch + source-filter chips → Tasks 1–3; §3 event shape consumed read-only; agenda fetch via Phase-1 endpoint → hook Task 1. Day hour-timeline, plan-block editing, and the action drawer are explicitly Phases 3–4 (this plan renders Week/Day as agenda lists and uses a no-op `onEventClick`).
- **Placeholder scan:** complete code in every step; `onEventClick` no-op is intentional and labelled.
- **Type consistency:** hook returns `{view,setView,cursor,setCursor,range,subjectEmp,setSubjectEmp,hidden,toggleSource,ALL_SOURCES,events,visibleEvents,eventsByDate,loading,reload,goPrev,goNext,goToday,helpers}` — consumed consistently by `DelegationCalendar`; `CalendarMonth`/`AgendaList` props match what the container passes. Source colours match Phase-1 `AGENDA_COLORS`.

## Roadmap — Phases 3–5 (separate plans, just-in-time)
- Phase 3: `CalendarDay` hour-grid + Unscheduled tray + `DayPlanBlockDialog` (create/edit/delete) + drag-to-slot; richer `CalendarWeek`.
- Phase 4: `EventActionDrawer` wiring real per-source actions (replaces the no-op `onEventClick`).
- Phase 5: team-member picker (`subjectEmp`) + `frontend-design` polish.
