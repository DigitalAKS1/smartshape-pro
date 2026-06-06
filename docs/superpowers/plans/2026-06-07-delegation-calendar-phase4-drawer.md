# Delegation Calendar — Phase 4 (Event Action Drawer) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make calendar events actionable. Clicking an event opens a right-side **EventActionDrawer** showing details + per-source action buttons that call the real backend endpoints (complete / verify / reopen / FMS stage-complete / visit check-in & check-out / CRM-task done / follow-up log-outcome / workshop join & status / reschedule), then refresh the agenda. Replaces the Phase-2 `onEventClick` no-op.

**Architecture:** A `runAction(ev, action, payload)` dispatcher in `useDelegationCalendar` maps `(source, action)` → the correct API client call and reloads the agenda. `EventActionDrawer` is presentational: it renders the buttons in `ev.actions` and small inputs for reschedule/outcome, calling `runAction`. `DelegationCalendar` owns `selectedEvent` state and routes non-plan event clicks to the drawer (plan blocks keep opening the edit dialog).

**Tech Stack:** React/CRA, axios clients in `lib/api.js`, lucide-react. Verify with `DISABLE_ESLINT_PLUGIN=true react-scripts build`.

---

## Existing API clients (verified — reuse)
- `delegation.instances.complete(id,{note})` · `.verify(id)` · `.reopen(id)` · `.patch(id,{due_date,priority})`
- `fms.completeStage(id,{})`
- `visitPlans.checkIn(id,{})` · `.checkOut(id,{})` · `.reschedule(id,{visit_date})`
- `tasks.update(id,{status|due_date})`  (PUT /tasks)
- `followups.update(id,{status,outcome|followup_date})`  (PUT /followups)
- **MISSING:** training session update → add `training.updateSession(id,{status})` (PUT /training/sessions/{id}).

`event.entity_id` is the underlying record id; `event.meta` holds extras (`meeting_link`, etc.); `event.link` is the deep-link path.

## Files
- **Modify** `frontend/src/lib/api.js` — add a `training` client.
- **Modify** `frontend/src/hooks/useDelegationCalendar.js` — import clients + add `runAction`.
- **Create** `frontend/src/components/delegation/calendar/EventActionDrawer.js`.
- **Modify** `frontend/src/components/delegation/calendar/DelegationCalendar.js` — `selectedEvent` state + render drawer + route clicks.

---

### Task 1: training client + `runAction` dispatcher

**Files:** Modify `frontend/src/lib/api.js`, `frontend/src/hooks/useDelegationCalendar.js`.

- [ ] **Step 1: Add training client to `lib/api.js`** (place near the other exports, e.g. after `followups`):

```javascript
// Training / Workshop sessions
export const training = {
  sessions:      ()       => API.get('/training/sessions'),
  updateSession: (id, d)  => API.put(`/training/sessions/${id}`, d),
};
```

- [ ] **Step 2: Add `runAction` to `useDelegationCalendar.js`**

At the top of the file, extend the api import to bring in the other clients:
```javascript
import { delegation as delApi, fms as fmsApi, visitPlans as visitApi, tasks as tasksApi, followups as fuApi, training as trainingApi } from '../lib/api';
```

Add this dispatcher inside the hook (before `return`):
```javascript
  const runAction = useCallback(async (ev, action, payload = {}) => {
    const id = ev.entity_id;
    try {
      switch (`${ev.source}:${action}`) {
        // delegation instances
        case 'delegation:complete': await delApi.instances.complete(id, { note: payload.note || '' }); break;
        case 'delegation:verify':   await delApi.instances.verify(id); break;
        case 'delegation:reopen':   await delApi.instances.reopen(id); break;
        case 'delegation:reschedule': await delApi.instances.patch(id, { due_date: payload.date }); break;
        // fms stage
        case 'fms:complete_stage':  await fmsApi.completeStage(id, {}); break;
        // visit plans
        case 'visit:checkin':       await visitApi.checkIn(id, {}); break;
        case 'visit:checkout':      await visitApi.checkOut(id, {}); break;
        case 'visit:reschedule':    await visitApi.reschedule(id, { visit_date: payload.date }); break;
        // crm task
        case 'task:complete':       await tasksApi.update(id, { status: 'done' }); break;
        case 'task:reschedule':     await tasksApi.update(id, { due_date: payload.date }); break;
        // follow-up
        case 'followup:log_outcome':await fuApi.update(id, { status: 'done', outcome: payload.outcome || '' }); break;
        case 'followup:reschedule': await fuApi.update(id, { followup_date: payload.date }); break;
        // workshop
        case 'workshop:set_status': await trainingApi.updateSession(id, { status: payload.status || 'completed' }); break;
        // plan block
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
```
Add `runAction` to the hook's returned object.

- [ ] **Step 3: Build** — `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error" | head` → `Compiled successfully.`; `rm -rf build`.

- [ ] **Step 4: Commit** — `git add frontend/src/lib/api.js frontend/src/hooks/useDelegationCalendar.js && git commit -m "feat(delegation): calendar runAction dispatcher + training client"`

---

### Task 2: EventActionDrawer + wire into container

**Files:** Create `EventActionDrawer.js`; modify `DelegationCalendar.js`.

- [ ] **Step 1: Create `frontend/src/components/delegation/calendar/EventActionDrawer.js`**

```javascript
import React, { useState } from 'react';
import { X, Check, RotateCcw, Calendar, ExternalLink, Video, ArrowRightLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PINK = '#e94560';

const ACTION_META = {
  complete:       { label: 'Mark done',     Icon: Check,          color: '#10b981' },
  verify:         { label: 'Verify',        Icon: Check,          color: '#3b82f6' },
  reopen:         { label: 'Reopen',        Icon: RotateCcw,      color: '#64748b' },
  complete_stage: { label: 'Complete stage',Icon: Check,          color: '#10b981' },
  checkin:        { label: 'Check in',      Icon: Check,          color: '#10b981' },
  checkout:       { label: 'Check out',     Icon: Check,          color: '#06b6d4' },
  set_status:     { label: 'Mark completed',Icon: Check,          color: '#10b981' },
  log_outcome:    { label: 'Log outcome',   Icon: Check,          color: '#10b981' },
};

export default function EventActionDrawer({ event, onAction, onClose, card, textPri, textSec, textMuted, inputCls }) {
  const navigate = useNavigate();
  const [rescheduleDate, setRescheduleDate] = useState(event.date || '');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  if (!event) return null;

  const acts = event.actions || [];
  const has = (a) => acts.includes(a);

  const fire = async (action, payload) => {
    setBusy(true);
    const ok = await onAction(event, action, payload);
    setBusy(false);
    if (ok) onClose();
  };

  const meta = event.meta || {};
  const row = `w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold`;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className={`relative w-full max-w-md ${card} border-l border-[var(--border-color)] flex flex-col shadow-2xl`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border-color)]">
          <span className="w-1.5 h-10 rounded-full flex-shrink-0 mt-0.5" style={{ background: event.color }} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${textPri}`}>{event.title}</p>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              {event.date}{event.start_time ? ` · ${event.start_time}` : ''} · <span className="capitalize">{event.type?.replace(/_/g, ' ') || event.source}</span>
              {event.status ? ` · ${event.status}` : ''}
            </p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* meta line(s) */}
          {(meta.delegator_name || meta.customer_name || meta.school_name || meta.lead_name || meta.location) && (
            <div className={`text-xs ${textSec} space-y-1`}>
              {meta.delegator_name && <p>From: {meta.delegator_name}</p>}
              {meta.customer_name && <p>Customer: {meta.customer_name}</p>}
              {meta.location && <p>Location: {meta.location}</p>}
            </div>
          )}

          {/* direct actions */}
          {['complete','verify','reopen','complete_stage','checkin','checkout','set_status'].filter(has).map(a => {
            const m = ACTION_META[a];
            return (
              <button key={a} disabled={busy} onClick={() => fire(a, {})}
                className={`${row} text-white`} style={{ background: m.color }}>
                <m.Icon className="h-4 w-4" /> {m.label}
              </button>
            );
          })}

          {/* join (workshop) */}
          {has('join') && meta.meeting_link && (
            <a href={meta.meeting_link} target="_blank" rel="noreferrer"
              className={`${row} text-white`} style={{ background: '#6366f1' }}>
              <Video className="h-4 w-4" /> Join
            </a>
          )}

          {/* log outcome (followup) */}
          {has('log_outcome') && (
            <div className="space-y-1.5">
              <input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Outcome (optional)…"
                className={`w-full h-9 px-2.5 text-sm rounded border border-[var(--border-color)] ${inputCls}`} />
              <button disabled={busy} onClick={() => fire('log_outcome', { outcome })}
                className={`${row} text-white`} style={{ background: '#10b981' }}>
                <Check className="h-4 w-4" /> Log outcome &amp; done
              </button>
            </div>
          )}

          {/* reschedule */}
          {has('reschedule') && (
            <div className="space-y-1.5">
              <label className={`text-[11px] uppercase tracking-wide font-semibold ${textMuted}`}>Reschedule to</label>
              <div className="flex gap-2">
                <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
                  className={`flex-1 h-9 px-2.5 text-sm rounded border border-[var(--border-color)] ${inputCls}`} />
                <button disabled={busy || !rescheduleDate} onClick={() => fire('reschedule', { date: rescheduleDate })}
                  className="h-9 px-3 rounded-lg text-sm font-semibold border border-[var(--border-color)]" style={{ color: PINK }}>
                  <Calendar className="h-4 w-4 inline" />
                </button>
              </div>
            </div>
          )}

          {/* reassign (delegation) — defer to module; deep-link for now */}
          {has('reassign') && (
            <button onClick={() => navigate('/delegation')}
              className={`${row} border border-[var(--border-color)] ${textSec}`}>
              <ArrowRightLeft className="h-4 w-4" /> Reassign (in Delegation)
            </button>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--border-color)]">
          <button onClick={() => navigate(event.link || '/delegation')}
            className={`${row} border border-[var(--border-color)] ${textSec}`}>
            <ExternalLink className="h-4 w-4" /> Open in module
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `DelegationCalendar.js`**

1. Import: `import EventActionDrawer from './EventActionDrawer';`
2. State (after `const c = useDelegationCalendar();`): `const [selectedEvent, setSelectedEvent] = React.useState(null);`
3. Replace the `onEventClick` passed to `AgendaList`, `CalendarMonth` day-open, and `CalendarDay` with a local handler that opens the drawer for non-plan events. Specifically:
   - For `CalendarDay`, change its `onEventClick={onEventClick}` to `onEventClick={(e) => setSelectedEvent(e)}` (plan blocks still go through `onEditBlock`, unchanged).
   - For `AgendaList` (week view), change `onEventClick={onEventClick}` to `onEventClick={(e) => e.source === 'plan' ? setBlockDialog({ block: e }) : setSelectedEvent(e)}`.
   - The month view's day click stays `setCursor + setView('day')` (unchanged).
   The `onEventClick` prop from the parent is no longer needed; you may keep accepting it but it's unused.
4. Render the drawer at the end of the returned JSX (alongside the block dialog):
   ```javascript
   {selectedEvent && (
     <EventActionDrawer
       event={selectedEvent}
       onAction={c.runAction}
       onClose={() => setSelectedEvent(null)}
       card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
   )}
   ```

- [ ] **Step 3: Build** — `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error|Module not found" | head` → `Compiled successfully.`; `rm -rf build`. Fix any error & rebuild.

- [ ] **Step 4: Commit** — `git add frontend/src/components/delegation/calendar/EventActionDrawer.js frontend/src/components/delegation/calendar/DelegationCalendar.js && git commit -m "feat(delegation): EventActionDrawer — click an event to act (complete/verify/check-in/join/reschedule)"`

---

## Self-Review (Phase 4)
- **Spec coverage:** §6 click→act drawer with per-source actions wired to real endpoints; reschedule for delegation/visit/task/followup; workshop join + status; FMS stage-complete; visit check-in/out. Plan blocks keep using the edit dialog. Open-in-module deep link always present.
- **Placeholders:** none; complete code. `reassign` deep-links to the Delegation module (full request flow already exists there) rather than duplicating it in the drawer — documented.
- **Type consistency:** `runAction(ev, action, payload)` switch keys match the `actions[]` values emitted by the Phase-1 normalizers (`complete, verify, reopen, complete_stage, checkin, checkout, reschedule, complete(task), log_outcome, set_status, join, reassign, open`). `EventActionDrawer` reads `event.entity_id/meta/link/actions` exactly as produced by `_ev`. `inputCls` already threaded into `DelegationCalendar` (Phase 3).

## Roadmap — Phase 5
Team-member picker (`subjectEmp` already in the hook) + a `frontend-design` polish pass across the calendar.
