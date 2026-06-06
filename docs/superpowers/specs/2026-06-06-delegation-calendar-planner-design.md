# Delegation Calendar & Daily Planner — Design Spec

**Date:** 2026-06-06
**Module:** SmartShape Pro — Delegation System
**Status:** Approved for planning

---

## 1. Goal

Make a **unified Calendar the prime focus** of the Delegation module: one place where every dated
thing a person must act on shows up — their own tasks, delegated tasks, FMS stage work, field
visit plans, follow-up calls/meetings/demos, and Zoom/physical workshops. The user **plans their
day** on an hour-by-hour timeline (adding personal blocks and time-boxing real items), and **acts
on any item in place** via a side drawer. Day / Week / Month views. Bosses can view a team
member's calendar.

### Decisions locked in brainstorming
- Calendar is the **default landing + main view** of Delegation (replaces the current basic calendar tab).
- Daily planning = **time-grid + user-created blocks** (drag items into hours; add personal blocks).
- v1 includes **all 6 sources**.
- Visibility: **own agenda for everyone; bosses/delegators can switch to a team member's calendar.**

### Non-goals (YAGNI)
- No external calendar sync (Google/Outlook), no ICS export.
- No webinar entity (doesn't exist; out of scope).
- No recurring personal plan blocks in v1 (single-day blocks only).
- No real-time push; data is fetched on view/date change (consistent with the app).

---

## 2. Architecture

**One backend aggregation endpoint** normalizes all sources into a single event shape; the
frontend renders Month/Week/Day from that one list. Rationale: server-side role/visibility
filtering, a single round-trip, and adding a future source touches only the backend.

```
Frontend (DelegationCalendar)                 Backend
  ── GET /delegation/agenda?from&to&emp_id ──▶  aggregate + normalize 6 sources ──▶ [events]
  ── GET/POST/PATCH/DELETE /delegation/plan-blocks ──▶ del_plan_blocks (personal)
  ── per-item action ──▶ existing source endpoints (complete / check-in / stage-complete / …)
```

---

## 3. The unified Agenda Event (normalized shape)

```jsonc
{
  "event_id": "del_inst_ab12cd",     // source-prefixed, stable
  "source":   "delegation",          // task | delegation | fms | visit | followup | workshop | plan
  "type":     "delegated",           // my_task|delegated|fms_stage|visit|call|meeting|demo|zoom_workshop|physical_workshop|plan_block
  "title":    "Submit design proof",
  "date":     "2026-06-08",          // YYYY-MM-DD (local/IST)
  "start_time": "11:00",             // HH:MM, or null = all-day/unscheduled
  "end_time":   "11:30",             // HH:MM or null
  "status":   "pending",             // source-native status, normalized label provided in meta
  "priority": "high",                // high|medium|low|null
  "entity_id": "inst_ab12cd",        // underlying id used by actions
  "link":      "/delegation",        // deep link to the owning module/record
  "meta":      { "delegator_name": "...", "school_name": "...", "platform": "zoom", "meeting_link": "...", "lead_id": "..." },
  "actions":   ["complete", "verify", "reschedule", "reassign"],
  "color":     "#e94560"
}
```
Frontend buckets events by `date`; within a day, timed events place on the grid and
null-time events go to an **"Unscheduled / All-day" tray**.

### 3.1 Source → normalization map (v1)

| source | from endpoint | date field → `date` | time → start/end | `entity_id` | default `actions` | color |
|---|---|---|---|---|---|---|
| `delegation` (my_task / delegated) | `GET /delegation/instances?emp_id&date_from&date_to` | `due_date` | null (unscheduled) | `instance_id` | complete, verify, reschedule, reassign | pink `#e94560` |
| `fms` (fms_stage) | `GET /fms/calendar` (range) | `plan_done` (date part) | from `plan_done` time | `stage_id` | complete_stage, open | violet `#8b5cf6` |
| `visit` | `GET /visit-plans` (filter assigned_to, range) | `visit_date` | `visit_time` | `visit_plan_id` | checkin, checkout, reschedule, open | cyan `#06b6d4` |
| `task` (CRM) | `GET /crm/tasks` (assigned_to, range) | `due_date` | `due_time` if present else null | `task_id` | complete, reschedule, open | amber `#f59e0b` |
| `followup` (call/meeting/demo) | `GET /crm/followups` (assigned_to, range) | `followup_date` | `followup_time` if present | `followup_id` | log_outcome, reschedule, open | emerald `#10b981` |
| `workshop` (zoom/physical) | `GET /training/sessions` (range) | `date` | `time` | `session_id` | join (if link), set_status, open | indigo `#6366f1` |
| `plan` (plan_block) | `del_plan_blocks` | `date` | `start_time`/`end_time` | `block_id` | edit, delete | slate `#64748b` |

> Planning note: confirm during implementation whether CRM follow-ups and training sessions have
> an **update/reschedule** and **outcome/status** endpoint. If a needed one is missing, the plan
> adds a minimal endpoint; otherwise the drawer falls back to "Open" deep-link for that action.
> The actor's identity (email→emp) is resolved with the existing `_resolve_actor` helper so
> "assigned to me" maps correctly across sources.

---

## 4. Backend

### 4.1 `GET /delegation/agenda`
Params: `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `emp_id` (optional).
- Resolve actor via `_resolve_actor`. Default subject = the actor's own emp/email.
- **Team viewing:** if `emp_id` is passed and differs from the actor, require `is_boss` OR the
  target is in the actor's `delegation_targets`; else 403.
- For the resolved subject, query each source within `[from, to]`, filtered to items assigned to /
  owned by that person (by emp_id for delegation; by `assigned_to`/email for visits, crm tasks,
  followups; training sessions are org-wide → include all in range, flagged `meta.org_wide=true`).
- Normalize each into the event shape (§3) and return `{ from, to, subject_emp_id, events: [...] }`.
- Plan blocks are included **only when viewing one's own** calendar.
- Bound the range (reject > 62 days) and cap results per source (e.g. 2000) — `log()` if capped.

### 4.2 Personal plan blocks — collection `del_plan_blocks`
```
block_id, emp_id, date (YYYY-MM-DD), start_time (HH:MM), end_time (HH:MM),
title, note, color, linked_event_id (optional), created_at, updated_at
```
Endpoints (all gated to `emp_id == actor`):
- `GET /delegation/plan-blocks?date=` (or range `from`/`to`)
- `POST /delegation/plan-blocks` `{date,start_time,end_time,title,note?,color?,linked_event_id?}`
- `PATCH /delegation/plan-blocks/{block_id}` (same editable fields)
- `DELETE /delegation/plan-blocks/{block_id}`
Validation: `end_time > start_time`; `title` required; block belongs to the actor.

### 4.3 Files
- Modify `backend/routes/delegation_routes.py` — add `agenda` aggregation + helpers
  (`_agenda_delegation`, `_agenda_fms`, `_agenda_visits`, `_agenda_crm_tasks`,
  `_agenda_followups`, `_agenda_workshops`, `_normalize_*`), and `del_plan_blocks` CRUD.
  If this file grows unwieldy, split agenda helpers into `backend/routes/delegation_agenda.py`
  and import the router-less helpers — decide at plan time based on file size.

---

## 5. Frontend

### 5.1 Files
- **Create** `frontend/src/hooks/useDelegationCalendar.js` — owns: view (`month|week|day`),
  cursor date, source filters, subject emp (self/team), agenda fetch, plan-block CRUD, selected
  event (for drawer). Kept separate from `useDelegationApp` to avoid bloating it.
- **Create** `components/delegation/calendar/DelegationCalendar.js` — container: header (date nav,
  Month/Week/Day switch, source-filter chips, team-member picker for bosses) + active view.
- **Create** `CalendarMonth.js` — month grid; per-day colored dots/counts; click day → Day view.
- **Create** `CalendarWeek.js` — 7 columns × hour rows; all-day lane on top.
- **Create** `CalendarDay.js` — hour timeline (configurable 6 AM–10 PM) + "Unscheduled" tray;
  add-block button; drag item→hour slot (see risk §9).
- **Create** `AgendaEventCard.js` — compact, color-by-source chip with status/priority.
- **Create** `EventActionDrawer.js` — right drawer: details + source-specific actions (§6).
- **Create** `DayPlanBlockDialog.js` — create/edit a personal block.
- **Modify** `pages/admin/DelegationApp.js` — add Calendar as the **first tab** and the default
  `viewTab`; mount the calendar container. Keep existing tabs.
- **Modify** `lib/api.js` — add `delegation.agenda(params)` and `delegation.planBlocks.{list,create,update,delete}`.

### 5.2 Default landing
`DelegationApp` initial `viewTab = 'calendar'`. The new unified calendar replaces the old basic
`DelegationCalendarTab`. (Role-switch behavior from the planner work is preserved.)

---

## 6. Interactivity — click → act (side drawer)

Clicking any event opens `EventActionDrawer` with details + the item's `actions`, wired to
existing source endpoints:

| Item | Drawer actions |
|---|---|
| My / Delegated task | Complete (`POST /delegation/instances/{id}/complete`, +photo variant) · Verify · Reschedule (`PATCH /delegation/instances/{id}`) · Request reassign (Part-2 flow) |
| FMS stage | Complete stage (`POST /fms/stages/{id}/complete`) · Open flow (`/flow-management`) |
| Visit | Check-in / Check-out (`POST /visit-plans/{id}/check-in|check-out`) · Reschedule (`/visit-plans/{id}/reschedule`) · Open school |
| Follow-up call / meeting / demo | Log outcome / Done · Reschedule · Open lead (`/leads`) |
| Workshop (zoom/physical) | Join (open `meeting_link`) · Set status · Open session |
| Plan block | Edit · Delete |

Always-available **Open** deep-link via `event.link`. After any successful action, the agenda
refetches for the current range.

---

## 7. Team visibility
A **team-member picker** (visible to boss/delegator) sets `subject_emp_id`; agenda reloads for
that person. Personal plan blocks are hidden/read-only when viewing someone else. Authorization is
enforced server-side in `/delegation/agenda` (§4.1).

---

## 8. Testing

Backend integration tests (live server, self-cleaning, recognizable prefixes):
- agenda returns normalized events from each source within range; out-of-range excluded.
- team viewing: boss can view a member; non-authorized actor → 403; self default works.
- plan-blocks CRUD; `end > start` validation; privacy (only owner reads/edits); blocks excluded
  when viewing another person.
- normalization: each source maps to the documented `source/type/date/entity_id/actions`.

Frontend: production build compiles; component render tests for Month grouping, Day timeline
placement (timed vs unscheduled), and drawer action wiring.

---

## 9. Edge cases & risks
- **Date-only items** (tasks, follow-ups) → "Unscheduled/All-day" tray; time assigned only when
  the user drags them or sets a time.
- **FMS `plan_done` is a datetime** → split into date + time.
- **Timezone:** app is IST; keep `date` as YYYY-MM-DD and `time` as HH:MM local; reuse existing IST
  helpers where times are computed.
- **Drag-to-reschedule** (Day grid) is the riskiest UI piece. v1 = drop onto an hour slot which
  sets the item's time (via that source's reschedule/PATCH). If a source has no reschedule
  endpoint, dragging only affects a **plan block** that references the item (time-boxing), not the
  source record — documented, not silent.
- **Missing endpoints:** if follow-up reschedule/outcome or training status updates don't exist,
  the plan adds minimal endpoints or degrades that action to "Open" — no silent failures.
- **Performance:** range capped (≤ 62 days) and per-source result caps; counts logged if capped.

## 10. Build phases (all within v1)
1. **Backend agenda** endpoint (6 sources normalized) + `del_plan_blocks` CRUD + tests.
2. **Calendar shell** (Month/Week/Day, nav, source-filter chips) as default landing.
3. **Day timeline** + unscheduled tray + personal plan blocks (create/edit/delete) + drag-to-slot.
4. **EventActionDrawer** with source-specific actions.
5. **Team viewing** + visual polish (frontend-design).
