# Delegation Calendar — Phase 3 (Day Timeline + Plan Blocks + Drag) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Turn the Day view into an hour-by-hour planner: a timeline (6 AM–10 PM) where timed events and personal plan blocks sit at their hours, an "Unscheduled" tray holds date-only items, the user can create/edit/delete personal **plan blocks**, and can **drag** a plan block to another hour or **drag an unscheduled item onto an hour** to time-box it (creates a linked plan block).

**Architecture:** Extend `useDelegationCalendar` with plan-block CRUD + a `scheduleItem` helper (time-boxes an agenda item by creating a linked plan block). New `CalendarDay` renders the timeline + tray + drag/drop and a `DayPlanBlockDialog` for create/edit. `DelegationCalendar` uses `CalendarDay` for the `day` view (keeps `AgendaList` for `week`).

**Tech Stack:** React/CRA, lucide-react, native HTML5 drag-and-drop (no new deps), tailwind + CSS-vars. Verify with `DISABLE_ESLINT_PLUGIN=true react-scripts build`.

**Design decision (documented):** Phase 3 drag time-boxes via **personal plan blocks** — it does NOT mutate the source record (task/visit/etc.). Rescheduling the actual source record happens in the Phase-4 action drawer. So dragging an unscheduled CRM task onto 2 PM creates a "plan block" linked to it at 2 PM; the task's own due time is unchanged. This avoids needing per-source reschedule endpoints in Phase 3 and is the spec's documented fallback.

---

## Files
- **Modify** `frontend/src/hooks/useDelegationCalendar.js` — add `createBlock`, `updateBlock`, `deleteBlock`, `scheduleItem`.
- **Create** `frontend/src/components/delegation/calendar/DayPlanBlockDialog.js`
- **Create** `frontend/src/components/delegation/calendar/CalendarDay.js`
- **Modify** `frontend/src/components/delegation/calendar/DelegationCalendar.js` — use `CalendarDay` for `day` view; manage block-dialog state.

Reuse event shape from Phase 1/2. Plan-block API already exists: `delApi.planBlocks.{list,create,update,delete}`.

---

### Task 1: Hook plan-block actions + DayPlanBlockDialog

**Files:**
- Modify: `frontend/src/hooks/useDelegationCalendar.js`
- Create: `frontend/src/components/delegation/calendar/DayPlanBlockDialog.js`

- [ ] **Step 1: Add actions to the hook**

In `useDelegationCalendar.js`, import is already `delApi` + `toast`. Add these inside the hook, before the `return`:

```javascript
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

  // time-box an agenda item by creating a linked personal plan block at start..start+1h
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
```

Add `createBlock, updateBlock, deleteBlock, scheduleItem` to the hook's returned object.

- [ ] **Step 2: Create DayPlanBlockDialog**

`frontend/src/components/delegation/calendar/DayPlanBlockDialog.js`:

```javascript
import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

const PINK = '#e94560';

export default function DayPlanBlockDialog({
  block, date, onSave, onDelete, onClose, card, textPri, textSec, textMuted, inputCls,
}) {
  const editing = !!block?.block_id;
  const [form, setForm] = useState({
    title: block?.title || '',
    start_time: block?.start_time || '09:00',
    end_time: block?.end_time || '10:00',
    note: block?.meta?.note ?? block?.note ?? '',
    color: block?.color || PINK,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const valid = form.title.trim() && form.start_time && form.end_time && form.end_time > form.start_time;

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`${card} border rounded-2xl w-full max-w-sm`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <h2 className={`text-base font-semibold ${textPri}`}>{editing ? 'Edit block' : 'New plan block'}</h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Title</label>
            <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Focus, Break, Prep…" className={`h-9 text-sm ${inputCls}`} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Start</label>
              <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} className={fld} /></div>
            <div><label className={lbl}>End</label>
              <input type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} className={fld} /></div>
          </div>
          <div><label className={lbl}>Note</label>
            <Input value={form.note} onChange={e => set('note', e.target.value)} className={`h-9 text-sm ${inputCls}`} /></div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--border-color)]">
          {editing
            ? <button onClick={() => onDelete(block.block_id)} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className={`h-9 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={() => onSave({ date, ...form })} disabled={!valid}
              className="h-9 text-white font-semibold" style={{ background: PINK }}>{editing ? 'Save' : 'Add'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build** — `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error" | head` → `Compiled successfully.`; then `rm -rf build`.

- [ ] **Step 4: Commit** — `git add frontend/src/hooks/useDelegationCalendar.js frontend/src/components/delegation/calendar/DayPlanBlockDialog.js && git commit -m "feat(delegation): plan-block actions in hook + DayPlanBlockDialog"`

---

### Task 2: CalendarDay timeline + drag, wired into container

**Files:**
- Create: `frontend/src/components/delegation/calendar/CalendarDay.js`
- Modify: `frontend/src/components/delegation/calendar/DelegationCalendar.js`

- [ ] **Step 1: Create CalendarDay**

`frontend/src/components/delegation/calendar/CalendarDay.js`:

```javascript
import React from 'react';
import { Plus } from 'lucide-react';

const START_HOUR = 6, END_HOUR = 22;   // 6 AM .. 10 PM
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;
const label = (h) => { const am = h < 12; const x = h % 12 || 12; return `${x} ${am ? 'AM' : 'PM'}`; };
const isDone = (e) => ['completed', 'verified', 'done'].includes(e.status);

export default function CalendarDay({
  date, events, onEventClick, onAddBlock, onEditBlock, onDropItem, onMoveBlock,
  card, textPri, textSec, textMuted,
}) {
  const timed = events.filter(e => e.start_time);
  const unscheduled = events.filter(e => !e.start_time);

  const hourOf = (t) => Math.max(START_HOUR, Math.min(END_HOUR, parseInt((t || '06:00').slice(0, 2), 10)));
  const eventsAtHour = (h) => timed.filter(e => hourOf(e.start_time) === h);

  const handleDrop = (h) => (ev) => {
    ev.preventDefault();
    const raw = ev.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (d.kind === 'block') onMoveBlock?.(d.id, hhmm(h));
      else if (d.kind === 'item') onDropItem?.(d.event, hhmm(h));
    } catch { /* ignore */ }
  };
  const dragStart = (payload) => (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify(payload));

  return (
    <div className="space-y-3">
      {/* Unscheduled tray */}
      {unscheduled.length > 0 && (
        <div className={`${card} border rounded-xl p-3`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-2 ${textMuted}`}>Unscheduled · drag onto an hour to plan</p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map(e => (
              <button key={e.event_id} draggable onDragStart={dragStart({ kind: 'item', event: e })}
                onClick={() => onEventClick?.(e)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-[var(--border-color)] cursor-grab active:cursor-grabbing ${isDone(e) ? 'opacity-50 line-through' : ''}`}
                style={{ background: e.color + '14' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
                <span className={textSec}>{e.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hour grid */}
      <div className={`${card} border rounded-xl overflow-hidden`}>
        {HOURS.map(h => (
          <div key={h} className="flex border-b border-[var(--border-color)] last:border-0 min-h-[52px]"
            onDragOver={(e) => e.preventDefault()} onDrop={handleDrop(h)}>
            <div className={`w-16 flex-shrink-0 text-right pr-2 pt-1.5 text-[10px] ${textMuted} border-r border-[var(--border-color)]`}>{label(h)}</div>
            <div className="flex-1 p-1.5 space-y-1 group relative">
              {eventsAtHour(h).map(e => {
                const isBlock = e.source === 'plan';
                return (
                  <div key={e.event_id} draggable={isBlock} onDragStart={isBlock ? dragStart({ kind: 'block', id: e.entity_id }) : undefined}
                    onClick={() => isBlock ? onEditBlock?.(e) : onEventClick?.(e)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs cursor-pointer flex items-center gap-2 ${isBlock ? 'cursor-grab active:cursor-grabbing' : ''} ${isDone(e) ? 'opacity-50 line-through' : ''}`}
                    style={{ background: e.color + '1f', borderLeft: `3px solid ${e.color}` }}>
                    <span className={`font-mono text-[10px] ${textMuted}`}>{e.start_time}</span>
                    <span className={`${textPri} truncate`}>{e.title}</span>
                    {isBlock && <span className={`ml-auto text-[9px] ${textMuted}`}>plan</span>}
                  </div>
                );
              })}
              <button onClick={() => onAddBlock?.(hhmm(h))}
                className={`absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${textMuted} hover:bg-[var(--bg-hover)]`} title="Add block">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire CalendarDay into DelegationCalendar**

In `DelegationCalendar.js`:
1. Imports: add
   ```javascript
   import { Plus } from 'lucide-react';
   import CalendarDay from './CalendarDay';
   import DayPlanBlockDialog from './DayPlanBlockDialog';
   ```
   (merge `Plus` into the existing lucide import line).
2. Add dialog state at the top of the component (after `const c = useDelegationCalendar();`):
   ```javascript
   const [blockDialog, setBlockDialog] = React.useState(null); // {block?, start?} or null
   ```
3. Replace the `day`-view branch. Currently the non-month branch renders `AgendaList` for both week and day. Change it so **week** uses `AgendaList` and **day** uses `CalendarDay`:
   ```javascript
   {!c.loading && c.view === 'week' && (
     <AgendaList dates={rangeDates()} eventsByDate={c.eventsByDate}
       onEventClick={onEventClick} card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
   )}
   {!c.loading && c.view === 'day' && (
     <CalendarDay
       date={c.range.from} events={c.eventsByDate[c.range.from] || []}
       onEventClick={onEventClick}
       onAddBlock={(start) => setBlockDialog({ start })}
       onEditBlock={(e) => setBlockDialog({ block: e })}
       onDropItem={(ev, start) => c.scheduleItem(ev, c.range.from, start)}
       onMoveBlock={(id, start) => {
         const endHH = String(Math.min(23, parseInt(start.slice(0,2),10) + 1)).padStart(2,'0');
         c.updateBlock(id, { start_time: start, end_time: `${endHH}:00` });
       }}
       card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
   )}
   ```
   (Remove the old combined `c.view !== 'month'` branch so it isn't rendered twice.)
4. Add a "+ Block" button to the header (next to the view switch) that opens the dialog for the current day, only in day view:
   ```javascript
   {c.view === 'day' && (
     <button onClick={() => setBlockDialog({ start: '09:00' })}
       className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: PINK }}>
       <Plus className="h-3.5 w-3.5" /> Block
     </button>
   )}
   ```
   Place it just before or after the month/week/day switch container in the header row.
5. Render the dialog at the end of the component's returned JSX (before the closing `</div>`):
   ```javascript
   {blockDialog && (
     <DayPlanBlockDialog
       block={blockDialog.block}
       date={c.range.from}
       onSave={async (payload) => {
         const ok = blockDialog.block?.entity_id
           ? await c.updateBlock(blockDialog.block.entity_id, payload)
           : await c.createBlock(blockDialog.start ? { ...payload, start_time: payload.start_time || blockDialog.start } : payload);
         if (ok) setBlockDialog(null);
       }}
       onDelete={async (id) => { if (await c.deleteBlock(id)) setBlockDialog(null); }}
       onClose={() => setBlockDialog(null)}
       card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
   )}
   ```
   Note: `inputCls` must be a prop of `DelegationCalendar`. Add `inputCls` to its destructured props: `export default function DelegationCalendar({ onEventClick, card, textPri, textSec, textMuted, inputCls }) {`. And in `DelegationApp.js`, pass `inputCls={inputCls}` to `<DelegationCalendar .../>`.
   Also note for edit: plan-block events from the agenda use `entity_id` = the block_id, and `meta.note` holds the note — `DayPlanBlockDialog` already reads `block.meta?.note`.

- [ ] **Step 3: Build** — `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error|Module not found" | head` → `Compiled successfully.`; `rm -rf build`. Fix any error (theme prop names / lucide import) and rebuild.

- [ ] **Step 4: Commit** — `git add frontend/src/components/delegation/calendar/CalendarDay.js frontend/src/components/delegation/calendar/DelegationCalendar.js frontend/src/pages/admin/DelegationApp.js && git commit -m "feat(delegation): Day hour-timeline + plan blocks + drag-to-time"`

---

## Self-Review (Phase 3)
- **Spec coverage:** §2/§6 day timeline (CalendarDay hour grid), unscheduled tray (date-only items), personal plan blocks create/edit/delete (DayPlanBlockDialog + hook CRUD), drag-to-time (HTML5 DnD; plan blocks move, unscheduled items time-box via linked block). Source-record reschedule is deferred to Phase 4 (documented).
- **Placeholders:** none; complete code per step.
- **Type consistency:** hook adds `createBlock/updateBlock/deleteBlock/scheduleItem`; `CalendarDay` props match what `DelegationCalendar` passes; plan-block agenda events carry `entity_id`=block_id and `meta.note`, consumed by the dialog. `inputCls` threaded from `DelegationApp` → `DelegationCalendar` → dialog.

## Roadmap — Phases 4–5
- Phase 4: `EventActionDrawer` — replace the `onEventClick` no-op with a real side drawer of per-source actions (complete/verify/stage-complete/check-in/log-outcome/join), including source-record reschedule.
- Phase 5: team-member picker (`subjectEmp`) + `frontend-design` polish pass.
