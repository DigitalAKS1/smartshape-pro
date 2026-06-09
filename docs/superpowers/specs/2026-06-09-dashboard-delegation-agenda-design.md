# Dashboard Calendar + My Tasks — Design

**Date:** 2026-06-09
**Status:** Approved (pending final user review)
**Author:** Aman / Claude

## Problem

Tasks and follow-ups live inside separate modules (Delegation, CRM). A user — especially a
Sales Team Member — has no single place on their landing screen to see "what's on my plate":
their follow-ups, visits, and assigned tasks. They also can't see delegation tasks in a plain
table. We want a calendar/agenda surfaced on the dashboard plus a quick way into a task table.

## Goals

1. **Calendar on the dashboard** — every account sees a compact week agenda of *their own*
   items (follow-ups, visits, CRM tasks, delegation tasks, reminders), with a link to the full
   Delegation Calendar.
2. **Quick tile "My Tasks"** — styled like the existing Attendance / Leave tiles, on every home
   screen, opening a task table.
3. **"My Tasks" table** inside the Delegation System with a toggle: *Assigned to me* (delegatee)
   and *Assigned by me* (delegator).

## Non-goals (YAGNI)

- No new backend endpoints — the agenda (`/delegation/agenda`) and instance lists
  (`/delegation/instances`) already return everything needed.
- No full month-grid embedded on the dashboard (heavy); the dashboard shows a compact week
  agenda and links out to the existing full calendar.
- No changes to Attendance / Leave tiles beyond adding one tile beside them.

## Existing building blocks (reused)

- `GET /delegation/agenda?from&to[&emp_id]` → unified per-user events across delegation, FMS,
  visits, CRM tasks, follow-ups, workshops, reminders, plan blocks. Resolves the caller by email,
  so it works for any synced user (all users are auto-synced as delegation employees).
- `GET /delegation/instances?emp_id=<me>` → tasks assigned **to** me.
- `GET /delegation/instances?delegator_id=<me>` → tasks I **assigned out**.
- `delApi.agenda()`, `delApi.instances.list()`, `delApi.myContext()` in `frontend/src/lib/api.js`.
- Existing handlers `completeInst` / `verifyInst` in `useDelegationApp`.
- Quick-tile pattern: `SalesHome.js` actions grid (perm-gated).
- Landing pages: mobile → `/today`; admin → `/dashboard`; sales → `/sales`; (others by module).

## Design

### Component 1 — `AgendaWeekWidget` (shared)
A self-contained card placed on the three home surfaces.

- **Props:** none required; reads the current user via context.
- **Data:** on mount, calls `delApi.agenda({ from: <Sunday>, to: <Saturday> })` for the current
  week (self). Groups events by date.
- **Render:** header "This Week" + today's item count; a per-day list (Today first) of up to N
  items each (then "+N more"), each row = source dot (delegation/fms/visit/task/followup/…) + title + time/status;
  overdue/pending styling. Empty state: "Nothing scheduled — you're clear."
- **Footer:** button **"Open Calendar"** → `/delegation?tab=calendar`.
- **Isolation:** depends only on `delApi.agenda`; no parent state. Placed on `TodayDashboard`,
  `SalesHome`, and admin `Dashboard` (identical component, so behaviour is uniform).

### Component 2 — "My Tasks" quick tile
A tile matching the Attendance/Leave style, added to each home's quick-action area.

- Label **"My Tasks"**, calendar/checklist icon, optional count badge = number of open
  (pending) tasks assigned to me.
- Links to `/delegation?tab=mytasks`.
- Visibility: shown to every linked user (no restrictive perm; delegation is universal). On
  `SalesHome` it joins the existing actions grid; on `/today` and `/dashboard` it sits in a small
  quick-links row near the top.

### Component 3 — `MyTasksTable` tab (inside Delegation System)
A new tab **"My Tasks"** in `DelegationApp`.

- **Toggle:** *Assigned to me* (default) ↔ *Assigned by me*.
  - to me → `instances.list({ emp_id: myEmp.emp_id })`
  - by me → `instances.list({ delegator_id: myEmp.emp_id })`
- **Columns:** Task · Person (From X / To Y depending on toggle) · Due (red if overdue) ·
  Priority · Status · Action.
  - Action: "Mark done" for pending tasks assigned to me (reuses `completeInst`); "Verify" for
    completed (reuses `verifyInst`); read-only label otherwise.
- **Controls:** status filter + text search, consistent with the existing board. Mobile: rows
  collapse to a compact stacked card.
- **Deep-link:** `DelegationApp` reads `?tab=` on mount → opens `mytasks` (table) or `calendar`.

### Data flow
```
Dashboard home ──renders──> AgendaWeekWidget ──GET /delegation/agenda(week)──> grouped events
                └─renders──> "My Tasks" tile ──link──> /delegation?tab=mytasks
DelegationApp (?tab) ──opens──> MyTasksTable ──GET /delegation/instances(emp_id|delegator_id)──> rows
                                              └─action──> complete/verify (existing endpoints)
```

### Error handling
- Agenda/instance fetch failures: widget/table show a short inline "Couldn't load" with a retry;
  never block the rest of the dashboard.
- Unlinked user (no delegation employee): agenda still returns email-based items (followups,
  visits, tasks); the "by me" toggle simply shows empty.

## Testing
- Backend: no change (endpoints verified this session).
- Frontend (manual on live after deploy):
  1. Sales member sees the week agenda with their follow-ups/visits on `/today` and `/sales`.
  2. "My Tasks" tile shows for a delegatee and an admin; badge count matches pending tasks.
  3. Table toggle switches data sets; overdue rows styled; Mark-done/Verify work.
  4. Deep-links `/delegation?tab=mytasks` and `?tab=calendar` open the right tab.

## Deployment
Frontend-only change (+ the delegation-calendar fixes already in the working tree from the
earlier debugging session). Build frontend, restart/serve on `app.smartshape.in` per the
standard SSH deploy. No DB migration.

## Rollback
Pure additive frontend; revert the commit and redeploy to remove. No data changes.
