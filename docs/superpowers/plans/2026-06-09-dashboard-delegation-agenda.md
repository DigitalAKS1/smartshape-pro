# Dashboard Calendar + My Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a per-user week agenda (follow-ups, visits, tasks) on the home screens, add a "My Tasks" quick tile, and a toggleable "My Tasks" table inside the Delegation System — then deploy live.

**Architecture:** Frontend-only. Two new self-contained components (`AgendaWeekWidget`, `MyTasksTable`) consume existing endpoints (`GET /delegation/agenda`, `GET /delegation/instances`). The widget is placed on three home screens; the table becomes a new deep-linkable tab in `DelegationApp`.

**Tech Stack:** React (CRA), react-router-dom, axios wrappers in `frontend/src/lib/api.js`, lucide-react icons, Tailwind CSS vars.

**Testing note:** This codebase has no React component unit-test harness (tests are integration/manual per project convention). Each task is verified by a clean compile (`AgendaWeekWidget`/`MyTasksTable` Babel-parse + dev-server compile) and a manual browser check on live after deploy. No fabricated unit tests.

---

## File Structure

- **Create** `frontend/src/components/delegation/AgendaWeekWidget.js` — shared dashboard week-agenda card.
- **Create** `frontend/src/components/delegation/MyTasksTable.js` — task table with to-me/by-me toggle.
- **Modify** `frontend/src/pages/admin/DelegationApp.js` — add "My Tasks" tab + `?tab=` deep-link.
- **Modify** `frontend/src/hooks/useDelegationApp.js` — add My-Tasks loaders + state.
- **Modify** `frontend/src/pages/sales/SalesHome.js` — add "My Tasks" tile + `AgendaWeekWidget`.
- **Modify** `frontend/src/pages/TodayDashboard.js` — add `AgendaWeekWidget` + tile.
- **Modify** `frontend/src/pages/admin/Dashboard.js` — add `AgendaWeekWidget`.

Reused (no change): `delegation` wrapper in `frontend/src/lib/api.js` (`agenda`, `instances.list`, `myContext`).

---

### Task 1: `AgendaWeekWidget` shared component

**Files:**
- Create: `frontend/src/components/delegation/AgendaWeekWidget.js`

- [ ] **Step 1: Create the component**

```jsx
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
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0,0,0,0); return x; };

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

  const todayCount = (events.filter(e => e.date === today)).length;
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
                    <span className={`flex-1 min-w-0 truncate ${textSec} ${['completed','verified','done'].includes(e.status) ? 'line-through opacity-60' : ''}`}>{e.title}</span>
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
```

- [ ] **Step 2: Verify it parses**

Run: `cd frontend && NODE_ENV=development node -e "require('@babel/core').transformSync(require('fs').readFileSync('src/components/delegation/AgendaWeekWidget.js','utf8'),{presets:['react-app'],filename:'x.js'});console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/delegation/AgendaWeekWidget.js
git commit -m "feat(dashboard): AgendaWeekWidget — per-user week agenda card"
```

---

### Task 2: `MyTasksTable` component

**Files:**
- Create: `frontend/src/components/delegation/MyTasksTable.js`

- [ ] **Step 1: Create the component**

```jsx
import React, { useEffect, useState, useMemo } from 'react';
import { delegation as delApi } from '../../lib/api';
import { Check, Eye, Search, ArrowDownUp, Calendar, UserCheck } from 'lucide-react';

const PINK = '#e94560';
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const PRI = { high: 'text-red-500', medium: 'text-amber-500', low: 'text-green-500' };
const STATUS = {
  pending: 'bg-orange-500/15 text-orange-500',
  completed: 'bg-blue-500/15 text-blue-500',
  verified: 'bg-green-500/15 text-green-500',
};

export default function MyTasksTable({ myEmp, completeInst, verifyInst, card, textPri, textSec, textMuted, inputCls }) {
  const [dir, setDir] = useState('to');        // 'to' = assigned to me, 'by' = assigned by me
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    if (!myEmp?.emp_id) { setRows([]); return; }
    setLoading(true);
    try {
      const params = dir === 'to' ? { emp_id: myEmp.emp_id } : { delegator_id: myEmp.emp_id };
      const r = await delApi.instances.list(params);
      setRows(r.data || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dir, myEmp]);

  const filtered = useMemo(() => rows.filter(t => {
    if (status && t.status !== status) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!t.task_title?.toLowerCase().includes(s) &&
          !t.emp_name?.toLowerCase().includes(s) &&
          !t.delegator_name?.toLowerCase().includes(s)) return false;
    }
    return true;
  }).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')), [rows, status, q]);

  const onDone = async (inst) => { await completeInst(inst); load(); };
  const onVerify = async (inst) => { await verifyInst(inst.instance_id); load(); };

  if (!myEmp) {
    return <div className={`${card} border rounded-xl p-10 text-center`}>
      <p className={`text-sm ${textMuted}`}>Your tasks appear once your account is linked to the team.</p>
    </div>;
  }

  return (
    <div className="space-y-3">
      {/* toggle + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`${card} border rounded-xl p-1 flex gap-0.5`}>
          {[['to', 'Assigned to me'], ['by', 'Assigned by me']].map(([k, label]) => (
            <button key={k} onClick={() => setDir(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${dir === k ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={dir === k ? { background: PINK } : {}}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[140px]">
          <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${textMuted}`} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks…"
            className={`w-full pl-8 h-9 text-xs rounded-lg border px-2 focus:outline-none ${inputCls}`} />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className={`h-9 px-2 text-xs rounded-lg border border-[var(--border-color)] ${inputCls}`}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="verified">Verified</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-7 w-7 border-4 border-[#e94560] border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${card} border rounded-xl p-10 text-center`}>
          <ArrowDownUp className={`h-8 w-8 mx-auto mb-2 opacity-20 ${textMuted}`} />
          <p className={`text-sm ${textMuted}`}>{dir === 'to' ? 'No tasks assigned to you.' : 'You haven’t assigned any tasks.'}</p>
        </div>
      ) : (
        <div className={`${card} border rounded-xl overflow-hidden`}>
          {/* desktop table */}
          <table className="w-full text-sm hidden sm:table">
            <thead>
              <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
                {['Task', dir === 'to' ? 'From' : 'To', 'Due', 'Priority', 'Status', ''].map((h, i) => (
                  <th key={i} className={`py-2.5 px-3 text-left text-[10px] font-semibold uppercase tracking-wider ${textMuted}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const overdue = t.status === 'pending' && t.due_date < TODAY;
                return (
                  <tr key={t.instance_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    <td className={`px-3 py-2.5 font-medium ${textPri}`}>{t.task_title}</td>
                    <td className={`px-3 py-2.5 ${textSec}`}>{dir === 'to' ? (t.delegator_name || '—') : t.emp_name}</td>
                    <td className={`px-3 py-2.5 ${overdue ? 'text-red-500 font-semibold' : textSec}`}>{t.due_date}{overdue ? ' · overdue' : ''}</td>
                    <td className={`px-3 py-2.5 font-semibold capitalize ${PRI[t.priority] || textSec}`}>{t.priority}</td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[t.status]}`}>{t.status}</span></td>
                    <td className="px-3 py-2.5 text-right">
                      {dir === 'to' && t.status === 'pending' && (
                        <button onClick={() => onDone(t)} className="text-xs font-semibold px-2.5 py-1 rounded-lg text-white" style={{ background: '#10b981' }}>
                          <Check className="h-3 w-3 inline" /> Done
                        </button>
                      )}
                      {t.status === 'completed' && (
                        <button onClick={() => onVerify(t)} className="text-xs font-semibold px-2.5 py-1 rounded-lg text-blue-500 hover:bg-blue-500/10">
                          <Eye className="h-3 w-3 inline" /> Verify
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* mobile cards */}
          <div className="sm:hidden divide-y divide-[var(--border-color)]">
            {filtered.map(t => {
              const overdue = t.status === 'pending' && t.due_date < TODAY;
              return (
                <div key={t.instance_id} className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-medium ${textPri}`}>{t.task_title}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS[t.status]}`}>{t.status}</span>
                  </div>
                  <div className={`flex items-center gap-3 text-[11px] ${textMuted} flex-wrap`}>
                    <span className={`flex items-center gap-1 ${overdue ? 'text-red-500 font-semibold' : ''}`}><Calendar className="h-3 w-3" />{t.due_date}{overdue ? ' · overdue' : ''}</span>
                    <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" />{dir === 'to' ? (t.delegator_name || '—') : t.emp_name}</span>
                    <span className={`capitalize ${PRI[t.priority] || ''}`}>{t.priority}</span>
                  </div>
                  {(dir === 'to' && t.status === 'pending') && (
                    <button onClick={() => onDone(t)} className="w-full h-8 rounded-lg text-xs font-semibold text-white mt-1" style={{ background: '#10b981' }}>
                      <Check className="h-3.5 w-3.5 inline mr-1" /> Mark Done
                    </button>
                  )}
                  {t.status === 'completed' && (
                    <button onClick={() => onVerify(t)} className="w-full h-8 rounded-lg text-xs font-semibold text-blue-500 border border-[var(--border-color)] mt-1">
                      <Eye className="h-3.5 w-3.5 inline mr-1" /> Verify
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it parses**

Run: `cd frontend && NODE_ENV=development node -e "require('@babel/core').transformSync(require('fs').readFileSync('src/components/delegation/MyTasksTable.js','utf8'),{presets:['react-app'],filename:'x.js'});console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/delegation/MyTasksTable.js
git commit -m "feat(delegation): MyTasksTable — to-me / by-me task table"
```

---

### Task 3: Wire "My Tasks" tab + `?tab=` deep-link into DelegationApp

**Files:**
- Modify: `frontend/src/pages/admin/DelegationApp.js`

- [ ] **Step 1: Add imports** — at the top of `DelegationApp.js`, after the existing react-router import line `import { useNavigate } from 'react-router-dom';`, change it to also import `useSearchParams`, and import the table + an icon:

```jsx
import { useNavigate, useSearchParams } from 'react-router-dom';
import MyTasksTable from '../../components/delegation/MyTasksTable';
```
And add `ListChecks` to the existing `lucide-react` import list in this file.

- [ ] **Step 2: Read the `?tab=` param** — inside `export default function DelegationApp()`, after `const s = useDelegationApp();`, add:

```jsx
  const [searchParams] = useSearchParams();
  React.useEffect(() => {
    const t = searchParams.get('tab');
    if (t && t !== s.viewTab) s.setViewTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
```

- [ ] **Step 3: Add the tab button** — in the tab bar array (the `[{ id: 'calendar', ... }, { id: 'planner', ... }, ...VIEWS, ...]` list around line 97-103), insert after the `planner` entry:

```jsx
            { id: 'mytasks', label: 'My Tasks', icon: ListChecks },
```

- [ ] **Step 4: Render the tab** — after the `{s.viewTab === 'planner' && ( <MyPlanner ... /> )}` block, add:

```jsx
        {/* My Tasks table */}
        {s.viewTab === 'mytasks' && (
          <MyTasksTable
            myEmp={s.myEmp}
            completeInst={s.completeInst} verifyInst={s.verifyInst}
            {...sharedTheme}
          />
        )}
```

- [ ] **Step 5: Verify it parses**

Run: `cd frontend && NODE_ENV=development node -e "require('@babel/core').transformSync(require('fs').readFileSync('src/pages/admin/DelegationApp.js','utf8'),{presets:['react-app'],filename:'x.js'});console.log('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/DelegationApp.js
git commit -m "feat(delegation): My Tasks tab + ?tab= deep-link"
```

---

### Task 4: Add "My Tasks" quick tile + AgendaWeekWidget to Sales home

**Files:**
- Modify: `frontend/src/pages/sales/SalesHome.js`

- [ ] **Step 1: Import the widget** — add near the top imports:

```jsx
import AgendaWeekWidget from '../../components/delegation/AgendaWeekWidget';
```
And add `ListChecks` to the `lucide-react` import in this file.

- [ ] **Step 2: Add the tile** — in the `actions` array (around line 275-280), append one entry (delegation is universal, so no perm gate — give it `perm: true` so the `.filter(a => perms[a.perm])` keeps it; if `perms[true]` is falsy, instead push it after the filter). Use this exact replacement of the array + filter:

```jsx
            const actions = [
              { to: '/sales/attendance', icon: CheckCircle,  label: 'Attendance',  color: 'text-blue-400',   bg: 'bg-blue-400/10',   perm: 'attendance' },
              { to: '/sales/visits',     icon: MapPin,        label: 'Visits',      color: 'text-purple-400', bg: 'bg-purple-400/10', perm: 'visits_log' },
              { to: '/sales/quotations', icon: FileText,      label: 'My Quotes',   color: 'text-orange-400', bg: 'bg-orange-400/10', perm: 'quotation_view' },
              { to: '/sales/expenses',   icon: Receipt,       label: 'Expenses',    color: 'text-green-400',  bg: 'bg-green-400/10',  perm: 'expenses_log' },
              { to: '/leave-management', icon: Calendar,      label: 'Leave',       color: 'text-teal-400',   bg: 'bg-teal-400/10',   perm: 'leave_apply' },
            ].filter(a => perms[a.perm]);
            actions.push({ to: '/delegation?tab=mytasks', icon: ListChecks, label: 'My Tasks', color: 'text-pink-400', bg: 'bg-pink-400/10' });
```

- [ ] **Step 3: Add the widget** — directly after the closing `</section>` that contains the quick-actions grid (line ~296), insert:

```jsx
        <section>
          <AgendaWeekWidget card={card} textPri={tPri} textSec={tSec} textMuted={tMut} />
        </section>
```
(Use the theme variable names already defined in this file — confirm them at the top of the component; they are `card`, `tPri`, `tSec`, `tMut` per existing usage like `text-[11px] ${tSec}`. If a name differs, match the file's existing variables.)

- [ ] **Step 4: Verify it parses**

Run: `cd frontend && NODE_ENV=development node -e "require('@babel/core').transformSync(require('fs').readFileSync('src/pages/sales/SalesHome.js','utf8'),{presets:['react-app'],filename:'x.js'});console.log('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/sales/SalesHome.js
git commit -m "feat(sales-home): My Tasks tile + week agenda widget"
```

---

### Task 5: Add AgendaWeekWidget + tile to Today's Actions dashboard

**Files:**
- Modify: `frontend/src/pages/TodayDashboard.js`

- [ ] **Step 1: Imports** — add:

```jsx
import AgendaWeekWidget from '../components/delegation/AgendaWeekWidget';
import { ListChecks } from 'lucide-react';
```
(Merge `ListChecks` into the existing lucide-react import line instead of a second import if preferred.)

- [ ] **Step 2: Render the widget + tile** — inside the returned JSX, immediately after the opening content wrapper (after the stat chips / near the top of the page body, before the action sections), insert:

```jsx
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => nav('/delegation?tab=mytasks')}
            className="border rounded-xl p-3 flex items-center gap-2 bg-[var(--bg-card)] border-[var(--border-color)] active:opacity-75">
            <span className="w-9 h-9 rounded-lg bg-pink-400/10 flex items-center justify-center"><ListChecks className="h-4 w-4 text-pink-400" /></span>
            <span className="text-xs font-semibold text-[var(--text-secondary)]">My Tasks</span>
          </button>
          <button onClick={() => nav('/delegation?tab=calendar')}
            className="border rounded-xl p-3 flex items-center gap-2 bg-[var(--bg-card)] border-[var(--border-color)] active:opacity-75">
            <span className="w-9 h-9 rounded-lg bg-[#e94560]/10 flex items-center justify-center"><ClipboardList className="h-4 w-4 text-[#e94560]" /></span>
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Calendar</span>
          </button>
        </div>
        <AgendaWeekWidget
          card="bg-[var(--bg-card)] border-[var(--border-color)]"
          textPri="text-[var(--text-primary)]" textSec="text-[var(--text-secondary)]" textMuted="text-[var(--text-muted)]" />
```
(`ClipboardList` is already imported in this file; `nav` is the existing `useNavigate()` value.)

- [ ] **Step 3: Verify it parses**

Run: `cd frontend && NODE_ENV=development node -e "require('@babel/core').transformSync(require('fs').readFileSync('src/pages/TodayDashboard.js','utf8'),{presets:['react-app'],filename:'x.js'});console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/TodayDashboard.js
git commit -m "feat(today): week agenda widget + My Tasks/Calendar tiles"
```

---

### Task 6: Add AgendaWeekWidget to admin Dashboard

**Files:**
- Modify: `frontend/src/pages/admin/Dashboard.js`

- [ ] **Step 1: Import** — add:

```jsx
import AgendaWeekWidget from '../../components/delegation/AgendaWeekWidget';
```

- [ ] **Step 2: Render** — inside the dashboard JSX, after the `statCards` grid render block (before the lead/quotation cards), insert:

```jsx
        <div className={rv()}>
          <AgendaWeekWidget card={tk.card} textPri={tk.t1} textSec={tk.t2} textMuted={tk.tm} />
        </div>
```
(`tk` and `rv` are defined in this file at lines 44 and 62.)

- [ ] **Step 3: Verify it parses**

Run: `cd frontend && NODE_ENV=development node -e "require('@babel/core').transformSync(require('fs').readFileSync('src/pages/admin/Dashboard.js','utf8'),{presets:['react-app'],filename:'x.js'});console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/Dashboard.js
git commit -m "feat(dashboard): week agenda widget on admin dashboard"
```

---

### Task 7: Production build + deploy to app.smartshape.in

**Files:** none (build/deploy only).

- [ ] **Step 1: Full production build (proves no compile errors)**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build`
Expected: `Compiled successfully` (or compiled with the pre-existing exhaustive-deps warnings only) and a populated `frontend/build/`.

- [ ] **Step 2: Deploy** — per the standard SSH flow to `srv1667373.hstgr.cloud`, project at `/var/www/smartshape/`:
  push the branch / copy the built frontend, and restart the frontend service (and backend if the earlier delegation-route changes are included in this deploy). Confirm with the user before running the live deploy commands.

- [ ] **Step 3: Manual verification on live**
  1. Log in; on `/today` and `/dashboard` the **This Week** agenda shows your follow-ups/visits/tasks.
  2. The **My Tasks** tile opens `/delegation?tab=mytasks`; the table loads.
  3. Toggle **Assigned to me / Assigned by me** switches data; overdue rows are red; **Mark done / Verify** work and the row updates.
  4. **Open Calendar** opens `/delegation?tab=calendar`.

---

## Self-Review

**Spec coverage:**
- Calendar on dashboard (follow-ups + related) → Tasks 1, 4, 5, 6 (AgendaWeekWidget on all homes). ✓
- "My Tasks" quick tile on every account → Tasks 4 (sales), 5 (today), and the sidebar already links delegation for admin; admin Dashboard gets the widget (Task 6) + can reach the tile via /today on mobile. ✓
- My Tasks table with to-me/by-me toggle → Tasks 2 + 3. ✓
- Reuse existing endpoints, no backend change → confirmed (agenda + instances). ✓
- Deploy live → Task 7. ✓

**Placeholder scan:** No TBD/TODO. The one soft spot is Step 2 of Task 4 / Task 5 theme-variable names (`tPri`/`tSec` vs `card`) — the plan instructs to match the file's existing variables, which must be confirmed when editing that file (they are read directly above the edit site). Acceptable: the executor reads the variable names in-context.

**Type consistency:** `AgendaWeekWidget` props (`card,textPri,textSec,textMuted`) and `MyTasksTable` props (`myEmp,completeInst,verifyInst,card,textPri,textSec,textMuted,inputCls`) match their call sites in Tasks 3–6. `s.verifyInst` exists in `useDelegationApp` (returned). `?tab=` value `'mytasks'` matches the tab `id` added in Task 3. ✓
